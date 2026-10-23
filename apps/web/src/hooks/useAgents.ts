import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchJson } from '../lib/api'
import type { ManagedAgent } from '../lib/ipc'

export interface AgentsController {
  agents: ManagedAgent[]
  busy: Record<string, boolean>
  loading: boolean
  error: string | null
  create: (name: string) => Promise<void>
  start: (id: string) => Promise<void>
  stop: (id: string) => Promise<void>
  setStrategy: (id: string, strategyId: string) => Promise<void>
  reload: () => Promise<void>
}

export function useAgents(token: string): AgentsController {
  const [agents, setAgents] = useState<ManagedAgent[]>([])
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const sequence = useRef(0)
  const mounted = useRef(true)
  const currentToken = useRef(token)
  currentToken.current = token

  const reload = useCallback(async () => {
    if (!mounted.current || currentToken.current !== token) return
    const request = ++sequence.current
    try {
      const res = await fetchJson<{ agents: ManagedAgent[] }>('/api/agents', token)
      if (!mounted.current || request !== sequence.current || currentToken.current !== token) return
      setAgents(res.agents ?? [])
      setError(null)
    } catch (e) {
      if (!mounted.current || request !== sequence.current || currentToken.current !== token) return
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (mounted.current && request === sequence.current && currentToken.current === token) setLoading(false)
    }
  }, [token])

  useEffect(() => {
    mounted.current = true
    setAgents([])
    setBusy({})
    setLoading(true)
    setError(null)
    void reload()
    const id = window.setInterval(() => void reload(), 15000)
    return () => {
      mounted.current = false
      sequence.current += 1
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
      if (currentToken.current === token) await reload()
    },
    [token, reload],
  )

  const action = useCallback(
    async (id: string, verb: 'start' | 'stop') => {
      setBusy((prev) => ({ ...prev, [id]: true }))
      try {
        await fetchJson(`/api/agents/${encodeURIComponent(id)}/${verb}`, token, { method: 'POST' })
        if (currentToken.current === token) await reload()
      } finally {
        if (mounted.current && currentToken.current === token)
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
      setBusy((prev) => ({ ...prev, [id]: true }))
      try {
        await fetchJson(`/api/agents/${encodeURIComponent(id)}/strategy`, token, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ strategyId }),
        })
        if (currentToken.current === token) await reload()
      } finally {
        if (mounted.current && currentToken.current === token)
          setBusy((prev) => {
            const next = { ...prev }
            delete next[id]
            return next
          })
      }
    },
    [token, reload],
  )

  return {
    agents,
    busy,
    loading,
    error,
    create,
    start: (id: string) => action(id, 'start'),
    stop: (id: string) => action(id, 'stop'),
    setStrategy,
    reload,
  }
}
