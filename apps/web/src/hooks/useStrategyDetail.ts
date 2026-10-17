import { useEffect, useState } from 'react'
import { fetchJson } from '../lib/api'
import { flatten } from '../lib/telemetry'

interface ToolResponse {
  result?: Record<string, unknown>
}

export function useStrategyDetail(
  token: string,
  id: string | null,
): { flat: Record<string, string> | null; error: string | null } {
  const [flat, setFlat] = useState<Record<string, string> | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setFlat(null)
    setError(null)
    if (!id) return
    let cancelled = false
    fetchJson<ToolResponse>('/api/tool', token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'get_strategy', args: { id } }),
    })
      .then((res) => {
        if (cancelled) return
        const r = res.result ?? {}
        const body = (r.strategy as Record<string, unknown> | undefined) ?? r
        setFlat(flatten(body))
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [token, id])

  return { flat, error }
}
