/**
 * Manages the fleet of supervisor-managed agents.
 *
 * Changes in #342:
 * - Exposes `error` (previously swallowed at .catch(() => {}))
 * - Reload fires immediately after start/stop, then again ~1.5 s later
 *   (stop() returns before child exits per AgentSupervisor.ts:148-153)
 * - Poll paused while tab is hidden
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchJson } from '../lib/api'
import type { ManagedAgent } from '../lib/ipc'

export interface AgentsController {
  agents: ManagedAgent[]
  busy: Record<string, boolean>
  error: string | null
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
  const intervalRef = useRef<number | undefined>(undefined)

  const reload = useCallback(() => {
    fetchJson<{ agents: ManagedAgent[] }>('/api/agents', token)
      .then((res) => {
        setAgents(res.agents ?? [])
        setError(null)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load agents'))
  }, [token])

  useEffect(() => {
    reload()
    intervalRef.current = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') reload()
    }, 15000)
    const onVisible = () => reload()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(intervalRef.current)
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
      try {
        await fetchJson(`/api/agents/${encodeURIComponent(id)}/${verb}`, token, { method: 'POST' })
        reload()
        // Second reload after 1.5 s — stop() returns before child has exited
        window.setTimeout(reload, 1500)
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
    create,
    start: (id: string) => action(id, 'start'),
    stop: (id: string) => action(id, 'stop'),
    setStrategy,
    reload,
  }
}
