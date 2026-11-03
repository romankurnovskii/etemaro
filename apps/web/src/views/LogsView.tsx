import { useEffect, useMemo, useRef, useState } from 'react'
import { type LogEntry, type LogSeverity, logSeverity } from '../lib/ipc'

const SEVERITIES: LogSeverity[] = ['info', 'warn', 'error']

/**
 * Streaming telemetry log view with severity filtering and category tags.
 * Severities mirror the daemon's structured logger (`*_error` / `*_warn`).
 */
export function LogsView({ logs }: { logs: LogEntry[] }) {
  const [query, setQuery] = useState('')
  const [enabled, setEnabled] = useState<Record<LogSeverity, boolean>>({ info: true, warn: true, error: true })
  const [follow, setFollow] = useState(true)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return logs.filter((l) => {
      if (!enabled[logSeverity(l.category)]) return false
      if (!q) return true
      return `${l.category} ${l.message} ${l.agentId}`.toLowerCase().includes(q)
    })
  }, [logs, query, enabled])

  const visible = filtered.slice(-400)
  const listRef = useRef<HTMLDivElement | null>(null)

  // "follow" keeps the newest entries in view as telemetry streams in.
  useEffect(() => {
    if (!follow) return
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [follow])

  return (
    <section className="card">
      <div className="row logs-toolbar">
        <h2 className="grow">Telemetry ({filtered.length})</h2>
        {SEVERITIES.map((sev) => (
          <button
            type="button"
            key={sev}
            className={`chip chip-${sev}${enabled[sev] ? ' on' : ''}`}
            aria-pressed={enabled[sev]}
            onClick={() => setEnabled((prev) => ({ ...prev, [sev]: !prev[sev] }))}
          >
            {sev}
          </button>
        ))}
      </div>
      <div className="row">
        <input
          value={query}
          placeholder="Filter by message, category, or agent id"
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="follow-toggle">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> follow
        </label>
      </div>
      <div className="log-list mt" ref={listRef}>
        {visible.length === 0 ? (
          <p className="muted small">No log entries match the current filters.</p>
        ) : (
          visible.map((l) => {
            const sev = logSeverity(l.category)
            return (
              <div className={`log-line log-${sev}`} key={`${l.ts}-${l.category}-${l.message}`}>
                <span className="ts">{(l.ts || '').slice(11, 19)}</span>{' '}
                <span className={`sev-tag sev-${sev}`}>{sev}</span> <span className="cat">{l.category}</span>{' '}
                {l.agentId ? <span className="agent-tag">{l.agentId}</span> : null} {l.message}
              </div>
            )
          })
        )}
      </div>
      <p className="muted small mt">
        Streaming over WebSocket with auto-reconnect. Last {visible.length} of {filtered.length} buffered entries.
      </p>
    </section>
  )
}
