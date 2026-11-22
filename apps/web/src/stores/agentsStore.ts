import { create } from 'zustand'
import { fetchJson } from '../lib/api'
import type { ManagedAgent } from '../lib/ipc'

const POLL_INTERVAL_MS = 15_000

interface AgentsState {
  agents: ManagedAgent[]
  /** True once the first /api/agents response (success or failure) arrived. */
  loaded: boolean
  /** Last /api/agents load error, if any. */
  loadError: string | null
  busy: Record<string, boolean>
  /** Last start/stop error per agent id. */
  errors: Record<string, string>
  load: (token: string) => Promise<void>
  create: (token: string, name: string) => Promise<void>
  start: (token: string, id: string) => Promise<void>
  stop: (token: string, id: string) => Promise<void>
  setStrategy: (token: string, id: string, strategyId: string) => Promise<void>
  /** Begin polling; safe to call repeatedly. Returns a stop function. */
  startPolling: (token: string) => () => void
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

let pollTimer: number | undefined
let pollToken = ''

export const useAgentsStore = create<AgentsState>((set, get) => ({
  agents: [],
  loaded: false,
  loadError: null,
  busy: {},
  errors: {},

  load: async (token) => {
    try {
      const res = await fetchJson<{ agents: ManagedAgent[] }>('/api/agents', token)
      set({ agents: res?.agents ?? [], loadError: null })
    } catch (e: unknown) {
      set({ loadError: errorMessage(e) })
    } finally {
      set({ loaded: true })
    }
  },

  create: async (token, name) => {
    await fetchJson('/api/agents', token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    await get().load(token)
  },

  start: async (token, id) => {
    set((s) => ({ busy: { ...s.busy, [id]: true }, errors: omit(s.errors, id) }))
    try {
      await fetchJson(`/api/agents/${encodeURIComponent(id)}/start`, token, { method: 'POST' })
    } catch (e: unknown) {
      set((s) => ({ errors: { ...s.errors, [id]: `start failed: ${errorMessage(e)}` } }))
    } finally {
      await get().load(token)
      set((s) => ({ busy: omit(s.busy, id) }))
    }
  },

  stop: async (token, id) => {
    set((s) => ({ busy: { ...s.busy, [id]: true }, errors: omit(s.errors, id) }))
    try {
      await fetchJson(`/api/agents/${encodeURIComponent(id)}/stop`, token, { method: 'POST' })
    } catch (e: unknown) {
      set((s) => ({ errors: { ...s.errors, [id]: `stop failed: ${errorMessage(e)}` } }))
    } finally {
      await get().load(token)
      set((s) => ({ busy: omit(s.busy, id) }))
    }
  },

  setStrategy: async (token, id, strategyId) => {
    await fetchJson(`/api/agents/${encodeURIComponent(id)}/strategy`, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strategyId }),
    })
    await get().load(token)
  },

  startPolling: (token) => {
    pollToken = token
    void get().load(token)
    if (pollTimer !== undefined) window.clearInterval(pollTimer)
    pollTimer = window.setInterval(() => {
      // Initial load always runs; only the poll skips while the tab is hidden.
      if (document.visibilityState !== 'hidden') void get().load(pollToken)
    }, POLL_INTERVAL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void get().load(pollToken)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      if (pollTimer !== undefined) window.clearInterval(pollTimer)
      pollTimer = undefined
      document.removeEventListener('visibilitychange', onVisible)
    }
  },
}))

function omit<T extends Record<string, unknown>>(record: T, key: string): T {
  const { [key]: _dropped, ...rest } = record
  return rest as T
}
