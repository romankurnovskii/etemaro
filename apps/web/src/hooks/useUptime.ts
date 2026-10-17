import { useEffect, useRef, useState } from 'react'
import type { ManagedAgent } from '../lib/ipc'

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

export function useRunningSince(agents: ManagedAgent[]): Record<string, number> {
  const ref = useRef<Record<string, number>>({})
  const [, force] = useState(0)
  useEffect(() => {
    let changed = false
    const next = { ...ref.current }
    for (const a of agents) {
      if (a.running && next[a.id] === undefined) {
        next[a.id] = Date.now()
        changed = true
      }
      if (!a.running && next[a.id] !== undefined) {
        delete next[a.id]
        changed = true
      }
    }
    if (changed) {
      ref.current = next
      force((n) => n + 1)
    }
  }, [agents])
  return ref.current
}
