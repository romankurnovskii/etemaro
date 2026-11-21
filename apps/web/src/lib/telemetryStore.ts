/**
 * External telemetry store keyed by agentId.
 *
 * Design notes:
 * - Ring buffer capped at MAX_LOGS per agent (no unbounded array growth)
 * - Incoming logs go to a pending queue, flushed once per requestAnimationFrame
 *   so N log lines arriving in one tick = 1 React render
 * - Consumed via useSyncExternalStore + per-agent selectors so one agent's log
 *   only re-renders that agent's card
 * - One shared clock (useNow) replaces N individual timers
 */

import { useSyncExternalStore } from 'react'
import type { LogEntry, StateSnapshot } from './ipc'

const MAX_LOGS = 500

export interface AgentTelemetry {
  status: 'connected' | 'connecting' | 'disconnected' | 'auth-failed' | 'no-port'
  snapshot: StateSnapshot | null
  /** Ring buffer — last MAX_LOGS lines, oldest first. */
  logs: LogEntry[]
  /** ms timestamp of the last received message on this socket. */
  lastMessageAt: number | null
  /** Monotonically increasing sequence counter for stable log keys. */
  logSeq: number
}

type Store = Map<string, AgentTelemetry>

function defaultTelemetry(status: AgentTelemetry['status'] = 'connecting'): AgentTelemetry {
  return { status, snapshot: null, logs: [], lastMessageAt: null, logSeq: 0 }
}

// ─── Core store (module singleton) ──────────────────────────────────────────
let store: Store = new Map()
const subscribers = new Set<() => void>()
let pendingLogs: Array<{ agentId: string; entry: LogEntry }> = []
let rafPending = false

function notify(): void {
  for (const fn of subscribers) fn()
}

function flushLogs(): void {
  rafPending = false
  if (pendingLogs.length === 0) return

  const next = new Map(store)
  for (const { agentId, entry } of pendingLogs) {
    if (!next.has(agentId)) continue
    const cur = next.get(agentId)!
    const logs = cur.logs.length >= MAX_LOGS ? [...cur.logs.slice(-(MAX_LOGS - 1)), entry] : [...cur.logs, entry]
    next.set(agentId, {
      ...cur,
      logs,
      lastMessageAt: Date.now(),
      logSeq: cur.logSeq + 1,
    })
  }
  pendingLogs = []
  store = next
  notify()
}

function scheduleFlush(): void {
  if (!rafPending) {
    rafPending = true
    // Use rAF in browser; fall back to setTimeout in test environments
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(flushLogs)
    } else {
      setTimeout(flushLogs, 16)
    }
  }
}

// ─── Public mutation API (called from useFleetTelemetry) ──────────────────────
export const telemetryStore = {
  setStatus(agentId: string, status: AgentTelemetry['status']): void {
    const cur = store.get(agentId) ?? defaultTelemetry(status)
    store = new Map(store).set(agentId, { ...cur, status })
    notify()
  },

  setSnapshot(agentId: string, snapshot: StateSnapshot): void {
    const cur = store.get(agentId) ?? defaultTelemetry()
    store = new Map(store).set(agentId, {
      ...cur,
      snapshot,
      lastMessageAt: Date.now(),
      status: 'connected',
    })
    notify()
  },

  pushLog(agentId: string, entry: LogEntry): void {
    pendingLogs.push({ agentId, entry })
    scheduleFlush()
  },

  init(agentId: string, status: AgentTelemetry['status']): void {
    if (!store.has(agentId)) {
      store = new Map(store).set(agentId, defaultTelemetry(status))
      notify()
    }
  },

  remove(agentId: string): void {
    const next = new Map(store)
    next.delete(agentId)
    pendingLogs = pendingLogs.filter((p) => p.agentId !== agentId)
    store = next
    notify()
  },

  /** Read the entire store (for useSyncExternalStore). */
  getSnapshot(): Store {
    return store
  },

  subscribe(fn: () => void): () => void {
    subscribers.add(fn)
    return () => subscribers.delete(fn)
  },

  /** Reset — for tests only. */
  _reset(): void {
    store = new Map()
    pendingLogs = []
    rafPending = false
    notify()
  },
}

// ─── React hooks ──────────────────────────────────────────────────────────────
/** Subscribe to a single agent's telemetry. Returns a stable reference. */
export function useAgentTelemetry(agentId: string): AgentTelemetry {
  const snap = useSyncExternalStore(telemetryStore.subscribe, telemetryStore.getSnapshot, telemetryStore.getSnapshot)
  return snap.get(agentId) ?? defaultTelemetry('no-port')
}

/** Subscribe to all agents' telemetry at once (for LogsView). */
export function useAllTelemetry(): Store {
  return useSyncExternalStore(telemetryStore.subscribe, telemetryStore.getSnapshot, telemetryStore.getSnapshot)
}
