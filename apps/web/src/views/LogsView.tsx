import { useMemo, useState } from 'react'
import { type LogSeverity, logSeverity } from '../lib/agentViz'
import type { LogEntry } from '../lib/ipc'

const SEVERITIES: LogSeverity[] = ['info', 'warn', 'error']

export function LogsView({ logs }: { logs: LogEntry[] }) {
  const [filter, setFilter] = useState('')
  const [severity, setSeverity] = useState<LogSeverity | 'all'>('all')
  const [category, setCategory] = useState<string | 'all'>('all')

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const l of logs) if (l.category) set.add(l.category)
    return Array.from(set).sort()
  }, [logs])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return logs.filter((l) => {
      const sev = logSeverity(l)
      if (severity !== 'all' && sev !== severity) return false
      if (category !== 'all' && l.category !== category) return false
      if (!q) return true
      return `${l.category} ${l.message}`.toLowerCase().includes(q)
    })
  }, [logs, filter, severity, category])

  return (
    <section className="card">
      <h2>
        Logs ({filtered.length}
        {filtered.length !== logs.length ? ` / ${logs.length}` : ''})
      </h2>
      <input value={filter} placeholder="Filter logs" onChange={(e) => setFilter(e.target.value)} />
      <div className="filter-chips">
        <button
          type="button"
          className={`chip${severity === 'all' ? ' active' : ''}`}
          onClick={() => setSeverity('all')}
        >
          all
        </button>
        {SEVERITIES.map((s) => (
          <button
            type="button"
            key={s}
            className={`chip sev-${s}${severity === s ? ' active' : ''}`}
            onClick={() => setSeverity(s)}
          >
            {s}
          </button>
        ))}
      </div>
      {categories.length > 0 ? (
        <div className="filter-chips">
          <button
            type="button"
            className={`chip${category === 'all' ? ' active' : ''}`}
            onClick={() => setCategory('all')}
          >
            all categories
          </button>
          {categories.slice(0, 24).map((c) => (
            <button
              type="button"
              key={c}
              className={`chip${category === c ? ' active' : ''}`}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
      ) : null}
      <div className="log-list mt">
        {filtered.length === 0 ? (
          <p className="muted small">No logs yet.</p>
        ) : (
          filtered.slice(-400).map((l) => {
            const sev = logSeverity(l)
            return (
              <div
                className={`log-line sev-${sev}`}
                key={`${l.ts}|${l.agentId}|${l.category}|${l.correlationId ?? ''}|${l.message}`}
              >
                <span className="ts">{(l.ts || '').slice(11, 19)}</span> <span className="tag">{sev}</span>
                <span className="cat">{l.category}</span> {l.message}
              </div>
            )
          })
        )}
      </div>
    </section>
  )
}
