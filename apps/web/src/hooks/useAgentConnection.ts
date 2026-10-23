import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type ChatMessage,
  type IpcMessage,
  IpcMessageType,
  type LogEntry,
  type StateSnapshot,
  type ToolDescriptor,
} from '../lib/ipc'

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'rejected'

export interface AgentConnection {
  status: ConnectionStatus
  snapshot: StateSnapshot | null
  lastHeartbeat: number | null
  logs: LogEntry[]
  chat: ChatMessage[]
  catalog: ToolDescriptor[]
  sendChat: (text: string) => boolean
}

function send(ws: WebSocket, type: string, payload: unknown): void {
  ws.send(JSON.stringify({ id: nextMessageId(), type, payload, timestamp: Date.now() }))
}

function nextMessageId(): string {
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

interface StreamHandlers {
  status: (status: ConnectionStatus) => void
  message: (message: IpcMessage) => void
}

/** One endpoint's lifecycle. Closing it cancels pending retries and stale callbacks. */
export function openAgentStream(wsUrl: string, token: string, handlers: StreamHandlers) {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let retry = 800
  let socket: WebSocket | null = null
  const connect = () => {
    if (stopped) return
    handlers.status('connecting')
    const ws = new WebSocket(wsUrl)
    socket = ws
    ws.onopen = () => {
      if (stopped || socket !== ws) return
      if (token) send(ws, IpcMessageType.AUTH, { token })
      send(ws, IpcMessageType.SUBSCRIBE_LOGS, {})
      send(ws, IpcMessageType.SUBSCRIBE_STATE, {})
      handlers.status('connected')
    }
    ws.onmessage = (event: MessageEvent<string>) => {
      if (stopped || socket !== ws) return
      try {
        const msg: unknown = JSON.parse(event.data)
        if (!msg || typeof msg !== 'object' || !('type' in msg) || typeof msg.type !== 'string') return
        // Reset after an actual server message, not repeated short-lived opens.
        retry = 800
        handlers.message(msg as IpcMessage)
      } catch {
        /* Ignore malformed messages without terminating the stream. */
      }
    }
    ws.onclose = (event) => {
      if (stopped || socket !== ws) return
      socket = null
      if (event.code === 1008) {
        handlers.status('rejected')
        return
      }
      handlers.status('disconnected')
      timer = setTimeout(connect, retry)
      retry = Math.min(retry * 1.6, 8000)
    }
    ws.onerror = () => {
      /* onclose owns reconnect; do not schedule twice. */
    }
  }
  connect()
  return {
    sendChat(text: string) {
      if (stopped || !socket || socket.readyState !== WebSocket.OPEN) return false
      send(socket, IpcMessageType.COMMAND_CHAT, { prompt: text })
      return true
    },
    close() {
      stopped = true
      clearTimeout(timer)
      socket?.close()
      socket = null
    },
  }
}

/** Prevent a parent or misconfigured endpoint from populating a child's card. */
export function acceptsAgentMessage(msg: IpcMessage, configPath?: string, agentId?: string): boolean {
  if (!msg.payload || typeof msg.payload !== 'object') return false
  if (msg.type === IpcMessageType.STATE_SNAPSHOT) {
    const state = msg.payload as StateSnapshot
    return (
      Array.isArray(state.positions) &&
      typeof state.busy === 'boolean' &&
      (!configPath || state.configPath === configPath)
    )
  }
  if (msg.type === IpcMessageType.LOG_ENTRY) {
    const log = msg.payload as LogEntry
    return typeof log.category === 'string' && typeof log.message === 'string' && (!agentId || log.agentId === agentId)
  }
  return true
}

export function useAgentConnection(
  wsUrl: string | null,
  token: string,
  configPath?: string,
  agentId?: string,
): AgentConnection {
  const [status, setStatus] = useState<ConnectionStatus>('idle')
  const [snapshot, setSnapshot] = useState<StateSnapshot | null>(null)
  const [lastHeartbeat, setHeartbeat] = useState<number | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [chat, setChat] = useState<ChatMessage[]>([])
  const [catalog, setCatalog] = useState<ToolDescriptor[]>([])
  const streamRef = useRef<ReturnType<typeof openAgentStream> | null>(null)

  useEffect(() => {
    setSnapshot(null)
    setHeartbeat(null)
    setLogs([])
    setChat([])
    setCatalog([])
    if (!wsUrl) {
      setStatus('idle')
      return
    }
    const stream = openAgentStream(wsUrl, token, {
      status(next) {
        setStatus(next)
        if (next !== 'connected') {
          setSnapshot(null)
          setHeartbeat(null)
        }
      },
      message(msg) {
        if (!acceptsAgentMessage(msg, configPath, agentId)) return
        if (msg.type === IpcMessageType.STATE_SNAPSHOT) {
          setSnapshot(msg.payload as StateSnapshot)
          setHeartbeat(Date.now())
        } else if (msg.type === IpcMessageType.LOG_ENTRY) {
          const clientId = typeof msg.id === 'string' && msg.id ? msg.id : nextMessageId()
          setLogs((prev) => [...prev.slice(-499), { ...(msg.payload as LogEntry), clientId }])
        } else if (msg.type === IpcMessageType.TOOL_CATALOG) {
          const tools = (msg.payload as { tools?: ToolDescriptor[] }).tools
          if (Array.isArray(tools)) setCatalog(tools)
        } else if (msg.type === IpcMessageType.ACK) {
          const reply = (msg.payload as { reply?: string }).reply
          if (typeof reply === 'string' && reply) {
            setChat((prev) => [...prev.slice(-499), { id: nextMessageId(), sender: 'agent', text: reply }])
          }
        } else if (msg.type === IpcMessageType.ERROR) {
          const message = (msg.payload as { message?: string }).message
          setChat((prev) => [
            ...prev.slice(-499),
            {
              id: nextMessageId(),
              sender: 'system',
              text: `Error: ${message ?? 'unknown'}`,
            },
          ])
        }
      },
    })
    streamRef.current = stream
    return () => {
      streamRef.current = null
      stream.close()
    }
  }, [wsUrl, token, configPath, agentId])

  const sendChat = useCallback((text: string) => {
    if (!streamRef.current?.sendChat(text)) {
      setChat((prev) => [
        ...prev.slice(-499),
        { id: nextMessageId(), sender: 'system', text: 'Not connected to the agent.' },
      ])
      return false
    }
    setChat((prev) => [...prev.slice(-499), { id: nextMessageId(), sender: 'user', text }])
    return true
  }, [])

  return { status, snapshot, lastHeartbeat, logs, chat, catalog, sendChat }
}
