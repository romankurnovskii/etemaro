import { create } from 'zustand'
import { fetchJson } from '../lib/api'
import type { StrategySummary } from '../lib/ipc'

interface StrategiesState {
  strategies: StrategySummary[]
  load: (token: string) => Promise<void>
}

export const useStrategiesStore = create<StrategiesState>((set) => ({
  strategies: [],
  load: async (token) => {
    try {
      const res = await fetchJson<{ result?: { strategies?: StrategySummary[] } }>('/api/tool', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'list_strategies', args: {} }),
      })
      set({ strategies: res.result?.strategies ?? [] })
    } catch {
      // Strategy list is optional chrome; a failure must not break the console.
    }
  },
}))
