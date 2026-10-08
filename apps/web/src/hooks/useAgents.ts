import { useCallback, useEffect, useState } from 'react'
import { fetchJson } from '../lib/api'
import type { ManagedAgent } from '../lib/ipc'

const POLL_INTERVAL_MS = 15_000

export interface AgentsController {
  agents: ManagedAgent[]
  /** True once the first /api/agents response (success or failure) arrived. */
  loaded: boolean
  /** Last /api/agents load error, if any. */
  loadError: string | null
  busy: Record<string, boolean>
  /** Last start/stop error per agent id. */
  errors: Record<string, string>
  create: (name: string) => Promise<void>
  start: (id: string) => Promise<void>
  stop: (id: string) => Promise<void>
  setStrategy: (id: string, strategyId: string) => Promise<void>
  reload: () => void
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function useAgents(token: string): AgentsController {
  const [agents, setAgents] = useState<ManagedAgent[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  const reload = useCallback(() => {
    fetchJson<{ agents: ManagedAgent[] }>('/api/agents', token)
      .then((res) => {
        setAgents(res?.agents ?? [])
        setLoadError(null)
      })
      .catch((e: unknown) => setLoadError(errorMessage(e)))
      .finally(() => setLoaded(true))
  }, [token])

  // Initial load always runs, whatever the tab visibility; only the poll skips while hidden.
  useEffect(() => {
    reload()
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') reload()
    }, POLL_INTERVAL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') reload()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
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
      setErrors(({ [id]: _cleared, ...rest }) => rest)
      try {
        await fetchJson(`/api/agents/${encodeURIComponent(id)}/${verb}`, token, { method: 'POST' })
      } catch (e: unknown) {
        setErrors((prev) => ({ ...prev, [id]: `${verb} failed: ${errorMessage(e)}` }))
      } finally {
        reload()
        setBusy(({ [id]: _done, ...rest }) => rest)
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
    loaded,
    loadError,
    busy,
    errors,
    create,
    start: (id: string) => action(id, 'start'),
    stop: (id: string) => action(id, 'stop'),
    setStrategy,
    reload,
  }
}
