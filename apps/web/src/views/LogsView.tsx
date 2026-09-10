import { useMemo, useState } from 'react'
import type { LogEntry } from '../lib/ipc'

export function LogsView({ logs }: { logs: LogEntry[] }) {
  const [filter, setFilter] = useState('')
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return logs
    return logs.filter((l) => `${l.category} ${l.message}`.toLowerCase().includes(q))
  }, [logs, filter])

  return (
    <section className="card">
      <h2>Logs ({logs.length})</h2>
      <input value={filter} placeholder="Filter logs" onChange={(e) => setFilter(e.target.value)} />
      <div className="log-list mt">
        {filtered.length === 0 ? (
          <p className="muted small">No logs yet.</p>
        ) : (
          filtered.slice(-400).map((l) => (
            <div className="log-line" key={`${l.ts}-${l.category}-${l.message}`}>
              <span className="ts">{(l.ts || '').slice(11, 19)}</span> <span className="cat">{l.category}</span>{' '}
              {l.message}
            </div>
          ))
        )}
      </div>
    </section>
  )
}
