import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchJson } from '../lib/api'
import type { StrategySummary } from '../lib/ipc'

export function useStrategies(token: string): { strategies: StrategySummary[]; reload: () => void } {
  const generation = useRef(0)
  const [strategies, setStrategies] = useState<StrategySummary[]>([])

  const reload = useCallback(() => {
    const request = ++generation.current
    fetchJson<{ result?: { strategies?: StrategySummary[] } }>('/api/tool', token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'list_strategies', args: {} }),
    })
      .then((res) => {
        if (request === generation.current) setStrategies(res.result?.strategies ?? [])
      })
      .catch(() => {})
  }, [token])

  useEffect(() => {
    setStrategies([])
    reload()
    return () => {
      generation.current++
    }
  }, [reload])

  return { strategies, reload }
}
