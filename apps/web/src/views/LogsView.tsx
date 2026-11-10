import { useMemo, useState } from 'react'
import type { LogEntry } from '../lib/ipc'

export type LogSeverity = 'debug' | 'info' | 'warn' | 'error'

const SEVERITIES: readonly LogSeverity[] = ['debug', 'info', 'warn', 'error']

/**
 * IPC log entries carry no level field. Mirrors the daemon's own mapping in
 * packages/core/src/shared/logger.ts: an exact level name wins, otherwise a
 * category containing "error" / "warn" maps to that level, else info.
 */
export function logSeverity(category: string): LogSeverity {
  if ((SEVERITIES as readonly string[]).includes(category)) return category as LogSeverity
  if (category.includes('error')) return 'error'
  if (category.includes('warn')) return 'warn'
  return 'info'
}

const DEFAULT_SEVERITIES: Record<LogSeverity, boolean> = { debug: false, info: true, warn: true, error: true }

export function LogsView({ logs }: { logs: LogEntry[] }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [enabled, setEnabled] = useState<Record<LogSeverity, boolean>>(DEFAULT_SEVERITIES)

  const counts = useMemo(() => {
    const out: Record<LogSeverity, number> = { debug: 0, info: 0, warn: 0, error: 0 }
    for (const l of logs) out[logSeverity(l.category)] += 1
    return out
  }, [logs])

  const categories = useMemo(() => [...new Set(logs.map((l) => l.category))].sort(), [logs])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return logs.filter((l) => {
      if (!enabled[logSeverity(l.category)]) return false
      if (category && l.category !== category) return false
      return !q || `${l.category} ${l.message}`.toLowerCase().includes(q)
    })
  }, [logs, query, category, enabled])

  const toggle = (s: LogSeverity) => setEnabled((prev) => ({ ...prev, [s]: !prev[s] }))
  const isDefault = !query && !category && SEVERITIES.every((s) => enabled[s] === DEFAULT_SEVERITIES[s])

  return (
    <section className="card">
      <div className="card-head">
        <h2>Logs</h2>
        <span className="spacer" />
        <span className="muted small">
          {filtered.length} of {logs.length}
        </span>
      </div>

      <div className="row">
        <fieldset className="severity-filter">
          <legend className="sr-only">Severity</legend>
          {SEVERITIES.map((s) => (
            <button
              type="button"
              key={s}
              className={`chip sev-${s} ${enabled[s] ? 'on' : ''}`}
              aria-pressed={enabled[s]}
              onClick={() => toggle(s)}
            >
              {s} <span className="chip-count">{counts[s]}</span>
            </button>
          ))}
        </fieldset>
        <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input
          value={query}
          placeholder="Search logs"
          aria-label="Search logs"
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="button"
          className="ghost"
          disabled={isDefault}
          onClick={() => {
            setQuery('')
            setCategory('')
            setEnabled(DEFAULT_SEVERITIES)
          }}
        >
          Reset
        </button>
      </div>

      <div className="log-list mt">
        {logs.length === 0 ? (
          <p className="muted small">No logs yet.</p>
        ) : filtered.length === 0 ? (
          <p className="muted small">No logs match the current filters.</p>
        ) : (
          filtered.slice(-400).map((l) => {
            const sev = logSeverity(l.category)
            return (
              <div className={`log-line sev-${sev}`} key={`${l.ts}-${l.category}-${l.message}`}>
                <span className="ts">{(l.ts || '').slice(11, 19)}</span> <span className="sev-tag">{sev}</span>{' '}
                <button
                  type="button"
                  className="cat"
                  title="Filter by this category"
                  onClick={() => setCategory(l.category)}
                >
                  {l.category}
                </button>{' '}
                {l.message}
              </div>
            )
          })
        )}
      </div>
    </section>
  )
}
