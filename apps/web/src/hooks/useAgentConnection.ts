import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type ChatMessage,
  type IpcMessage,
  IpcMessageType,
  type LogEntry,
  type StateSnapshot,
  type ToolDescriptor,
} from '../lib/ipc'

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

export interface AgentConnection {
  status: ConnectionStatus
  snapshot: StateSnapshot | null
  logs: LogEntry[]
  chat: ChatMessage[]
  catalog: ToolDescriptor[]
  /** Epoch ms of the next scheduled reconnect attempt, or null when not waiting. */
  retryAt: number | null
  sendChat: (text: string) => boolean
}

function send(ws: WebSocket, type: string, payload: unknown): void {
  ws.send(
    JSON.stringify({
      id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      payload,
      timestamp: Date.now(),
    }),
  )
}

function nextMessageId(): string {
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function useAgentConnection(wsUrl: string, token: string): AgentConnection {
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [snapshot, setSnapshot] = useState<StateSnapshot | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [chat, setChat] = useState<ChatMessage[]>([])
  const [catalog, setCatalog] = useState<ToolDescriptor[]>([])
  const [retryAt, setRetryAt] = useState<number | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    let closed = false
    let timer: number | undefined
    let retry = 800

    const connect = () => {
      if (closed) return
      if (timer) window.clearTimeout(timer)
      timer = undefined
      setRetryAt(null)
      setStatus('connecting')
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        retry = 800
        setRetryAt(null)
        setStatus('connected')
        if (token) send(ws, IpcMessageType.AUTH, { token })
        send(ws, IpcMessageType.SUBSCRIBE_LOGS, {})
        send(ws, IpcMessageType.SUBSCRIBE_STATE, {})
      }

      ws.onmessage = (event: MessageEvent<string>) => {
        let msg: IpcMessage
        try {
          msg = JSON.parse(event.data) as IpcMessage
        } catch {
          return
        }
        if (msg.type === IpcMessageType.STATE_SNAPSHOT) {
          setSnapshot(msg.payload as StateSnapshot)
        } else if (msg.type === IpcMessageType.LOG_ENTRY) {
          setLogs((prev) => [...prev.slice(-499), msg.payload as LogEntry])
        } else if (msg.type === IpcMessageType.TOOL_CATALOG) {
          setCatalog((msg.payload as { tools: ToolDescriptor[] }).tools ?? [])
        } else if (msg.type === IpcMessageType.ACK) {
          const reply = (msg.payload as { reply?: string }).reply
          if (reply) setChat((prev) => [...prev, { id: nextMessageId(), sender: 'agent', text: reply }])
        } else if (msg.type === IpcMessageType.ERROR) {
          const message = (msg.payload as { message?: string }).message
          setChat((prev) => [
            ...prev,
            { id: nextMessageId(), sender: 'system', text: `Error: ${message ?? 'unknown'}` },
          ])
        }
      }

      ws.onclose = () => {
        setStatus('disconnected')
        if (!closed) {
          // Exponential backoff (cap 8s) with +/-25% jitter so a restarted daemon is not stampeded.
          const delay = Math.round(retry * (0.75 + Math.random() * 0.5))
          setRetryAt(Date.now() + delay)
          timer = window.setTimeout(connect, delay)
          retry = Math.min(retry * 1.6, 8000)
        }
      }
      ws.onerror = () => {}
    }

    // Skip the wait when the network comes back.
    const onOnline = () => {
      if (closed || wsRef.current?.readyState === WebSocket.OPEN) return
      retry = 800
      connect()
    }
    window.addEventListener('online', onOnline)

    connect()
    return () => {
      closed = true
      window.removeEventListener('online', onOnline)
      if (timer) window.clearTimeout(timer)
      wsRef.current?.close()
    }
  }, [wsUrl, token])

  const sendChat = useCallback((text: string) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setChat((prev) => [...prev, { id: nextMessageId(), sender: 'system', text: 'Not connected to the agent.' }])
      return false
    }
    send(ws, IpcMessageType.COMMAND_CHAT, { prompt: text })
    setChat((prev) => [...prev, { id: nextMessageId(), sender: 'user', text }])
    return true
  }, [])

  return { status, snapshot, logs, chat, catalog, retryAt, sendChat }
}
