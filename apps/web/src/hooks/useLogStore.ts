import { useCallback, useRef, useState } from 'react'
import type { LogEntry } from '../lib/ipc'
import { appendLog, type LogStore } from '../lib/logs'

export interface LogStoreController {
  store: LogStore
  /** Add a log entry from any daemon/agent stream. Stable across renders. */
  ingest: (entry: LogEntry) => void
}

/** All received logs, bucketed by the entry's own agentId. */
export function useLogStore(): LogStoreController {
  const [store, setStore] = useState<LogStore>({})
  const seqRef = useRef(0)

  const ingest = useCallback((raw: LogEntry) => {
    if (!raw || typeof raw.agentId !== 'string' || !raw.agentId) return
    const entry: LogEntry = { ...raw, category: String(raw.category ?? ''), message: String(raw.message ?? '') }
    const record = { seq: seqRef.current++, entry }
    setStore((prev) => appendLog(prev, record))
  }, [])

  return { store, ingest }
}
