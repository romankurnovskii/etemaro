import { useMemo, useState } from 'react'
import { logSeverity, SEVERITIES, type Severity } from '../lib/agentViz'
import type { LogEntry } from '../lib/ipc'

const toggle = <T,>(set: Set<T>, v: T): Set<T> => {
  const next = new Set(set)
  if (next.has(v)) next.delete(v)
  else next.add(v)
  return next
}

export function LogsView({ logs }: { logs: LogEntry[] }) {
  const [text, setText] = useState('')
  const [severities, setSeverities] = useState<Set<Severity>>(() => new Set(SEVERITIES))
  const [hiddenCats, setHiddenCats] = useState<Set<string>>(() => new Set())
  const [agent, setAgent] = useState('')

  const counts = useMemo(() => {
    const c: Record<Severity, number> = { info: 0, warn: 0, error: 0 }
    for (const l of logs) c[logSeverity(l)]++
    return c
  }, [logs])
  const categories = useMemo(() => [...new Set(logs.map((l) => l.category))].sort(), [logs])
  const agentIds = useMemo(() => [...new Set(logs.map((l) => l.agentId).filter(Boolean))].sort(), [logs])

  const filtered = useMemo(() => {
    const q = text.trim().toLowerCase()
    return logs.filter(
      (l) =>
        severities.has(logSeverity(l)) &&
        !hiddenCats.has(l.category) &&
        (!agent || l.agentId === agent) &&
        (!q || `${l.category} ${l.message}`.toLowerCase().includes(q)),
    )
  }, [logs, text, severities, hiddenCats, agent])

  // Stable keys from content (+ occurrence count for identical lines) rather than array index.
  const shown = useMemo(() => {
    const seen = new Map<string, number>()
    return filtered.slice(-400).map((l) => {
      const base = `${l.ts}|${l.agentId}|${l.category}|${l.message}`
      const n = (seen.get(base) ?? 0) + 1
      seen.set(base, n)
      return { l, key: `${base}#${n}` }
    })
  }, [filtered])

  return (
    <section className="card">
      <h2>
        Logs ({filtered.length}/{logs.length})
      </h2>
      <div className="row">
        <input value={text} placeholder="Filter logs" onChange={(e) => setText(e.target.value)} />
        {agentIds.length > 1 ? (
          <select aria-label="Agent" value={agent} onChange={(e) => setAgent(e.target.value)}>
            <option value="">All agents</option>
            {agentIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      <fieldset className="chips mt">
        <legend className="sr-only">Severity</legend>
        {SEVERITIES.map((s) => (
          <button
            type="button"
            key={s}
            className={`chip chip-${s}${severities.has(s) ? ' on' : ''}`}
            aria-pressed={severities.has(s)}
            onClick={() => setSeverities((prev) => toggle(prev, s))}
          >
            {s} <span className="count">{counts[s]}</span>
          </button>
        ))}
      </fieldset>
      {categories.length > 0 ? (
        <fieldset className="chips mt">
          <legend className="sr-only">Category</legend>
          {categories.map((c) => (
            <button
              type="button"
              key={c}
              className={`chip chip-cat${hiddenCats.has(c) ? '' : ' on'}`}
              aria-pressed={!hiddenCats.has(c)}
              onClick={() => setHiddenCats((prev) => toggle(prev, c))}
            >
              {c}
            </button>
          ))}
        </fieldset>
      ) : null}
      <div className="log-list mt">
        {shown.length === 0 ? (
          <p className="muted small">{logs.length === 0 ? 'No logs yet.' : 'No logs match these filters.'}</p>
        ) : (
          shown.map(({ l, key }) => (
            <div className={`log-line sev-${logSeverity(l)}`} key={key}>
              <span className="ts">{(l.ts || '').slice(11, 19)}</span> <span className="cat">{l.category}</span>{' '}
              {l.message}
            </div>
          ))
        )}
      </div>
    </section>
  )
}
