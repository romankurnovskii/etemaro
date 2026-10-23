import { useCallback, useEffect, useRef, useState } from 'react'
import type { Decision } from '../lib/ipc'
import { fetchRecentDecisions } from '../lib/tools'

const POLL_INTERVAL_MS = 10_000

export interface DecisionsController {
  decisions: Decision[]
  loading: boolean
  error: string | null
  reload: () => void
}

/**
 * Polls the daemon's get_recent_decisions tool so the visualizer
 * shows what the agent decided, why, and which metrics drove it.
 */
export function useDecisions(endpoint: string, token: string, enabled: boolean, limit = 8): DecisionsController {
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<number | undefined>(undefined)
  const inFlightRef = useRef(false)

  const load = useCallback(async () => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    setLoading(true)
    try {
      const next = await fetchRecentDecisions(endpoint, token, limit)
      setDecisions(next)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load decisions')
    } finally {
      inFlightRef.current = false
      setLoading(false)
    }
  }, [endpoint, token, limit])

  useEffect(() => {
    if (!enabled) {
      setDecisions([])
      setError(null)
      return
    }
    void load()
    timerRef.current = window.setInterval(() => void load(), POLL_INTERVAL_MS)
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
  }, [enabled, load])

  return { decisions, loading, error, reload: () => void load() }
}
