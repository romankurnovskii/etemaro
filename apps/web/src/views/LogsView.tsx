import { useMemo, useState } from 'react'
import { type LogEntry, logSeverity, type Severity } from '../lib/ipc'

export function LogsView({ logs }: { logs: LogEntry[] }) {
  const [filter, setFilter] = useState('')
  const [severity, setSeverity] = useState<Severity | 'all'>('all')
  const [category, setCategory] = useState('all')
  const categories = [...new Set(logs.map((log) => log.category))].sort()
  const filtered = useMemo(
    () =>
      logs.filter((log) => {
        const query = filter.trim().toLowerCase()
        return (
          (!query || `${log.category} ${log.message} ${log.agentId}`.toLowerCase().includes(query)) &&
          (severity === 'all' || logSeverity(log) === severity) &&
          (category === 'all' || category === log.category)
        )
      }),
    [logs, filter, severity, category],
  )
  return (
    <section className="card">
      <div className="section-heading" style={{ marginTop: 0 }}>
        <h2>
          Event stream{' '}
          <span className="count">
            {filtered.length} / {logs.length}
          </span>
        </h2>
        <span className="muted small">Latest 500 events · connected daemon</span>
      </div>
      <div className="log-toolbar">
        <label className="sr-only" htmlFor="log-search">
          Search logs
        </label>
        <input
          id="log-search"
          value={filter}
          placeholder="Search messages, categories or agents"
          onChange={(e) => setFilter(e.target.value)}
        />
        <label className="sr-only" htmlFor="log-severity">
          Severity
        </label>
        <select id="log-severity" value={severity} onChange={(e) => setSeverity(e.target.value as Severity | 'all')}>
          <option value="all">All severities</option>
          <option value="info">Info</option>
          <option value="warn">Warning</option>
          <option value="error">Error</option>
        </select>
        <label className="sr-only" htmlFor="log-category">
          Category
        </label>
        <select id="log-category" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="all">All categories</option>
          {categories.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>
      <section className="log-list" aria-label="Log entries">
        {filtered.length === 0 ? (
          <p className="muted small">
            {logs.length ? 'No events match these filters.' : 'Waiting for events from the daemon.'}
          </p>
        ) : (
          filtered.map((log) => (
            <div className="log-line" key={log.streamId ?? `${log.ts}-${log.category}-${log.message}`}>
              <time className="ts">{log.ts?.slice(11, 19) || '—'}</time>
              <span className={`log-severity ${logSeverity(log)}`}>{logSeverity(log)}</span>
              <span className="category-tag">{log.category}</span>
              <span className="log-message">{log.message}</span>
              <span className="muted small mono">{log.agentId}</span>
            </div>
          ))
        )}
      </section>
    </section>
  )
}
