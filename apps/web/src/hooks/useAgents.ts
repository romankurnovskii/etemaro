import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchJson } from '../lib/api'
import type { ManagedAgent } from '../lib/ipc'

export interface AgentsController {
  agents: ManagedAgent[]
  busy: Record<string, boolean>
  error: string | null
  loading: boolean
  create: (name: string) => Promise<void>
  start: (id: string) => Promise<void>
  stop: (id: string) => Promise<void>
  setStrategy: (id: string, strategyId: string) => Promise<void>
  reload: () => void
}

export function useAgents(token: string): AgentsController {
  const [agents, setAgents] = useState<ManagedAgent[]>([])
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const request = useRef<AbortController | null>(null)

  const reload = useCallback(() => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    fetchJson<{ agents: ManagedAgent[] }>('/api/agents', token, { signal: controller.signal })
      .then((res) => {
        if (controller.signal.aborted) return
        setAgents(res.agents ?? [])
        setError(null)
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Cannot load agents')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
  }, [token])

  useEffect(() => {
    setAgents([])
    setLoading(true)
    reload()
    const id = window.setInterval(reload, 15000)
    return () => {
      request.current?.abort()
      window.clearInterval(id)
    }
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
    error,
    loading,
    create,
    start: (id: string) => action(id, 'start'),
    stop: (id: string) => action(id, 'stop'),
    setStrategy,
    reload,
  }
}
