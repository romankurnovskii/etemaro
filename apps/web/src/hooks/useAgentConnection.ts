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
  lastSeen: number | null
  error: string | null
  logs: LogEntry[]
  chat: ChatMessage[]
  catalog: ToolDescriptor[]
  sendChat: (text: string) => boolean
}

function send(ws: WebSocket, type: string, payload: unknown): string {
  const id = `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  ws.send(
    JSON.stringify({
      id,
      type,
      payload,
      timestamp: Date.now(),
    }),
  )
  return id
}

function nextMessageId(): string {
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function useAgentConnection(wsUrl: string | null, token: string): AgentConnection {
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [snapshot, setSnapshot] = useState<StateSnapshot | null>(null)
  const [lastSeen, setLastSeen] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [chat, setChat] = useState<ChatMessage[]>([])
  const [catalog, setCatalog] = useState<ToolDescriptor[]>([])
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    let closed = false
    let timer: number | undefined
    let retry = 800
    setSnapshot(null)
    setLastSeen(null)
    setError(null)
    setLogs([])
    setChat([])
    setCatalog([])
    setStatus('disconnected')
    if (!wsUrl) return

    const connect = () => {
      if (closed) return
      setStatus('connecting')
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws
      let authId: string | undefined
      let authFailed = false
      let subscribed = false
      const subscribe = () => {
        if (subscribed || closed) return
        subscribed = true
        retry = 800
        setStatus('connected')
        setError(null)
        send(ws, IpcMessageType.SUBSCRIBE_LOGS, {})
        send(ws, IpcMessageType.SUBSCRIBE_STATE, {})
      }

      ws.onopen = () => {
        if (closed) return
        if (token) authId = send(ws, IpcMessageType.AUTH, { token })
        else subscribe()
      }

      ws.onmessage = (event: MessageEvent<string>) => {
        if (closed) return
        let msg: IpcMessage
        try {
          msg = JSON.parse(event.data) as IpcMessage
        } catch {
          return
        }
        if (!msg || typeof msg !== 'object' || !msg.payload || typeof msg.payload !== 'object') return
        if (msg.type === IpcMessageType.STATE_SNAPSHOT) {
          const state = msg.payload as StateSnapshot
          if (Array.isArray(state.positions) && typeof state.busy === 'boolean') {
            setSnapshot(state)
            setLastSeen(msg.timestamp || Date.now())
          }
        } else if (msg.type === IpcMessageType.LOG_ENTRY) {
          const log = msg.payload as LogEntry
          if (typeof log.message === 'string' && typeof log.category === 'string')
            setLogs((prev) => [...prev.slice(-499), { ...log, streamId: nextMessageId() }])
        } else if (msg.type === IpcMessageType.TOOL_CATALOG) {
          const tools = (msg.payload as { tools?: ToolDescriptor[] }).tools
          if (Array.isArray(tools)) setCatalog(tools)
        } else if (msg.type === IpcMessageType.ACK) {
          const reply = (msg.payload as { reply?: string }).reply
          if (authId && (msg.payload as { ref?: string }).ref === authId) subscribe()
          if (reply) setChat((prev) => [...prev, { id: nextMessageId(), sender: 'agent', text: reply }])
        } else if (msg.type === IpcMessageType.ERROR) {
          const message = (msg.payload as { message?: string }).message
          const code = (msg.payload as { code?: string }).code
          setError(message ?? 'Daemon request failed')
          if (code === 'AUTH_FAILED' || code === 'NOT_AUTHENTICATED') {
            authFailed = true
            ws.close()
          }
          setChat((prev) => [
            ...prev,
            { id: nextMessageId(), sender: 'system', text: `Error: ${message ?? 'unknown'}` },
          ])
        }
      }

      ws.onclose = () => {
        if (closed) return
        setStatus('disconnected')
        if (!authFailed) {
          timer = window.setTimeout(connect, retry)
          retry = Math.min(retry * 1.6, 8000)
        }
      }
      ws.onerror = () => {}
    }

    connect()
    return () => {
      closed = true
      if (timer) window.clearTimeout(timer)
      const ws = wsRef.current
      wsRef.current = null
      if (ws) {
        ws.onopen = null
        ws.onmessage = null
        ws.onclose = null
        ws.onerror = null
        ws.close()
      }
    }
  }, [wsUrl, token])

  const sendChat = useCallback(
    (text: string) => {
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN || status !== 'connected') {
        setChat((prev) => [...prev, { id: nextMessageId(), sender: 'system', text: 'Not connected to the agent.' }])
        return false
      }
      send(ws, IpcMessageType.COMMAND_CHAT, { prompt: text })
      setChat((prev) => [...prev, { id: nextMessageId(), sender: 'user', text }])
      return true
    },
    [status],
  )

  return { status, snapshot, lastSeen, error, logs, chat, catalog, sendChat }
}
