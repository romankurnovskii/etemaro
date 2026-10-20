import { useMemo, useState } from 'react'
import { fmtClock } from '../lib/format'
import { type LogStore, logKey, mergedLogs, SEVERITIES, type Severity, severityOf } from '../lib/logs'

const MAX_RENDERED = 500

export function LogsView({ store }: { store: LogStore }) {
  const [enabled, setEnabled] = useState<Record<Severity, boolean>>({ info: true, warn: true, error: true })
  const [category, setCategory] = useState('')
  const [agent, setAgent] = useState('')
  const [query, setQuery] = useState('')

  const all = useMemo(() => mergedLogs(store), [store])
  const agentIds = useMemo(() => Object.keys(store).sort(), [store])
  const categories = useMemo(() => [...new Set(all.map((r) => r.entry.category))].sort(), [all])
  const counts = useMemo(() => {
    const c: Record<Severity, number> = { info: 0, warn: 0, error: 0 }
    for (const r of all) c[severityOf(r.entry.category)] += 1
    return c
  }, [all])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return all
      .filter((r) => {
        const e = r.entry
        if (!enabled[severityOf(e.category)]) return false
        if (category && e.category !== category) return false
        if (agent && e.agentId !== agent) return false
        return !q || `${e.category} ${e.message}`.toLowerCase().includes(q)
      })
      .slice(-MAX_RENDERED)
      .reverse()
  }, [all, enabled, category, agent, query])

  return (
    <section className="panel">
      <div className="section-head">
        <div>
          <h2>Logs</h2>
          <p className="muted">
            Live stream from the console daemon and every running agent · {all.length} received, newest first.
          </p>
        </div>
      </div>

      <fieldset className="filters">
        <legend className="sr-only">Log filters</legend>
        <fieldset className="sev-toggles">
          <legend className="sr-only">Severity</legend>
          {SEVERITIES.map((s) => (
            <button
              type="button"
              key={s}
              className={`btn btn-sm sev-toggle sev-${s}`}
              aria-pressed={enabled[s]}
              onClick={() => setEnabled((prev) => ({ ...prev, [s]: !prev[s] }))}
            >
              {s} <span className="count">{counts[s]}</span>
            </button>
          ))}
        </fieldset>
        <label className="filter-field">
          <span className="field-label">Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          <span className="field-label">Agent</span>
          <select value={agent} onChange={(e) => setAgent(e.target.value)}>
            <option value="">All agents</option>
            {agentIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field grow">
          <span className="field-label">Search</span>
          <input value={query} placeholder="Filter text" onChange={(e) => setQuery(e.target.value)} />
        </label>
      </fieldset>

      {visible.length === 0 ? (
        <p className="muted">{all.length === 0 ? 'No logs received yet.' : 'No logs match these filters.'}</p>
      ) : (
        <ul className="log-list">
          {visible.map((r) => {
            const sev = severityOf(r.entry.category)
            return (
              <li key={logKey(r)} className={`log-line sev-${sev}`}>
                <span className="ts">{fmtClock(r.entry.ts)}</span>
                <span className={`tag tag-sev-${sev}`}>{sev}</span>
                <span className="agent">{r.entry.agentId}</span>
                <span className="cat">{r.entry.category}</span>
                <span className="msg-text">{r.entry.message}</span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
