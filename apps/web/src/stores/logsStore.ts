import { create } from 'zustand'
import type { LogEntry } from '../lib/ipc'
import { appendLog, type LogStore } from '../lib/logs'

interface LogsState {
  /** Log records bucketed by the entry's own `agentId`. */
  store: LogStore
  /** Monotonic receive counter — stable React keys across identical lines. */
  seq: number
  ingest: (entry: LogEntry) => void
  clear: () => void
}

/**
 * Single sink for every log stream (console daemon + each managed agent).
 * Attribution is by the entry's own `agentId`, never by which socket it came from.
 */
export const useLogsStore = create<LogsState>((set) => ({
  store: {},
  seq: 0,
  ingest: (raw) => {
    if (!raw || typeof raw.agentId !== 'string' || !raw.agentId) return
    const entry: LogEntry = { ...raw, category: String(raw.category ?? ''), message: String(raw.message ?? '') }
    set((state) => {
      const record = { seq: state.seq, entry }
      return { store: appendLog(state.store, record), seq: state.seq + 1 }
    })
  },
  clear: () => set({ store: {}, seq: 0 }),
}))
