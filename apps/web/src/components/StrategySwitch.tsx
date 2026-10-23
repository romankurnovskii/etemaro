import { useRef, useState } from 'react'
import { fetchJson } from '../lib/api'
import type { ManagedAgent, StrategySummary } from '../lib/ipc'
import { type DiffRow, diffObjects, unwrapStrategy } from '../lib/strategyDiff'

interface Props {
  agent: ManagedAgent
  strategies: StrategySummary[]
  token: string
  onApply: (id: string, strategyId: string) => Promise<void>
}

interface Preview {
  target: string
  rows: DiffRow[]
  hadCurrent: boolean
}

function getStrategy(id: string, token: string): Promise<unknown> {
  return fetchJson<unknown>('/api/tool', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'get_strategy', args: { id } }),
  }).then(unwrapStrategy)
}

const clip = (v: string) => (v.length > 90 ? `${v.slice(0, 90)}…` : v)

export function StrategySwitch({ agent, strategies, token, onApply }: Props) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)

  const choose = (target: string) => {
    const mine = ++seq.current // ignore responses from an older selection
    setError(null)
    setPreview(null)
    if (!target) return
    setLoading(true)
    Promise.all([
      agent.strategyId ? getStrategy(agent.strategyId, token) : Promise.resolve(null),
      getStrategy(target, token),
    ])
      .then(([before, after]) => {
        if (mine !== seq.current) return
        setPreview({ target, rows: diffObjects(before, after), hadCurrent: before !== null })
      })
      .catch((e: unknown) => {
        if (mine === seq.current) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (mine === seq.current) setLoading(false)
      })
  }

  const cancel = () => {
    seq.current++
    setPreview(null)
    setError(null)
    setLoading(false)
  }

  const apply = async () => {
    if (!preview) return
    setApplying(true)
    try {
      await onApply(agent.id, preview.target)
      cancel()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setApplying(false)
    }
  }

  const options = strategies.filter((s) => s.id !== agent.strategyId)

  return (
    <div className="switch">
      <div className="row">
        <select
          aria-label={`Switch strategy for ${agent.name}`}
          value={preview?.target ?? ''}
          disabled={loading || applying || options.length === 0}
          onChange={(e) => choose(e.target.value)}
        >
          <option value="">{options.length === 0 ? 'No other strategies' : 'Switch strategy…'}</option>
          {options.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name ?? s.id}
            </option>
          ))}
        </select>
        {loading ? <span className="muted small">Loading preview…</span> : null}
      </div>
      {error ? <p className="error small">{error}</p> : null}
      {preview ? (
        <div className="diff">
          <div className="diff-head">
            <span>
              <span className="mono">{agent.strategyId ?? 'none'}</span> →{' '}
              <span className="mono">{preview.target}</span>
            </span>
            <span className="muted small">
              {preview.rows.length === 0
                ? 'No differences'
                : `${preview.rows.length} change${preview.rows.length === 1 ? '' : 's'}`}
            </span>
          </div>
          {preview.rows.length > 0 ? (
            <div className="diff-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Current</th>
                    <th>New</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.path} className={`diff-${r.kind}`}>
                      <td className="mono">{r.path}</td>
                      <td className="mono">{r.kind === 'added' ? '—' : clip(r.before)}</td>
                      <td className="mono">{r.kind === 'removed' ? '—' : clip(r.after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <div className="row mt">
            <button type="button" className="primary" disabled={applying} onClick={() => void apply()}>
              {applying ? 'Applying…' : `Apply to ${agent.name}`}
            </button>
            <button type="button" className="ghost" disabled={applying} onClick={cancel}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
