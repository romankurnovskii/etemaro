import { useMemo, useState } from 'react'
import { extractCategories, logSeverity } from '../lib/agentViz'
import type { LogEntry, LogSeverity } from '../lib/ipc'

const SEVERITIES: Array<{ id: LogSeverity; label: string }> = [
  { id: 'info', label: 'Info' },
  { id: 'warn', label: 'Warn' },
  { id: 'error', label: 'Error' },
]

const MAX_RENDERED = 500

export function LogsView({ logs }: { logs: LogEntry[] }) {
  const [filter, setFilter] = useState('')
  const [severities, setSeverities] = useState<Set<LogSeverity>>(new Set())
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)

  const toggleSeverity = (sev: LogSeverity) => {
    setSeverities((prev) => {
      const next = new Set(prev)
      if (next.has(sev)) next.delete(sev)
      else next.add(sev)
      return next
    })
  }

  const availableCategories = useMemo(() => extractCategories(logs), [logs])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return logs.filter((l) => {
      if (severities.size > 0 && !severities.has(logSeverity(l))) return false
      if (selectedCategory && l.category !== selectedCategory) return false
      if (!q) return true
      return `${l.category} ${l.message}`.toLowerCase().includes(q)
    })
  }, [logs, filter, severities, selectedCategory])

  const shown = filtered.slice(-MAX_RENDERED)

  return (
    <section className="card">
      <div className="section-head">
        <div>
          <h2>Telemetry & Streaming Logs</h2>
          <span className="muted small">
            Showing {shown.length} of {logs.length} events
          </span>
        </div>
      </div>

      <div className="logs-toolbar mt">
        <div className="row">
          <input
            value={filter}
            placeholder="Search log text or metadata…"
            onChange={(e) => setFilter(e.target.value)}
            style={{ flex: '1 1 240px' }}
          />

          <div className="severity-chip-group">
            {SEVERITIES.map((sev) => {
              const active = severities.has(sev.id)
              return (
                <button
                  type="button"
                  key={sev.id}
                  className={`chip chip-${sev.id}${active ? ' chip-active' : ''}`}
                  onClick={() => toggleSeverity(sev.id)}
                >
                  {sev.label}
                </button>
              )
            })}
          </div>

          {(severities.size > 0 || selectedCategory || filter) && (
            <button
              type="button"
              className="ghost small"
              onClick={() => {
                setSeverities(new Set())
                setSelectedCategory(null)
                setFilter('')
              }}
            >
              Reset Filters
            </button>
          )}
        </div>

        {availableCategories.length > 0 && (
          <div className="category-tags-strip mt">
            <span className="muted tiny">Category Tags:</span>
            <div className="category-tag-chips">
              <button
                type="button"
                className={`tag-chip${selectedCategory === null ? ' tag-chip-active' : ''}`}
                onClick={() => setSelectedCategory(null)}
              >
                All
              </button>
              {availableCategories.map((cat) => (
                <button
                  type="button"
                  key={cat}
                  className={`tag-chip${selectedCategory === cat ? ' tag-chip-active' : ''}`}
                  onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="log-list mt">
        {shown.length === 0 ? (
          <p className="muted small p-4">No log entries match the current filter criteria.</p>
        ) : (
          shown.map((l) => {
            const sev = logSeverity(l)
            return (
              <div className={`log-line log-line-${sev}`} key={`${l.ts}-${l.category}-${l.message}`}>
                <span className="ts mono">{(l.ts || '').slice(11, 19)}</span>{' '}
                <button
                  type="button"
                  className="cat-badge"
                  onClick={() => setSelectedCategory(l.category)}
                  title="Filter by this category"
                >
                  {l.category}
                </button>{' '}
                <span className="log-msg">{l.message}</span>
              </div>
            )
          })
        )}
      </div>
    </section>
  )
}
