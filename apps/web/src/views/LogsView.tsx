import { useEffect, useMemo, useRef, useState } from 'react'
import type { LogEntry } from '../lib/ipc'
import { type Severity, severityOf } from '../lib/telemetry'

interface Props {
  logs: LogEntry[]
  onClear: () => void
}

const LEVELS: Severity[] = ['info', 'warn', 'error']

export function LogsView({ logs, onClear }: Props) {
  const [levels, setLevels] = useState<Record<Severity, boolean>>({ info: true, warn: true, error: true })
  const [category, setCategory] = useState('')
  const [query, setQuery] = useState('')
  const [follow, setFollow] = useState(true)
  const listRef = useRef<HTMLDivElement>(null)

  const categories = useMemo(() => Array.from(new Set(logs.map((l) => l.category))).sort(), [logs])
  const counts = useMemo(() => {
    const c: Record<Severity, number> = { info: 0, warn: 0, error: 0 }
    for (const l of logs) c[severityOf(l)]++
    return c
  }, [logs])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return logs.filter((l) => {
      if (!levels[severityOf(l)]) return false
      if (category && l.category !== category) return false
      if (q && !`${l.category} ${l.agentId} ${l.message}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [logs, levels, category, query])

  const visible = useMemo(() => {
    const seen = new Map<string, number>()
    return filtered.slice(-400).map((l) => {
      const base = `${l.ts}|${l.category}|${l.message}`
      const n = (seen.get(base) ?? 0) + 1
      seen.set(base, n)
      return { l, key: `${base}|${n}` }
    })
  }, [filtered])

  // biome-ignore lint/correctness/useExhaustiveDependencies: rerun on new rows to keep the view pinned to the bottom
  useEffect(() => {
    const el = listRef.current
    if (follow && el) el.scrollTop = el.scrollHeight
  }, [follow, visible.length])

  return (
    <section className="card">
      <h2>
        Logs ({filtered.length}/{logs.length})
      </h2>
      <div className="row">
        {LEVELS.map((lv) => (
          <button
            type="button"
            key={lv}
            className={`chip chip-${lv}${levels[lv] ? ' on' : ''}`}
            aria-pressed={levels[lv]}
            onClick={() => setLevels((p) => ({ ...p, [lv]: !p[lv] }))}
          >
            {lv} <span className="count">{counts[lv]}</span>
          </button>
        ))}
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input className="grow" value={query} placeholder="Search" onChange={(e) => setQuery(e.target.value)} />
        <label className="small muted">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow
        </label>
        <button type="button" className="ghost" onClick={onClear}>
          Clear
        </button>
      </div>
      <div className="log-list mt" ref={listRef}>
        {visible.length === 0 ? (
          <p className="muted small">No matching logs.</p>
        ) : (
          visible.map(({ l, key }) => {
            const sev = severityOf(l)
            return (
              <div className={`log-line sev-${sev}`} key={key}>
                <span className="ts">{(l.ts || '').slice(11, 19)}</span>
                <span className={`sev sev-tag-${sev}`}>{sev}</span>
                <span className="cat">{l.category}</span>
                <span className="msg">{l.message}</span>
              </div>
            )
          })
        )}
      </div>
    </section>
  )
}
