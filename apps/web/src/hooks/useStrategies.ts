import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchJson } from '../lib/api'
import type { StrategySummary } from '../lib/ipc'

export function useStrategies(token: string): { strategies: StrategySummary[]; reload: () => Promise<void> } {
  const [strategies, setStrategies] = useState<StrategySummary[]>([])
  const sequence = useRef(0)
  const currentToken = useRef(token)
  const mounted = useRef(true)
  currentToken.current = token
  const reload = useCallback(async () => {
    if (!mounted.current || currentToken.current !== token) return
    const request = ++sequence.current
    try {
      const res = await fetchJson<{ result?: { strategies?: StrategySummary[] } }>('/api/tool', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'list_strategies', args: {} }),
      })
      if (mounted.current && currentToken.current === token && request === sequence.current) {
        setStrategies(res.result?.strategies ?? [])
      }
    } catch {
      if (mounted.current && currentToken.current === token && request === sequence.current) setStrategies([])
    }
  }, [token])
  useEffect(() => {
    mounted.current = true
    setStrategies([])
    void reload()
    return () => {
      mounted.current = false
      sequence.current += 1
    }
  }, [reload])
  return { strategies, reload }
}
