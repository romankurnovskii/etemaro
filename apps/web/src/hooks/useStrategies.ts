import { useCallback, useEffect, useState } from 'react'
import { readTool } from '../lib/api'
import type { StrategySummary } from '../lib/ipc'

export function useStrategies(token: string): {
  strategies: StrategySummary[]
  error: string | null
  reload: () => void
} {
  const [strategies, setStrategies] = useState<StrategySummary[]>([])
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => {
    readTool<{ strategies?: StrategySummary[] }>('list_strategies', {}, token)
      .then((res) => {
        setStrategies(res.strategies ?? [])
        setError(null)
      })
      .catch((e: unknown) => {
        setStrategies([])
        setError(e instanceof Error ? e.message : 'Cannot load strategies')
      })
  }, [token])

  useEffect(() => {
    reload()
  }, [reload])

  return { strategies, error, reload }
}
