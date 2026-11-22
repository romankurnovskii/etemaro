import { create } from 'zustand'
import {
  type ChatMessage,
  type IpcMessage,
  IpcMessageType,
  type LogEntry,
  type StateSnapshot,
  type ToolDescriptor,
} from '../lib/ipc'
import { type IpcSocket, openIpcSocket, type SocketStatus } from '../lib/socket'
import { useLogsStore } from './logsStore'

export type ConnectionStatus = SocketStatus

interface ConnectionState {
  status: ConnectionStatus
  /** Last protocol error from the daemon (e.g. AUTH_FAILED), cleared once authenticated data arrives. */
  lastError: string | null
  /** True when the daemon rejected our credentials — the header surfaces the token field. */
  authFailed: boolean
  snapshot: StateSnapshot | null
  catalog: ToolDescriptor[]
  chat: ChatMessage[]
  connect: (wsUrl: string, token: string) => void
  disconnect: () => void
  sendChat: (text: string) => boolean
}

let socket: IpcSocket | null = null
let messageSeq = 0

function nextMessageId(): string {
  messageSeq += 1
  return `m-${Date.now()}-${messageSeq}`
}

function isAuthError(code: string | undefined, message: string | undefined): boolean {
  return code === 'AUTH_FAILED' || code === 'UNAUTHORIZED' || /auth|token/i.test(message ?? '')
}

/**
 * Connection to the console daemon's own WebSocket (the process serving this UI).
 * Managed agents are separate processes — see `telemetryStore`.
 */
export const useConnectionStore = create<ConnectionState>((set) => ({
  status: 'connecting',
  lastError: null,
  authFailed: false,
  snapshot: null,
  catalog: [],
  chat: [],

  connect: (wsUrl, token) => {
    socket?.close()
    set({ status: 'connecting', lastError: null, authFailed: false, snapshot: null, catalog: [] })

    const handleMessage = (msg: IpcMessage) => {
      switch (msg.type) {
        case IpcMessageType.STATE_SNAPSHOT:
          set({ lastError: null, authFailed: false, snapshot: msg.payload as StateSnapshot })
          break
        case IpcMessageType.LOG_ENTRY:
          useLogsStore.getState().ingest(msg.payload as LogEntry)
          break
        case IpcMessageType.TOOL_CATALOG:
          // Only sent after successful auth.
          set({
            lastError: null,
            authFailed: false,
            catalog: (msg.payload as { tools?: ToolDescriptor[] }).tools ?? [],
          })
          break
        case IpcMessageType.ACK: {
          const reply = (msg.payload as { reply?: string }).reply
          if (reply) set((s) => ({ chat: [...s.chat, { id: nextMessageId(), sender: 'agent', text: reply }] }))
          break
        }
        case IpcMessageType.ERROR: {
          const { code, message } = msg.payload as { code?: string; message?: string }
          const authFailed = isAuthError(code, message)
          set((s) => ({
            lastError: code ? `${code}: ${message ?? ''}` : (message ?? 'unknown error'),
            authFailed: s.authFailed || authFailed,
            chat: [...s.chat, { id: nextMessageId(), sender: 'system', text: `Error: ${message ?? 'unknown'}` }],
          }))
          break
        }
        default:
          break
      }
    }

    socket = openIpcSocket(wsUrl, token, { onStatus: (status) => set({ status }), onMessage: handleMessage })
  },

  disconnect: () => {
    socket?.close()
    socket = null
    set({ status: 'disconnected' })
  },

  sendChat: (text) => {
    const sent = socket?.send(IpcMessageType.COMMAND_CHAT, { prompt: text }) ?? false
    if (!sent) {
      set((s) => ({
        chat: [...s.chat, { id: nextMessageId(), sender: 'system', text: 'Not connected to the agent.' }],
      }))
      return false
    }
    set((s) => ({ chat: [...s.chat, { id: nextMessageId(), sender: 'user', text }] }))
    return true
  },
}))

/** Test seam: drop the module-level socket without touching store state. */
export function __resetConnectionSocket(): void {
  socket?.close()
  socket = null
}
