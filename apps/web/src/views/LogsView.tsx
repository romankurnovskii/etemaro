import { useMemo, useState } from 'react'
import type { LogEntry } from '../lib/ipc'

const LEVELS = ['debug', 'info', 'warn', 'error', 'unknown'] as const
type LogLevel = (typeof LEVELS)[number]

/** Only the producer can report severity; message wording is not evidence. */
export function logLevel(entry: LogEntry): LogLevel {
  const level = (entry as LogEntry & { level?: unknown }).level
  return typeof level === 'string' && LEVELS.includes(level as LogLevel) ? (level as LogLevel) : 'unknown'
}

export function filterLogs(logs: LogEntry[], query: string, category: string | null, level: LogLevel | 'all') {
  const q = query.trim().toLowerCase()
  return logs.filter(
    (entry) =>
      (!q || `${entry.category} ${entry.message}`.toLowerCase().includes(q)) &&
      (category === null || entry.category === category) &&
      (level === 'all' || logLevel(entry) === level),
  )
}

export function LogsView({ logs }: { logs: LogEntry[] }) {
  const [filter, setFilter] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [level, setLevel] = useState<LogLevel | 'all'>('all')
  const categories = useMemo(() => [...new Set(logs.map((entry) => entry.category))].sort(), [logs])
  const filtered = useMemo(() => filterLogs(logs, filter, category, level), [logs, filter, category, level])

  return (
    <section className="card">
      <h2>Logs ({logs.length})</h2>
      <div className="console-log-filters">
        <label htmlFor="console-log-search">
          Search
          <input
            id="console-log-search"
            value={filter}
            placeholder="Filter logs"
            onChange={(e) => setFilter(e.target.value)}
          />
        </label>
        <label htmlFor="console-log-category">
          Category
          <select
            id="console-log-category"
            value={category === null ? '' : `category:${category}`}
            onChange={(event) => setCategory(event.target.value === '' ? null : event.target.value.slice(9))}
          >
            <option value="">All categories</option>
            {category !== null && !categories.includes(category) ? (
              <option value={`category:${category}`}>{category || '(empty category)'} (not in current buffer)</option>
            ) : null}
            {categories.map((name) => (
              <option key={name} value={`category:${name}`}>
                {name || '(empty category)'}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="console-log-level">
          Severity
          <select
            id="console-log-level"
            value={level}
            onChange={(event) => setLevel(event.target.value as LogLevel | 'all')}
          >
            <option value="all">All severities</option>
            {LEVELS.map((name) => (
              <option key={name} value={name}>
                {name === 'unknown' ? 'Unknown / not reported' : name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => {
            setFilter('')
            setCategory(null)
            setLevel('all')
          }}
        >
          Reset filters
        </button>
      </div>
      <p className="muted small" role="status">
        Showing {Math.min(filtered.length, 400)} of {filtered.length} matching logs. Missing severity is unknown.
      </p>
      <div className="log-list mt">
        {filtered.length === 0 ? (
          <p className="muted small">{logs.length === 0 ? 'No logs yet.' : 'No logs match these filters.'}</p>
        ) : (
          filtered.slice(-400).map((l) => (
            <div className="log-line" key={l.clientId ?? `${l.ts}-${l.agentId}-${l.category}-${l.message}`}>
              <span className="ts">{(l.ts || '').slice(11, 19)}</span> <span className="cat">{l.category}</span>{' '}
              <span className={`console-log-level console-log-level-${logLevel(l)}`}>{logLevel(l)}</span> {l.message}
            </div>
          ))
        )}
      </div>
    </section>
  )
}
