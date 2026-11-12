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
  attempt: number
  authError: string | null
  lastMessageAt: number | null
  snapshot: StateSnapshot | null
  logs: LogEntry[]
  chat: ChatMessage[]
  catalog: ToolDescriptor[]
  sendChat: (text: string) => boolean
  clearLogs: () => void
  reconnect: () => void
}

const MAX_LOGS = 1000

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
  const [attempt, setAttempt] = useState(0)
  const [authError, setAuthError] = useState<string | null>(null)
  const [lastMessageAt, setLastMessageAt] = useState<number | null>(null)
  const [snapshot, setSnapshot] = useState<StateSnapshot | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [chat, setChat] = useState<ChatMessage[]>([])
  const [catalog, setCatalog] = useState<ToolDescriptor[]>([])
  const [nonce, setNonce] = useState(0)
  const wsRef = useRef<WebSocket | null>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce forces a manual reconnect
  useEffect(() => {
    let closed = false
    let timer: number | undefined
    let watchdog: number | undefined
    let retry = 800
    let tries = 0
    let lastSeen = Date.now()

    const connect = () => {
      if (closed) return
      setStatus('connecting')
      setAttempt(tries)
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        retry = 800
        tries = 0
        lastSeen = Date.now()
        setAttempt(0)
        setAuthError(null)
        setStatus('connected')
        if (token) send(ws, IpcMessageType.AUTH, { token })
        send(ws, IpcMessageType.SUBSCRIBE_LOGS, {})
        send(ws, IpcMessageType.SUBSCRIBE_STATE, {})
      }

      ws.onmessage = (event: MessageEvent<string>) => {
        lastSeen = Date.now()
        setLastMessageAt(lastSeen)
        let msg: IpcMessage
        try {
          msg = JSON.parse(event.data) as IpcMessage
        } catch {
          return
        }
        if (msg.type === IpcMessageType.STATE_SNAPSHOT) {
          setSnapshot(msg.payload as StateSnapshot)
        } else if (msg.type === IpcMessageType.LOG_ENTRY) {
          setLogs((prev) => {
            const next = prev.length >= MAX_LOGS ? prev.slice(prev.length - MAX_LOGS + 1) : prev.slice()
            next.push(msg.payload as LogEntry)
            return next
          })
        } else if (msg.type === IpcMessageType.TOOL_CATALOG) {
          setCatalog((msg.payload as { tools: ToolDescriptor[] }).tools ?? [])
        } else if (msg.type === IpcMessageType.ACK) {
          const reply = (msg.payload as { reply?: string }).reply
          if (reply) setChat((prev) => [...prev, { id: nextMessageId(), sender: 'agent', text: reply }])
        } else if (msg.type === IpcMessageType.ERROR) {
          const message = (msg.payload as { message?: string }).message ?? 'unknown'
          if (/auth|token|unauthor/i.test(message)) setAuthError(message)
          setChat((prev) => [...prev, { id: nextMessageId(), sender: 'system', text: `Error: ${message}` }])
        }
      }

      ws.onclose = () => {
        setStatus('disconnected')
        if (closed) return
        tries += 1
        setAttempt(tries)
        const jitter = Math.random() * 300
        timer = window.setTimeout(connect, retry + jitter)
        retry = Math.min(retry * 1.6, 8000)
      }
      ws.onerror = () => {
        ws.close()
      }
    }

    watchdog = window.setInterval(() => {
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN && Date.now() - lastSeen > 90_000) ws.close()
    }, 15_000)

    connect()
    return () => {
      closed = true
      if (timer) window.clearTimeout(timer)
      if (watchdog) window.clearInterval(watchdog)
      wsRef.current?.close()
    }
  }, [wsUrl, token, nonce])

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

  const clearLogs = useCallback(() => setLogs([]), [])
  const reconnect = useCallback(() => setNonce((n) => n + 1), [])

  return { status, attempt, authError, lastMessageAt, snapshot, logs, chat, catalog, sendChat, clearLogs, reconnect }
}
