/**
 * Framework-free resilient WebSocket client for the Etemaro IPC daemon.
 *
 * Features:
 * - Auth → subscribe logs/state handshake
 * - Exponential backoff (800 ms → 8 s cap) with full ±25% jitter
 * - Immediate reconnect on browser `online` and `visibilitychange` → visible
 * - Hard stop on close code 1008 (AUTH_FAILED / AUTH_TIMEOUT) — emits 'auth-failed',
 *   does NOT storm-retry
 * - `dispose()` is idempotent and StrictMode-safe
 */

import { type IpcMessage, IpcMessageType, type LogEntry, type StateSnapshot } from './ipc'

export type SocketStatus = 'connecting' | 'connected' | 'disconnected' | 'auth-failed'

export interface SocketEvents {
  status: (s: SocketStatus, retryIn: number | null) => void
  log: (entry: LogEntry) => void
  snapshot: (snap: StateSnapshot) => void
  'auth-failed': () => void
  /** Emitted for every parsed IpcMessage — allows consumers to handle additional
   * message types (TOOL_CATALOG, ACK, ERROR) without a second WS connection. */
  message: (msg: IpcMessage) => void
}

type EventMap = {
  [K in keyof SocketEvents]: Set<SocketEvents[K]>
}

export class DaemonSocket {
  private ws: WebSocket | null = null
  private disposed = false
  private retryTimer: number | undefined
  private retryDelay = 800
  private _status: SocketStatus = 'connecting'
  private _retryIn: number | null = null
  private countdownTimer: number | undefined
  private onlineHandler: (() => void) | null = null
  private visibilityHandler: (() => void) | null = null

  private listeners: EventMap = {
    status: new Set(),
    log: new Set(),
    snapshot: new Set(),
    'auth-failed': new Set(),
    message: new Set(),
  }

  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  on<K extends keyof SocketEvents>(event: K, fn: SocketEvents[K]): this {
    ;(this.listeners[event] as Set<SocketEvents[K]>).add(fn)
    return this
  }

  off<K extends keyof SocketEvents>(event: K, fn: SocketEvents[K]): this {
    ;(this.listeners[event] as Set<SocketEvents[K]>).delete(fn)
    return this
  }

  private emit<K extends keyof SocketEvents>(event: K, ...args: Parameters<SocketEvents[K]>): void {
    for (const fn of this.listeners[event]) {
      ;(fn as (...a: Parameters<SocketEvents[K]>) => void)(...args)
    }
  }

  private setStatus(s: SocketStatus, retryIn: number | null = null): void {
    this._status = s
    this._retryIn = retryIn
    this.emit('status', s, retryIn)
  }

  get status(): SocketStatus {
    return this._status
  }
  get retryIn(): number | null {
    return this._retryIn
  }

  /** Open the connection. Safe to call multiple times (no-op if already open). */
  connect(): void {
    if (this.disposed) return
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return
    this._open()
  }

  private _open(): void {
    if (this.disposed) return
    this.setStatus('connecting', null)

    let wsUrl = this.url.replace(/^http/, 'ws')
    // Ensure ws:// or wss:// prefix
    if (!wsUrl.startsWith('ws')) wsUrl = `ws://${wsUrl}`

    const ws = new WebSocket(wsUrl)
    this.ws = ws

    ws.onopen = () => {
      if (this.disposed) {
        ws.close()
        return
      }
      this.retryDelay = 800
      clearTimeout(this.countdownTimer)
      this._retryIn = null
      this.setStatus('connected', null)

      if (this.token) {
        this._send(IpcMessageType.AUTH, { token: this.token })
      }
      this._send(IpcMessageType.SUBSCRIBE_LOGS, {})
      this._send(IpcMessageType.SUBSCRIBE_STATE, {})
    }

    ws.onmessage = (ev: MessageEvent<string>) => {
      let msg: IpcMessage
      try {
        msg = JSON.parse(ev.data) as IpcMessage
      } catch {
        return
      }

      // Emit raw message first so consumers can handle protocol-specific types
      this.emit('message', msg)

      if (msg.type === IpcMessageType.STATE_SNAPSHOT) {
        this.emit('snapshot', msg.payload as StateSnapshot)
      } else if (msg.type === IpcMessageType.LOG_ENTRY) {
        this.emit('log', msg.payload as LogEntry)
      } else if (msg.type === IpcMessageType.ERROR) {
        const payload = msg.payload as { code?: string; message?: string }
        // Auth errors from IpcServer arrive as ERROR messages before the 1008 close
        if (payload.code === 'AUTH_FAILED' || payload.code === 'AUTH_TIMEOUT') {
          this._stopForAuth()
        }
      }
    }

    ws.onclose = (ev: CloseEvent) => {
      if (ev.code === 1008) {
        // Policy violation — always means auth failure in this daemon
        this._stopForAuth()
        return
      }
      if (this.disposed) return
      this._scheduleRetry()
    }

    ws.onerror = () => {
      /* onclose fires after onerror, schedule retry there */
    }
  }

  private _stopForAuth(): void {
    this.disposed = true // prevents further reconnect attempts
    clearTimeout(this.retryTimer)
    clearTimeout(this.countdownTimer)
    this._removeWindowHandlers()
    this.setStatus('auth-failed', null)
    this.emit('auth-failed')
  }

  private _scheduleRetry(): void {
    if (this.disposed) return
    // Full jitter: random in [0, retryDelay]
    const jitter = Math.random() * this.retryDelay
    const delay = Math.round(jitter)
    const seconds = Math.max(1, Math.round(delay / 1000))

    this.setStatus('disconnected', seconds)
    this._startCountdown(seconds)

    this.retryTimer = globalThis.setTimeout(() => {
      if (!this.disposed) this._open()
    }, delay) as unknown as number

    this.retryDelay = Math.min(this.retryDelay * 1.6, 8000)
  }

  private _startCountdown(from: number): void {
    clearTimeout(this.countdownTimer)
    let remaining = from
    const tick = () => {
      remaining -= 1
      this.setStatus('disconnected', Math.max(0, remaining))
      if (remaining > 0) {
        this.countdownTimer = globalThis.setTimeout(tick, 1000) as unknown as number
      }
    }
    this.countdownTimer = globalThis.setTimeout(tick, 1000) as unknown as number
  }

  /** Wire up immediate-reconnect on browser `online` and visibility restore. */
  installWindowHandlers(): this {
    if (this.disposed) return this
    const onOnline = () => {
      if (this._status === 'disconnected' && !this.disposed) {
        clearTimeout(this.retryTimer)
        clearTimeout(this.countdownTimer)
        this._open()
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && this._status === 'disconnected' && !this.disposed) {
        clearTimeout(this.retryTimer)
        clearTimeout(this.countdownTimer)
        this._open()
      }
    }
    this.onlineHandler = onOnline
    this.visibilityHandler = onVisibility
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisibility)
    return this
  }

  private _removeWindowHandlers(): void {
    if (this.onlineHandler) {
      window.removeEventListener('online', this.onlineHandler)
      this.onlineHandler = null
    }
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler)
      this.visibilityHandler = null
    }
  }

  private _send(type: string, payload: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(
      JSON.stringify({
        id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type,
        payload,
        timestamp: Date.now(),
      }),
    )
  }

  send(type: string, payload: unknown): void {
    this._send(type, payload)
  }

  /** Idempotent cleanup. Safe to call twice (React StrictMode). */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    clearTimeout(this.retryTimer)
    clearTimeout(this.countdownTimer)
    this._removeWindowHandlers()
    this.ws?.close()
    this.ws = null
  }
}
