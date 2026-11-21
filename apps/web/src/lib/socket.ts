import { backoffDelay } from './backoff'
import { type IpcMessage, IpcMessageType } from './ipc'

export type SocketStatus = 'connecting' | 'connected' | 'disconnected'

export interface IpcSocketHandlers {
  onStatus: (status: SocketStatus) => void
  onMessage: (msg: IpcMessage) => void
}

export interface IpcSocket {
  /** Send a message; returns false when the socket is not open. */
  send: (type: string, payload: unknown) => boolean
  /** Stop reconnecting and close. Handlers are never called afterwards. */
  close: () => void
}

function envelope(type: string, payload: unknown): string {
  return JSON.stringify({
    id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    payload,
    timestamp: Date.now(),
  })
}

/**
 * Reconnecting IPC WebSocket: authenticates (when a token is given), subscribes
 * to logs + state, and retries with jittered exponential backoff.
 */
export function openIpcSocket(url: string, token: string, handlers: IpcSocketHandlers): IpcSocket {
  let ws: WebSocket | null = null
  let timer: number | undefined
  let attempt = 0
  let closed = false

  const connect = () => {
    if (closed) return
    handlers.onStatus('connecting')
    const socket = new WebSocket(url)
    ws = socket

    socket.onopen = () => {
      if (closed) return
      attempt = 0
      handlers.onStatus('connected')
      if (token) socket.send(envelope(IpcMessageType.AUTH, { token }))
      socket.send(envelope(IpcMessageType.SUBSCRIBE_LOGS, {}))
      socket.send(envelope(IpcMessageType.SUBSCRIBE_STATE, {}))
    }

    socket.onmessage = (event: MessageEvent<string>) => {
      if (closed) return
      let msg: IpcMessage
      try {
        msg = JSON.parse(event.data) as IpcMessage
      } catch {
        return
      }
      handlers.onMessage(msg)
    }

    socket.onclose = () => {
      if (closed) return
      handlers.onStatus('disconnected')
      timer = window.setTimeout(connect, backoffDelay(attempt))
      attempt += 1
    }

    // A failed connect always fires `close` next; reconnect is handled there.
    socket.onerror = () => {}
  }

  connect()

  return {
    send(type, payload) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return false
      ws.send(envelope(type, payload))
      return true
    },
    close() {
      closed = true
      if (timer !== undefined) window.clearTimeout(timer)
      if (ws) {
        ws.onopen = null
        ws.onmessage = null
        ws.onclose = null
        ws.onerror = null
        ws.close()
      }
      ws = null
    },
  }
}
