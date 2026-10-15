/**
 * StrategySwitch — select a strategy, preview field-level diff, then Apply.
 *
 * Behaviour:
 * - Uses list_strategies catalog
 * - get_strategy for current + target (cached per id, stale-response guard)
 * - Field diff (changed/added/removed, volatile timestamps ignored)
 * - Apply → /api/agents/:id/strategy
 * - If agent is running: shows "takes effect on restart" + optional Apply & Restart
 * - Shows result.error from get_strategy
 */
import { useCallback, useRef, useState } from 'react'
import { strategyDiff } from '../lib/agentViz'
import { fetchJson } from '../lib/api'
import type { ManagedAgent, StrategySummary } from '../lib/ipc'

interface Strategy {
  id: string
  name?: string
  description?: string
  [key: string]: unknown
}

async function getStrategy(name: string, token: string): Promise<Strategy | null> {
  try {
    const res = await fetchJson<{ result?: Strategy; error?: string }>('/api/tool', token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'get_strategy', args: { id: name } }),
    })
    const result = (res as { result?: Strategy }).result
    if (result) return result
    return null
  } catch {
    return null
  }
}

interface Props {
  agent: ManagedAgent
  strategies: StrategySummary[]
  token: string
  onApplied: () => void
  onStop: (id: string) => Promise<void>
  onStart: (id: string) => Promise<void>
}

export function StrategySwitch({ agent, strategies, token, onApplied, onStop, onStart }: Props) {
  const [selected, setSelected] = useState(agent.strategyId ?? '')
  const [loading, setLoading] = useState(false)
  const [diff, setDiff] = useState<ReturnType<typeof strategyDiff> | null>(null)
  const [diffError, setDiffError] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const seqRef = useRef(0)

  const loadDiff = useCallback(
    async (targetId: string) => {
      if (!targetId || targetId === agent.strategyId) {
        setDiff(null)
        setDiffError(null)
        return
      }
      setLoading(true)
      setDiff(null)
      setDiffError(null)
      const seq = ++seqRef.current

      const [current, target] = await Promise.all([
        agent.strategyId ? getStrategy(agent.strategyId, token) : Promise.resolve(null),
        getStrategy(targetId, token),
      ])

      if (seqRef.current !== seq) return // stale response
      setLoading(false)

      if (!target) {
        setDiffError('Could not load target strategy')
        return
      }
      setDiff(strategyDiff(current as Record<string, unknown> | null, target as Record<string, unknown>))
    },
    [agent.strategyId, token],
  )

  const handleSelect = (id: string) => {
    setSelected(id)
    void loadDiff(id)
  }

  const apply = async (opts: { andRestart?: boolean } = {}) => {
    setApplying(true)
    try {
      await fetchJson(`/api/agents/${encodeURIComponent(agent.id)}/strategy`, token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategyId: selected }),
      })
      if (opts.andRestart && agent.running) {
        setRestarting(true)
        await onStop(agent.id)
        // Brief pause then restart — useAgents' 1.5 s reload catches the state change
        await new Promise((r) => setTimeout(r, 500))
        onApplied()
        await onStart(agent.id)
        setRestarting(false)
      }
      setDiff(null)
      onApplied()
    } catch (e) {
      setDiffError(e instanceof Error ? e.message : 'Apply failed')
    } finally {
      setApplying(false)
    }
  }

  const changed = selected && selected !== (agent.strategyId ?? '')

  return (
    <div style={{ marginTop: 12 }}>
      <div className="row">
        <span className="muted small">Strategy</span>
        <select value={selected} onChange={(e) => handleSelect(e.target.value)} aria-label="Select strategy">
          <option value="">— none —</option>
          {strategies.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name ?? s.id}
            </option>
          ))}
        </select>
        {loading && <span className="muted small">Loading diff…</span>}
      </div>

      {diffError && <div className="error small mt">{diffError}</div>}

      {diff != null && diff.length === 0 && changed && <p className="muted small mt">No field differences.</p>}

      {diff != null && diff.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <table className="diff-table">
            <thead>
              <tr>
                <td className="diff-key">Field</td>
                <td className="diff-from">Current</td>
                <td className="diff-to">New</td>
              </tr>
            </thead>
            <tbody>
              {diff.map((row) => (
                <tr key={row.key} className={`diff-row-${row.kind}`}>
                  <td className="diff-key">{row.key}</td>
                  <td className="diff-from">{row.from || <em className="diff-empty">—</em>}</td>
                  <td className="diff-to">{row.to || <em className="diff-empty">—</em>}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {agent.running && <p className="notice">⚠ Strategy change takes effect on restart.</p>}

          <div className="row mt">
            <button type="button" className="primary" disabled={applying || restarting} onClick={() => void apply()}>
              {applying && !restarting ? 'Applying…' : 'Apply'}
            </button>
            {agent.running && (
              <button
                type="button"
                className="ghost"
                disabled={applying || restarting}
                onClick={() => void apply({ andRestart: true })}
                title="Writes the strategy config, stops the agent, then starts it again"
              >
                {restarting ? 'Restarting…' : 'Apply & Restart'}
              </button>
            )}
          </div>
        </div>
      )}

      {changed && diff == null && !loading && (
        <div className="row mt">
          <button type="button" className="primary" disabled={applying} onClick={() => void apply()}>
            {applying ? 'Applying…' : 'Apply'}
          </button>
        </div>
      )}
    </div>
  )
}
