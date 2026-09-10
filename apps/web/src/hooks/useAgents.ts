import { useCallback, useEffect, useState } from 'react'
import { fetchJson } from '../lib/api'
import type { ManagedAgent } from '../lib/ipc'

export interface AgentsController {
  agents: ManagedAgent[]
  busy: Record<string, boolean>
  create: (name: string) => Promise<void>
  start: (id: string) => Promise<void>
  stop: (id: string) => Promise<void>
  setStrategy: (id: string, strategyId: string) => Promise<void>
  reload: () => void
}

export function useAgents(token: string): AgentsController {
  const [agents, setAgents] = useState<ManagedAgent[]>([])
  const [busy, setBusy] = useState<Record<string, boolean>>({})

  const reload = useCallback(() => {
    fetchJson<{ agents: ManagedAgent[] }>('/api/agents', token)
      .then((res) => setAgents(res.agents ?? []))
      .catch(() => {})
  }, [token])

  useEffect(() => {
    reload()
    const id = window.setInterval(reload, 15000)
    return () => window.clearInterval(id)
  }, [reload])

  const create = useCallback(
    async (name: string) => {
      await fetchJson('/api/agents', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      reload()
    },
    [token, reload],
  )

  const action = useCallback(
    async (id: string, verb: 'start' | 'stop') => {
      setBusy((prev) => ({ ...prev, [id]: true }))
      try {
        await fetchJson(`/api/agents/${encodeURIComponent(id)}/${verb}`, token, { method: 'POST' })
        reload()
      } finally {
        setBusy((prev) => {
          const next = { ...prev }
          delete next[id]
          return next
        })
      }
    },
    [token, reload],
  )

  const setStrategy = useCallback(
    async (id: string, strategyId: string) => {
      await fetchJson(`/api/agents/${encodeURIComponent(id)}/strategy`, token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategyId }),
      })
      reload()
    },
    [token, reload],
  )

  return {
    agents,
    busy,
    create,
    start: (id: string) => action(id, 'start'),
    stop: (id: string) => action(id, 'stop'),
    setStrategy,
    reload,
  }
}
