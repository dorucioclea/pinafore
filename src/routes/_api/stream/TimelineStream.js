import { WebSocketClient } from '../../_thirdparty/websocket/websocket'
import lifecycle from 'page-lifecycle/dist/lifecycle.mjs'
import { getStreamUrl } from './getStreamUrl'
import { EventEmitter } from 'events-light'
import { eventBus } from '../../_utils/eventBus'

export class TimelineStream extends EventEmitter {
  constructor (streamingApi, accessToken, timeline) {
    super()
    this._streamingApi = streamingApi
    this._accessToken = accessToken
    this._timeline = timeline
    this._onStateChange = this._onStateChange.bind(this)
    this._onOnline = this._onOnline.bind(this)
    this._onOffline = this._onOffline.bind(this)
    this._onOnlineStateChange = this._onOnlineStateChange.bind(this)
    this._setupWebSocket()
    this._setupEvents()
  }

  close () {
    this._closed = true
    this._closeWebSocket()
    this._teardownEvents()
    // events-light currently does not support removeAllListeners()
    // https://github.com/patrick-steele-idem/events-light/issues/2
    for (const event of ['open', 'close', 'reconnect', 'message']) {
      this.removeAllListeners(event)
    }
  }

  _closeWebSocket () {
    if (this._ws) {
      this.emit('close')
      this._ws.onopen = null
      this._ws.onmessage = null
      this._ws.onclose = null
      this._ws.close()
      this._ws = null
    }
  }

  _setupWebSocket () {
    const url = getStreamUrl(this._streamingApi, this._accessToken, this._timeline)
    const ws = new WebSocketClient(url)

    ws.onopen = () => {
      if (!this._opened) {
        this.emit('open')
        this._opened = true
      } else {
        // we may close or reopen websockets due to freeze/unfreeze events
        // and we want to fire "reconnect" rather than "open" in that case
        this.emit('reconnect')
      }
    }
    ws.onmessage = (e) => this.emit('message', JSON.parse(e.data))
    ws.onclose = () => this.emit('close')
    // The ws "onreconnect" event seems unreliable. When the server goes down and comes back up,
    // it doesn't fire (but "open" does). When we freeze and unfreeze, it fires along with the
    // "open" event. The above is my attempt to normalize it.

    this._ws = ws
  }

  _setupEvents () {
    lifecycle.addEventListener('statechange', this._onStateChange)
    eventBus.on('forcedOnline', this._onOnlineStateChange) // only happens in tests
    window.addEventListener('online', this._onOnline)
    window.addEventListener('offline', this._onOffline)
  }

  _teardownEvents () {
    lifecycle.removeEventListener('statechange', this._onStateChange)
    eventBus.removeListener('forcedOnline', this._onOnlineStateChange) // only happens in tests
    window.removeEventListener('online', this._onOnline)
    window.removeEventListener('offline', this._onOffline)
  }

  _pause () {
    if (this._closed) {
      return
    }
    this._closeWebSocket()
  }

  _unpause () {
    if (this._closed) {
      return
    }
    this._closeWebSocket()
    this._setupWebSocket()
  }

  _onStateChange (event) {
    // when the page enters or exits a frozen state, pause or resume websocket polling
    if (event.newState === 'frozen') { // page is frozen
      console.log('frozen')
      this._pause()
    } else if (event.oldState === 'frozen') { // page is unfrozen
      console.log('unfrozen')
      this._unpause()
    }
    if (event.newState === 'active') { // page is reopened from a background tab
      console.log('active')
      console.log('websocket readyState', this._ws && this._ws.readyState)
      if (this._ws && this._ws.readyState !== WebSocketClient.OPEN) {
        // if a websocket connection is not currently open, then reset the
        // backoff counter to ensure that fresh notifications come in faster
        this._ws.reset()
        this._ws.reconnect()
      }
    }
  }

  _onOnline () {
    this._onOnlineStateChange(true)
  }

  _onOffline () {
    this._onOnlineStateChange(false)
  }

  _onOnlineStateChange (online) {
    if (online) {
      console.log('online')
      this._unpause()
    } else {
      console.log('offline')
      this._pause()
    }
  }
}
