import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type ChatMessage,
  type IpcMessage,
  IpcMessageType,
  type LogEntry,
  type StateSnapshot,
  type ToolDescriptor,
} from '../lib/ipc'

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'unauthorized' | 'error'
export interface AgentConnection {
  status: ConnectionStatus
  snapshot: StateSnapshot | null
  logs: LogEntry[]
  chat: ChatMessage[]
  catalog: ToolDescriptor[]
  heartbeat: string | null
  sendChat: (text: string) => boolean
}
interface StreamHandlers {
  status: (value: ConnectionStatus) => void
  snapshot: (value: StateSnapshot | null) => void
  log: (value: LogEntry) => void
  catalog: (value: ToolDescriptor[]) => void
  reply: (value: string, system: boolean) => void
}
function send(ws: WebSocket, type: string, payload: unknown): void {
  ws.send(JSON.stringify({ id: crypto.randomUUID(), type, payload, timestamp: Date.now() }))
}

/** One stream owns one socket, identity and retry timer. Exported for fake-socket tests. */
export function openAgentStream(
  url: string,
  token: string,
  handlers: StreamHandlers,
  expectedAgentId?: string,
  makeSocket: (url: string) => WebSocket = (address) => new WebSocket(address),
): { close: () => void; sendChat: (text: string) => boolean } {
  let disposed = false
  let socket: WebSocket | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let retry = 800
  const connect = () => {
    if (disposed) return
    handlers.status('connecting')
    let ws: WebSocket
    try {
      ws = makeSocket(url)
    } catch {
      handlers.status('error')
      return
    }
    socket = ws
    const current = () => !disposed && socket === ws
    ws.onopen = () => {
      if (!current()) return
      if (token) send(ws, IpcMessageType.AUTH, { token })
      send(ws, IpcMessageType.SUBSCRIBE_LOGS, {})
      send(ws, IpcMessageType.SUBSCRIBE_STATE, {})
    }
    ws.onmessage = (event: MessageEvent<string>) => {
      if (!current()) return
      let msg: IpcMessage
      try {
        msg = JSON.parse(event.data) as IpcMessage
      } catch {
        return
      }
      if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return
      if (msg.type === IpcMessageType.STATE_SNAPSHOT) {
        const state = msg.payload as StateSnapshot
        if (!state || !Array.isArray(state.positions)) return
        if (expectedAgentId && state.agentId && state.agentId !== expectedAgentId) {
          handlers.status('error')
          handlers.snapshot(null)
          disposed = true
          ws.close()
          return
        }
        handlers.snapshot(state)
      } else if (msg.type === IpcMessageType.LOG_ENTRY) {
        const entry = msg.payload as LogEntry
        if (!entry || typeof entry.category !== 'string' || typeof entry.message !== 'string') return
        if (expectedAgentId && entry.agentId !== expectedAgentId) return
        handlers.log(entry)
      } else if (msg.type === IpcMessageType.TOOL_CATALOG) {
        const tools = (msg.payload as { tools?: ToolDescriptor[] } | null)?.tools
        if (Array.isArray(tools)) handlers.catalog(tools)
      } else if (msg.type === IpcMessageType.ACK) {
        const reply = (msg.payload as { reply?: string } | null)?.reply
        if (reply) handlers.reply(reply, false)
      } else if (msg.type === IpcMessageType.ERROR) {
        const message = (msg.payload as { message?: string } | null)?.message
        handlers.reply(message ?? 'Agent request failed', true)
      }
      // Reset backoff after a valid protocol message, not on a short-lived TCP open.
      retry = 800
      handlers.status('connected')
    }
    ws.onclose = (event: CloseEvent) => {
      if (!current()) return
      handlers.snapshot(null)
      handlers.catalog([])
      if (event.code === 1008) {
        disposed = true
        handlers.status('unauthorized')
        return
      }
      handlers.status('disconnected')
      timer = setTimeout(connect, retry * (0.8 + Math.random() * 0.4))
      retry = Math.min(retry * 1.6, 8000)
    }
    ws.onerror = () => {}
  }
  connect()
  return {
    close: () => {
      disposed = true
      clearTimeout(timer)
      socket?.close()
      socket = null
    },
    sendChat: (text) => {
      if (disposed || !socket || socket.readyState !== 1) return false
      send(socket, IpcMessageType.COMMAND_CHAT, { prompt: text })
      return true
    },
  }
}

export function useAgentConnection(
  wsUrl: string,
  token: string,
  enabled = true,
  expectedAgentId?: string,
): AgentConnection {
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [snapshot, setSnapshot] = useState<StateSnapshot | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [chat, setChat] = useState<ChatMessage[]>([])
  const [catalog, setCatalog] = useState<ToolDescriptor[]>([])
  const [heartbeat, setHeartbeat] = useState<string | null>(null)
  const streamRef = useRef<ReturnType<typeof openAgentStream> | null>(null)
  useEffect(() => {
    setSnapshot(null)
    setLogs([])
    setChat([])
    setCatalog([])
    setHeartbeat(null)
    if (!enabled) {
      setStatus('disconnected')
      return
    }
    let pending: LogEntry[] = []
    let frame: ReturnType<typeof setTimeout> | undefined
    const stream = openAgentStream(
      wsUrl,
      token,
      {
        status: setStatus,
        snapshot: (state) => {
          setSnapshot(state)
          if (state) setHeartbeat(new Date().toISOString())
        },
        catalog: setCatalog,
        log: (entry) => {
          pending.push(entry)
          if (pending.length > 500) pending = pending.slice(-500)
          if (!frame)
            frame = setTimeout(() => {
              const batch = pending
              pending = []
              frame = undefined
              setLogs((previous) => [...previous, ...batch].slice(-500))
            }, 50)
        },
        reply: (text, system) =>
          setChat(
            (previous) =>
              [...previous, { id: crypto.randomUUID(), sender: system ? 'system' : 'agent', text }].slice(
                -500,
              ) as ChatMessage[],
          ),
      },
      expectedAgentId,
    )
    streamRef.current = stream
    return () => {
      stream.close()
      clearTimeout(frame)
      streamRef.current = null
    }
  }, [wsUrl, token, enabled, expectedAgentId])
  const sendChat = useCallback((text: string) => {
    const sent = streamRef.current?.sendChat(text) ?? false
    setChat(
      (previous) =>
        [
          ...previous,
          {
            id: crypto.randomUUID(),
            sender: sent ? 'user' : 'system',
            text: sent ? text : 'Not connected to the agent.',
          },
        ].slice(-500) as ChatMessage[],
    )
    return sent
  }, [])
  return { status, snapshot, logs, chat, catalog, heartbeat, sendChat }
}
