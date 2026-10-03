/**
 * LogsView — severity + category filters, agent selector, text filter, autoscroll.
 *
 * Changes in #342:
 * - Severity chips with counts (error/warn/info — mirrors daemon logger rule)
 * - Category chips (area prefix groups)
 * - Agent selector (all sockets via useAllTelemetry)
 * - Text filter
 * - Stable keys via per-socket sequence number
 * - Only last 400 lines rendered
 * - Pause/resume autoscroll
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { logSeverity } from '../lib/agentViz'
import type { LogEntry, ManagedAgent } from '../lib/ipc'
import { useAllTelemetry } from '../lib/telemetryStore'

interface Props {
  logs: LogEntry[] // global console-daemon logs
  agents: ManagedAgent[]
}

export function LogsView({ logs, agents }: Props) {
  const allTelemetry = useAllTelemetry()
  const [agentFilter, setAgentFilter] = useState<string>('all')
  const [sevFilter, setSevFilter] = useState<Set<string>>(new Set(['error', 'warn', 'info']))
  const [catFilter, setCatFilter] = useState<string>('')
  const [textFilter, setTextFilter] = useState('')
  const [paused, setPaused] = useState(false)
  const listRef = useRef<HTMLDivElement | null>(null)

  // Combine global logs + per-agent logs based on filter selection
  const sourceLogs = useMemo<Array<LogEntry & { _key: string }>>(() => {
    let combined: LogEntry[]
    if (agentFilter === 'all') {
      // Global logs + all agent telemetry logs
      const agentLogs = [...allTelemetry.values()].flatMap((t) => t.logs)
      combined = [...logs, ...agentLogs].sort((a, b) => (a.ts > b.ts ? 1 : -1))
    } else {
      combined = allTelemetry.get(agentFilter)?.logs ?? []
    }
    // Deduplicate — include agentId so lines from different agents don't collapse.
    const seen = new Set<string>()
    return combined
      .filter((l) => {
        const key = `${l.agentId ?? 'global'}|${l.ts}|${l.category}|${l.message}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .map((l, i) => ({ ...l, _key: `${i}-${l.ts}-${l.category}` }))
  }, [logs, allTelemetry, agentFilter])

  // Severity counts
  const counts = useMemo(() => {
    const c = { error: 0, warn: 0, info: 0 }
    for (const l of sourceLogs) {
      const sev = logSeverity(l)
      c[sev]++
    }
    return c
  }, [sourceLogs])

  // All categories for chip list
  const categories = useMemo(() => {
    const cats = new Set<string>()
    for (const l of sourceLogs) {
      const base = l.category.replace(/_(warn|error)$/, '')
      cats.add(base)
    }
    return [...cats].sort()
  }, [sourceLogs])

  const filtered = useMemo(() => {
    const q = textFilter.trim().toLowerCase()
    const catQ = catFilter.trim().toLowerCase()
    return sourceLogs.filter((l) => {
      if (!sevFilter.has(logSeverity(l))) return false
      if (catQ && !l.category.toLowerCase().includes(catQ)) return false
      if (q && !`${l.category} ${l.message}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [sourceLogs, sevFilter, catFilter, textFilter])

  const rendered = filtered.slice(-400)

  // Autoscroll
  useEffect(() => {
    if (!paused) {
      const el = listRef.current
      if (el) el.scrollTop = el.scrollHeight
    }
  }, [paused])

  const toggleSev = (s: string) => {
    setSevFilter((prev) => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })
  }

  return (
    <section className="card" aria-label="Log stream">
      <h2>Logs</h2>

      <div className="log-filters">
        {/* Severity chips */}
        {(['error', 'warn', 'info'] as const).map((s) => (
          <button
            key={s}
            type="button"
            className={`chip sev-${s}${sevFilter.has(s) ? ' active' : ''}`}
            onClick={() => toggleSev(s)}
            aria-pressed={sevFilter.has(s)}
          >
            {s} ({counts[s]})
          </button>
        ))}

        {/* Agent filter */}
        <select
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
          aria-label="Filter by agent"
          style={{ fontSize: 12, padding: '2px 6px' }}
        >
          <option value="all">All agents</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>

        {/* Category chip select */}
        <select
          value={catFilter}
          onChange={(e) => setCatFilter(e.target.value)}
          aria-label="Filter by category"
          style={{ fontSize: 12, padding: '2px 6px' }}
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        {/* Text filter */}
        <input
          value={textFilter}
          placeholder="Search…"
          onChange={(e) => setTextFilter(e.target.value)}
          style={{ fontSize: 12, padding: '2px 8px', width: 140 }}
          aria-label="Filter log text"
        />

        <button
          type="button"
          className={`chip${paused ? ' active' : ''}`}
          onClick={() => setPaused((p) => !p)}
          aria-pressed={paused}
        >
          {paused ? 'Resume' : 'Pause'}
        </button>
      </div>

      <div className="log-list" ref={listRef} aria-live="polite" aria-atomic="false">
        {rendered.length === 0 ? (
          <p className="muted small">No logs matching filters.</p>
        ) : (
          rendered.map((l) => {
            const sev = logSeverity(l)
            return (
              <div key={l._key} className={`log-line sev-${sev}`}>
                <span className="ts">{(l.ts || '').slice(11, 19)}</span>
                <span className="cat">{l.category}</span>
                <span>{l.message}</span>
              </div>
            )
          })
        )}
      </div>
    </section>
  )
}
