import { useCallback, useEffect, useState } from 'react'
import { fetchJson } from '../lib/api'
import type { StrategySummary } from '../lib/ipc'

export function useStrategies(token: string): { strategies: StrategySummary[]; reload: () => void } {
  const [strategies, setStrategies] = useState<StrategySummary[]>([])

  const reload = useCallback(() => {
    fetchJson<{ result?: { strategies?: StrategySummary[] } }>('/api/tool', token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'list_strategies', args: {} }),
    })
      .then((res) => setStrategies(res.result?.strategies ?? []))
      .catch(() => {})
  }, [token])

  useEffect(() => {
    reload()
  }, [reload])

  return { strategies, reload }
}
