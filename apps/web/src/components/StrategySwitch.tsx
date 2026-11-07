import { useMemo, useState } from 'react'
import { useStrategyDetail } from '../hooks/useStrategyDetail'
import type { ManagedAgent, StrategySummary } from '../lib/ipc'
import { diffFlat } from '../lib/telemetry'

interface Props {
  agent: ManagedAgent
  strategies: StrategySummary[]
  token: string
  onApply: (id: string, strategyId: string) => Promise<void>
}

export function StrategySwitch({ agent, strategies, token, onApply }: Props) {
  const [target, setTarget] = useState('')
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const current = useStrategyDetail(token, agent.strategyId)
  const next = useStrategyDetail(token, target || null)

  const rows = useMemo(
    () => (current.flat && next.flat ? diffFlat(current.flat, next.flat) : null),
    [current.flat, next.flat],
  )
  const options = strategies.filter((s) => s.id !== agent.strategyId)

  const apply = async () => {
    setApplying(true)
    setError(null)
    try {
      await onApply(agent.id, target)
      setTarget('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="strategy-switch">
      <div className="row">
        <label className="muted small" htmlFor={`strat-${agent.id}`}>
          Switch strategy
        </label>
        <select id={`strat-${agent.id}`} value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Select…</option>
          {options.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name ?? s.id}
            </option>
          ))}
        </select>
      </div>
      {target ? (
        <div className="diff mt">
          <div className="diff-head">
            <span className="mono">{agent.strategyId ?? 'none'}</span>
            <span className="muted">→</span>
            <span className="mono">{target}</span>
          </div>
          {next.error || current.error ? (
            <p className="error small">Could not load strategy details: {next.error ?? current.error}</p>
          ) : !rows ? (
            <p className="muted small">Loading diff…</p>
          ) : rows.length === 0 ? (
            <p className="muted small">No differences in strategy parameters.</p>
          ) : (
            <table className="diff-table">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Current</th>
                  <th>New</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td className="mono">{r.key}</td>
                    <td className="mono diff-before">{r.before ?? '—'}</td>
                    <td className="mono diff-after">{r.after ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {agent.running ? (
            <p className="warn mt">Agent is running; the new strategy applies to its next cycle.</p>
          ) : null}
          {error ? <p className="error small">{error}</p> : null}
          <div className="row mt">
            <button type="button" className="primary" disabled={applying} onClick={() => void apply()}>
              {applying ? 'Applying…' : 'Apply strategy'}
            </button>
            <button type="button" className="ghost" onClick={() => setTarget('')}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
