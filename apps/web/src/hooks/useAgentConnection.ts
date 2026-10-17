import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type ChatMessage,
  type IpcMessage,
  IpcMessageType,
  type LogEntry,
  type StateSnapshot,
  type ToolDescriptor,
} from '../lib/ipc'
import { type IpcSocket, openIpcSocket, type SocketStatus } from '../lib/socket'

export type ConnectionStatus = SocketStatus

export interface AgentConnection {
  status: ConnectionStatus
  /** Last protocol error from the daemon (e.g. AUTH_FAILED), cleared once authenticated data arrives. */
  lastError: string | null
  snapshot: StateSnapshot | null
  chat: ChatMessage[]
  catalog: ToolDescriptor[]
  sendChat: (text: string) => boolean
}

function nextMessageId(): string {
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** Connection to the console daemon's own WebSocket (the process serving this UI). */
export function useAgentConnection(wsUrl: string, token: string, onLog: (entry: LogEntry) => void): AgentConnection {
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [lastError, setLastError] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<StateSnapshot | null>(null)
  const [chat, setChat] = useState<ChatMessage[]>([])
  const [catalog, setCatalog] = useState<ToolDescriptor[]>([])
  const socketRef = useRef<IpcSocket | null>(null)
  const onLogRef = useRef(onLog)
  onLogRef.current = onLog

  useEffect(() => {
    const handleMessage = (msg: IpcMessage) => {
      if (msg.type === IpcMessageType.STATE_SNAPSHOT) {
        setLastError(null)
        setSnapshot(msg.payload as StateSnapshot)
      } else if (msg.type === IpcMessageType.LOG_ENTRY) {
        onLogRef.current(msg.payload as LogEntry)
      } else if (msg.type === IpcMessageType.TOOL_CATALOG) {
        // Only sent after successful auth.
        setLastError(null)
        setCatalog((msg.payload as { tools?: ToolDescriptor[] }).tools ?? [])
      } else if (msg.type === IpcMessageType.ACK) {
        const reply = (msg.payload as { reply?: string }).reply
        if (reply) setChat((prev) => [...prev, { id: nextMessageId(), sender: 'agent', text: reply }])
      } else if (msg.type === IpcMessageType.ERROR) {
        const { code, message } = msg.payload as { code?: string; message?: string }
        setLastError(code ? `${code}: ${message ?? ''}` : (message ?? 'unknown error'))
        setChat((prev) => [...prev, { id: nextMessageId(), sender: 'system', text: `Error: ${message ?? 'unknown'}` }])
      }
    }

    setLastError(null)
    const socket = openIpcSocket(wsUrl, token, { onStatus: setStatus, onMessage: handleMessage })
    socketRef.current = socket
    return () => {
      socket.close()
      socketRef.current = null
    }
  }, [wsUrl, token])

  const sendChat = useCallback((text: string) => {
    const sent = socketRef.current?.send(IpcMessageType.COMMAND_CHAT, { prompt: text }) ?? false
    if (!sent) {
      setChat((prev) => [...prev, { id: nextMessageId(), sender: 'system', text: 'Not connected to the agent.' }])
      return false
    }
    setChat((prev) => [...prev, { id: nextMessageId(), sender: 'user', text }])
    return true
  }, [])

  return { status, lastError, snapshot, chat, catalog, sendChat }
}
