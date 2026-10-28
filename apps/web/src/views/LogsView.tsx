import { useMemo, useState } from 'react'
import type { LogEntry } from '../lib/ipc'

type Severity = 'info' | 'warn' | 'error'

function severityOf(entry: LogEntry): Severity {
  const blob = `${entry.category} ${entry.message}`.toLowerCase()
  if (blob.includes('error') || blob.includes('fail')) return 'error'
  if (blob.includes('warn')) return 'warn'
  return 'info'
}

export function LogsView({ logs }: { logs: LogEntry[] }) {
  const [filter, setFilter] = useState('')
  const [severity, setSeverity] = useState<'all' | Severity>('all')
  const [category, setCategory] = useState('all')

  const categories = useMemo(() => {
    const set = new Set(logs.map((l) => l.category).filter(Boolean))
    return ['all', ...Array.from(set).sort()]
  }, [logs])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return logs.filter((l) => {
      if (severity !== 'all' && severityOf(l) !== severity) return false
      if (category !== 'all' && l.category !== category) return false
      if (q && !`${l.category} ${l.message}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [logs, filter, severity, category])

  return (
    <section className="card">
      <h2>Logs ({filtered.length})</h2>
      <div className="row">
        <input value={filter} placeholder="Filter logs" onChange={(e) => setFilter(e.target.value)} />
        <select value={severity} onChange={(e) => setSeverity(e.target.value as 'all' | Severity)}>
          <option value="all">all severity</option>
          <option value="info">info</option>
          <option value="warn">warn</option>
          <option value="error">error</option>
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c === 'all' ? 'all categories' : c}
            </option>
          ))}
        </select>
      </div>
      <div className="log-list mt">
        {filtered.length === 0 ? (
          <p className="muted small">No logs yet.</p>
        ) : (
          filtered.slice(-400).map((l) => (
            <div className={`log-line sev-${severityOf(l)}`} key={`${l.ts}-${l.category}-${l.message}`}>
              <span className="ts">{(l.ts || '').slice(11, 19)}</span> <span className="cat">{l.category}</span>{' '}
              {l.message}
            </div>
          ))
        )}
      </div>
    </section>
  )
}
