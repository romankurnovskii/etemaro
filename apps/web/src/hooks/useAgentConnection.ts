/**
 * Console-daemon connection for Dashboard, Tools catalog, and Chat.
 *
 * Refactored in #342:
 * - Uses DaemonSocket (jittered backoff, hard stop on 1008)
 * - Auth errors (NOT_AUTHENTICATED, AUTH_FAILED, AUTH_TIMEOUT) → apiError banner,
 *   never into the chat pane
 * - Exposes retryIn for ConnectionBadge countdown
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { type ChatMessage, IpcMessageType, type LogEntry, type StateSnapshot, type ToolDescriptor } from '../lib/ipc'
import { DaemonSocket } from '../lib/socket'

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'auth-failed'

export interface AgentConnection {
  status: ConnectionStatus
  retryIn: number | null
  apiError: string | null
  snapshot: StateSnapshot | null
  logs: LogEntry[]
  chat: ChatMessage[]
  catalog: ToolDescriptor[]
  sendChat: (text: string) => boolean
}

function nextMessageId(): string {
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

const AUTH_ERROR_CODES = new Set(['AUTH_FAILED', 'AUTH_TIMEOUT', 'NOT_AUTHENTICATED'])

export function useAgentConnection(daemonUrl: string, token: string): AgentConnection {
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [retryIn, setRetryIn] = useState<number | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<StateSnapshot | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [chat, setChat] = useState<ChatMessage[]>([])
  const [catalog, setCatalog] = useState<ToolDescriptor[]>([])
  const sockRef = useRef<DaemonSocket | null>(null)

  useEffect(() => {
    const sock = new DaemonSocket(daemonUrl, token)
    sockRef.current = sock

    sock
      .on('status', (s, ri) => {
        setStatus(s)
        setRetryIn(ri)
        if (s === 'auth-failed') {
          setApiError('Token rejected by daemon. Update the token to reconnect.')
        } else if (s === 'connected') {
          setApiError(null)
        }
      })
      .on('snapshot', (snap) => {
        setSnapshot(snap)
      })
      .on('log', (entry) => {
        setLogs((prev) => [...prev.slice(-499), entry])
      })
      .on('auth-failed', () => {
        setApiError('Token rejected by daemon. Update the token to reconnect.')
      })
      .on('message', (msg) => {
        if (msg.type === IpcMessageType.TOOL_CATALOG) {
          setCatalog((msg.payload as { tools?: ToolDescriptor[] }).tools ?? [])
        } else if (msg.type === IpcMessageType.ACK) {
          const reply = (msg.payload as { reply?: string }).reply
          if (reply) {
            setChat((prev) => [...prev, { id: nextMessageId(), sender: 'agent', text: reply }])
          }
        } else if (msg.type === IpcMessageType.ERROR) {
          const payload = msg.payload as { code?: string; message?: string }
          if (payload.code && AUTH_ERROR_CODES.has(payload.code)) {
            // Auth errors → connection banner, NOT chat
            setApiError(`Auth error: ${payload.message ?? payload.code}`)
          } else {
            setChat((prev) => [
              ...prev,
              { id: nextMessageId(), sender: 'system', text: `Error: ${payload.message ?? 'unknown'}` },
            ])
          }
        }
      })

    sock.installWindowHandlers()
    sock.connect()

    return () => {
      sock.dispose()
      sockRef.current = null
    }
  }, [daemonUrl, token])

  const sendChat = useCallback((text: string) => {
    const sock = sockRef.current
    if (sock?.status !== 'connected') {
      setChat((prev) => [...prev, { id: nextMessageId(), sender: 'system', text: 'Not connected to the agent.' }])
      return false
    }
    sock.send(IpcMessageType.COMMAND_CHAT, { prompt: text })
    setChat((prev) => [...prev, { id: nextMessageId(), sender: 'user', text }])
    return true
  }, [])

  return { status, retryIn, apiError, snapshot, logs, chat, catalog, sendChat }
}
