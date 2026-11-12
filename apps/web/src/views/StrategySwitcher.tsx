import { useEffect, useState } from 'react'
import type { StrategySummary } from '../lib/ipc'
import { diffStrategies, fetchStrategyDetail, type StrategyDetail, type StrategyDiffRow } from '../lib/strategy'

interface Props {
  agentId: string
  agentName: string
  currentStrategyId: string | null
  strategies: StrategySummary[]
  token: string
  busy: boolean
  onApply: (strategyId: string) => Promise<void>
}

/**
 * Strategy management: select from the live strategy catalog, preview a diff
 * against the agent's current strategy, then apply the switch.
 */
export function StrategySwitcher({ agentId, agentName, currentStrategyId, strategies, token, busy, onApply }: Props) {
  const [open, setOpen] = useState(false)
  const [targetId, setTargetId] = useState('')
  const [currentDetail, setCurrentDetail] = useState<StrategyDetail | null>(null)
  const [targetDetail, setTargetDetail] = useState<StrategyDetail | null>(null)
  const [diff, setDiff] = useState<StrategyDiffRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset the dialog state each time it is (re)opened. Each switcher instance
  // is bound to a single agent card, so agentId never changes within a mount.
  useEffect(() => {
    if (open) {
      setTargetId('')
      setCurrentDetail(null)
      setTargetDetail(null)
      setDiff(null)
      setError(null)
    }
  }, [open])

  const preview = async (id: string) => {
    setTargetId(id)
    setCurrentDetail(null)
    setTargetDetail(null)
    setDiff(null)
    setError(null)
    if (!id || id === currentStrategyId) return
    setLoading(true)
    try {
      const [current, target] = await Promise.all([
        currentStrategyId ? fetchStrategyDetail(token, currentStrategyId).catch(() => null) : Promise.resolve(null),
        fetchStrategyDetail(token, id),
      ])
      setCurrentDetail(current)
      setTargetDetail(target)
      setDiff(diffStrategies(current, target))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load strategy details')
    } finally {
      setLoading(false)
    }
  }

  const apply = async () => {
    if (!targetId) return
    try {
      await onApply(targetId)
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to switch strategy')
    }
  }

  const currentName = strategies.find((s) => s.id === currentStrategyId)?.name ?? currentStrategyId ?? 'none assigned'

  return (
    <div className="strategy-block">
      <div className="row">
        <span className="muted small">Strategy</span>
        <span className="strategy-chip mono" title={currentStrategyId ?? undefined}>
          {currentName}
        </span>
        <button
          type="button"
          className="ghost small-btn"
          onClick={() => setOpen(!open)}
          disabled={strategies.length === 0}
        >
          {open ? 'Close' : 'Switch strategy'}
        </button>
      </div>

      {open ? (
        <div className="strategy-panel mt">
          {strategies.length === 0 ? (
            <p className="muted small">Strategy catalog unavailable (is the daemon running?).</p>
          ) : (
            <>
              <label className="field">
                <span>Target strategy for “{agentName}”</span>
                <select value={targetId} onChange={(e) => void preview(e.target.value)}>
                  <option value="">Select a strategy…</option>
                  {strategies.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name ?? s.id}
                      {s.id === currentStrategyId ? ' (current)' : ''}
                    </option>
                  ))}
                </select>
                <span className="hint">Preview the diff before applying. Nothing changes until you confirm.</span>
              </label>

              {loading ? <p className="muted small">Loading strategy details…</p> : null}
              {error ? <p className="error small">{error}</p> : null}

              {diff ? (
                <div className="diff">
                  <div className="diff-head">
                    <span>Current{currentDetail ? `: ${currentDetail.name ?? currentDetail.id}` : ''}</span>
                    <span>Target: {targetDetail?.name ?? targetId}</span>
                  </div>
                  <table>
                    <thead>
                      <tr>
                        <th>Setting</th>
                        <th>Current</th>
                        <th>Target</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diff.map((row) => (
                        <tr key={row.label} className={row.changed ? 'diff-changed' : ''}>
                          <td>{row.label}</td>
                          <td className="small">{row.from ?? <span className="muted">not set</span>}</td>
                          <td className="small">
                            {row.to ?? <span className="muted">not set</span>}
                            {row.changed ? <span className="diff-flag">changes</span> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {targetDetail?.bestFor ? <p className="muted small mt">Best for: {targetDetail.bestFor}</p> : null}
                  <div className="row mt">
                    <button type="button" className="primary" onClick={() => void apply()} disabled={busy || !targetId}>
                      Apply switch
                    </button>
                    <button type="button" className="ghost" onClick={() => setOpen(false)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
