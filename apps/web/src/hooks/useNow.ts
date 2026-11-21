/**
 * useNow — single shared clock hook. One interval per consumer, replacing N per-component timers.
 */
import { useEffect, useState } from 'react'

export function useNow(intervalMs = 5000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}
