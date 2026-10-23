import { useMemo, useState } from 'react'
import type { LogEntry } from '../lib/ipc'
import { logLevel } from '../lib/visualizer'

export function LogsView({ logs }: { logs: LogEntry[] }) {
  const [filter, setFilter] = useState('')
  const [severity, setSeverity] = useState('all')
  const [category, setCategory] = useState('all')
  const categories = [...new Set(logs.map((entry) => entry.category))].sort()
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return logs.filter(
      (entry) =>
        (severity === 'all' || logLevel(entry) === severity) &&
        (category === 'all' || entry.category === category) &&
        `${entry.category} ${entry.message}`.toLowerCase().includes(q),
    )
  }, [logs, filter, severity, category])

  return (
    <section className="card">
      <h2>Logs ({logs.length})</h2>
      <div className="row">
        <input
          aria-label="Search logs"
          value={filter}
          placeholder="Search logs"
          onChange={(e) => setFilter(e.target.value)}
        />
        <label>
          Severity
          <select value={severity} onChange={(event) => setSeverity(event.target.value)}>
            <option value="all">All levels</option>
            <option value="info">Info</option>
            <option value="warn">Warn</option>
            <option value="error">Error</option>
          </select>
        </label>
        <label>
          Category
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="all">All categories</option>
            {categories.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="log-list mt">
        {filtered.length === 0 ? (
          <p className="muted small">No matching logs.</p>
        ) : (
          filtered.slice(-400).map((l) => (
            <div className="log-line" key={`${l.ts}-${l.category}-${l.message}`}>
              <span className={`log-level level-${logLevel(l)}`}>{logLevel(l)}</span>{' '}
              <span className="ts">{(l.ts || '').slice(11, 19)}</span> <span className="cat">{l.category}</span>{' '}
              {l.message}
            </div>
          ))
        )}
      </div>
    </section>
  )
}
