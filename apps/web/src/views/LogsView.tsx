import { useMemo, useState } from 'react'
import type { LogEntry } from '../lib/ipc'

export function LogsView({ logs }: { logs: LogEntry[] }) {
  const [filter, setFilter] = useState('')
  const [severity, setSeverity] = useState('all')
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return logs.filter((l) => {
      const level = /error|fail|blocked/i.test(l.category)
        ? 'error'
        : /warn|degraded/i.test(l.category)
          ? 'warn'
          : 'info'
      return (severity === 'all' || level === severity) && `${l.category} ${l.message}`.toLowerCase().includes(q)
    })
  }, [logs, filter, severity])

  return (
    <section className="card">
      <h2>Logs ({logs.length})</h2>
      <input value={filter} placeholder="Filter logs" onChange={(e) => setFilter(e.target.value)} />
      <select aria-label="Severity" value={severity} onChange={(e) => setSeverity(e.target.value)}>
        <option value="all">All severities</option>
        <option value="info">Info</option>
        <option value="warn">Warn</option>
        <option value="error">Error</option>
      </select>
      <div className="log-list mt">
        {filtered.length === 0 ? (
          <p className="muted small">No logs yet.</p>
        ) : (
          filtered.slice(-400).map((l) => (
            <div className="log-line" key={`${l.ts}-${l.category}-${l.message}-${l.correlationId ?? ''}`}>
              <span className="ts">{(l.ts || '').slice(11, 19)}</span> <span className="cat">{l.category}</span>{' '}
              {l.message}
            </div>
          ))
        )}
      </div>
    </section>
  )
}
