import { create } from 'zustand'
import { resolveAgentEndpoint } from '../lib/agentLink'
import { DAEMON_URL, fetchJson } from '../lib/api'
import { backoffDelay } from '../lib/backoff'
import { type IpcMessage, IpcMessageType, type LogEntry, type ManagedAgent, type StateSnapshot } from '../lib/ipc'
import { type IpcSocket, openIpcSocket, type SocketStatus } from '../lib/socket'
import { useLogsStore } from './logsStore'

export type LinkState = 'resolving' | SocketStatus | 'unavailable'

/** Live data read from one managed agent's own IPC server. */
export interface AgentTelemetry {
  link: LinkState
  /** Why the link is unavailable / last protocol error. */
  reason: string | null
  /** WebSocket endpoint (no credentials). */
  endpoint: string | null
  snapshot: StateSnapshot | null
  /** Envelope timestamp (ms) of the last message received from this agent. */
  lastMessageAt: number | null
}

const EMPTY: AgentTelemetry = { link: 'resolving', reason: null, endpoint: null, snapshot: null, lastMessageAt: null }

interface TelemetryState {
  byAgent: Record<string, AgentTelemetry>
  /** Reconcile open links with the current set of running agents. */
  sync: (agents: readonly ManagedAgent[], consoleToken: string) => void
  /** Close every link (token change / unmount). */
  reset: () => void
}

type Patch = (id: string, patch: Partial<AgentTelemetry>) => void

const links = new Map<string, { close: () => void }>()
let currentToken = ''

/**
 * Open one agent link: read the instance config through the console daemon to
 * learn the agent's IPC port/token, then connect to it. The resolved token
 * lives only in this closure — never in React state, storage, or logs.
 */
function openAgentLink(id: string, configPath: string, consoleToken: string, patch: Patch): { close: () => void } {
  let cancelled = false
  let socket: IpcSocket | null = null
  let retryTimer: number | undefined
  let attempt = 0
  patch(id, { link: 'resolving', reason: null })

  // A failed config read (e.g. console daemon restarting) is retried with backoff.
  const resolve = () =>
    fetchJson<{ config?: unknown }>(`/api/config?path=${encodeURIComponent(configPath)}`, consoleToken)
      .then((res) => {
        if (cancelled) return
        const endpoint = resolveAgentEndpoint(res?.config, DAEMON_URL, consoleToken)
        if (!endpoint.ok) {
          patch(id, { link: 'unavailable', reason: endpoint.reason })
          return
        }
        patch(id, { endpoint: endpoint.url })
        socket = openIpcSocket(endpoint.url, endpoint.token, {
          onStatus: (link) => patch(id, { link }),
          onMessage: (msg: IpcMessage) => {
            const lastMessageAt = typeof msg.timestamp === 'number' ? msg.timestamp : Date.now()
            if (msg.type === IpcMessageType.STATE_SNAPSHOT) {
              patch(id, { lastMessageAt, reason: null, snapshot: msg.payload as StateSnapshot })
            } else if (msg.type === IpcMessageType.ERROR) {
              const { code, message } = msg.payload as { code?: string; message?: string }
              patch(id, { lastMessageAt, reason: [code, message].filter(Boolean).join(': ') || 'error' })
            } else {
              patch(id, { lastMessageAt })
              if (msg.type === IpcMessageType.LOG_ENTRY) useLogsStore.getState().ingest(msg.payload as LogEntry)
            }
          },
        })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        patch(id, { link: 'unavailable', reason: err instanceof Error ? err.message : String(err) })
        retryTimer = window.setTimeout(resolve, backoffDelay(attempt))
        attempt += 1
      })

  void resolve()

  return {
    close() {
      cancelled = true
      window.clearTimeout(retryTimer)
      socket?.close()
    },
  }
}

/**
 * One IPC connection per *running* managed agent. Logs are forwarded to the
 * shared log store (attributed by their own agentId); snapshots and
 * last-message times are keyed by the managed agent's id.
 */
export const useTelemetryStore = create<TelemetryState>((set) => ({
  byAgent: {},

  sync: (agents, consoleToken) => {
    if (consoleToken !== currentToken) {
      for (const link of links.values()) link.close()
      links.clear()
      currentToken = consoleToken
      set({ byAgent: {} })
    }

    const patch: Patch = (id, p) =>
      set((s) => ({ byAgent: { ...s.byAgent, [id]: { ...(s.byAgent[id] ?? EMPTY), ...p } } }))

    const wanted = new Map(agents.filter((a) => a.running).map((a) => [a.id, a.configPath] as const))

    for (const [id, link] of links) {
      if (wanted.has(id)) continue
      link.close()
      links.delete(id)
      set((s) => {
        const { [id]: _removed, ...rest } = s.byAgent
        return { byAgent: rest }
      })
    }
    for (const [id, configPath] of wanted) {
      if (!links.has(id)) links.set(id, openAgentLink(id, configPath, consoleToken, patch))
    }
  },

  reset: () => {
    for (const link of links.values()) link.close()
    links.clear()
    currentToken = ''
    set({ byAgent: {} })
  },
}))

/** Test seam. */
export function __resetTelemetryLinks(): void {
  for (const link of links.values()) link.close()
  links.clear()
  currentToken = ''
}
