import { useMemo, useState } from 'react'
import { logSeverity } from '../lib/agentViz'
import type { LogEntry, LogSeverity } from '../lib/ipc'

/** Severity filter chips offered above the stream. */
const SEVERITIES: Array<{ id: LogSeverity; label: string }> = [
  { id: 'info', label: 'info' },
  { id: 'warn', label: 'warn' },
  { id: 'error', label: 'error' },
]

/** Maximum lines rendered; older entries stay buffered but unmounted. */
const MAX_RENDERED = 400

export function LogsView({ logs }: { logs: LogEntry[] }) {
  const [filter, setFilter] = useState('')
  const [severities, setSeverities] = useState<Set<LogSeverity>>(new Set())

  const toggleSeverity = (severity: LogSeverity) => {
    setSeverities((prev) => {
      const next = new Set(prev)
      if (next.has(severity)) next.delete(severity)
      else next.add(severity)
      return next
    })
  }

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return logs.filter((l) => {
      if (severities.size > 0 && !severities.has(logSeverity(l))) return false
      if (!q) return true
      return `${l.category} ${l.message}`.toLowerCase().includes(q)
    })
  }, [logs, filter, severities])

  const shown = filtered.slice(-MAX_RENDERED)

  return (
    <section className="card">
      <div className="logs-toolbar">
        <h2>
          Logs <span className="muted">({filtered.length})</span>
        </h2>
        <div className="row">
          <input value={filter} placeholder="Filter logs" onChange={(e) => setFilter(e.target.value)} />
          <fieldset className="severity-chips">
            <legend className="sr-only">Filter by severity</legend>
            {SEVERITIES.map((severity) => (
              <button
                type="button"
                key={severity.id}
                className={`chip chip-${severity.id}${severities.has(severity.id) ? ' chip-on' : ''}`}
                aria-pressed={severities.has(severity.id)}
                onClick={() => toggleSeverity(severity.id)}
              >
                {severity.label}
              </button>
            ))}
          </fieldset>
        </div>
      </div>
      <div className="log-list mt">
        {shown.length === 0 ? (
          <p className="muted small">No logs match the current filters.</p>
        ) : (
          shown.map((l) => (
            <div className={`log-line log-${logSeverity(l)}`} key={`${l.ts}-${l.category}-${l.message}`}>
              <span className="ts">{(l.ts || '').slice(11, 19)}</span> <span className="cat">{l.category}</span>{' '}
              {l.message}
            </div>
          ))
        )}
      </div>
    </section>
  )
}
