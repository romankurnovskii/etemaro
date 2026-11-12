import { useEffect, useRef, useState } from 'react'
import {
  type AgentPhase,
  assetSplit,
  type DiffLine,
  diffMaps,
  flattenStrategy,
  fleetStatus,
  formatAgo,
  formatUptime,
  inferPhase,
  lastDecision,
  lastHeartbeat,
  phaseIndex,
  pipelinePhases,
  primaryPool,
  shortAddr,
} from '../lib/agentViz'
import { fetchJson } from '../lib/api'
import type { LogEntry, ManagedAgent, StateSnapshot, StrategySummary } from '../lib/ipc'

interface Props {
  agents: ManagedAgent[]
  busy: Record<string, boolean>
  strategies: StrategySummary[]
  snapshot: StateSnapshot | null
  logs: LogEntry[]
  token: string
  onCreate: (name: string) => Promise<void>
  onStart: (id: string) => Promise<void>
  onStop: (id: string) => Promise<void>
  onSetStrategy: (id: string, strategyId: string) => Promise<void>
  onCreateStrategy: () => void
}

export function AgentsView(props: Props) {
  const [name, setName] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const seenRunning = useRef<Record<string, string>>({})

  useEffect(() => {
    const now = new Date().toISOString()
    for (const a of props.agents) {
      if (a.running && !seenRunning.current[a.id]) seenRunning.current[a.id] = now
      if (!a.running) delete seenRunning.current[a.id]
    }
  }, [props.agents])

  useEffect(() => {
    if (!selectedId && props.agents[0]) setSelectedId(props.agents[0].id)
    else if (selectedId && !props.agents.some((a) => a.id === selectedId)) {
      setSelectedId(props.agents[0]?.id ?? null)
    }
  }, [props.agents, selectedId])

  const selected = props.agents.find((a) => a.id === selectedId) ?? null

  const submit = () => {
    const value = name.trim()
    if (!value) return
    void props.onCreate(value).then(() => setName(''))
  }

  return (
    <>
      <section className="card">
        <h2>New agent</h2>
        <div className="row">
          <input
            value={name}
            placeholder="Agent name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
          />
          <button type="button" className="primary" onClick={submit}>
            Create agent
          </button>
        </div>
        <p className="muted small">
          Creates an agent configured for dry-run. Start it below to enter the visualizer loop.
        </p>
      </section>

      <p className="section-title">Fleet overview</p>
      {props.agents.length === 0 ? (
        <section className="card">
          <p className="muted">No agents yet — create one above.</p>
        </section>
      ) : (
        <div className="fleet-grid">
          {props.agents.map((agent) => {
            const phase = inferPhase(agent, props.snapshot, props.logs)
            const status = fleetStatus(agent, phase, props.logs)
            const hb = lastHeartbeat(props.logs, agent.id)
            const positions = props.snapshot?.positions ?? []
            return (
              <article key={agent.id} className={`agent-card${selectedId === agent.id ? ' selected' : ''}`}>
                <button type="button" className="agent-card-select" onClick={() => setSelectedId(agent.id)}>
                  <div className="agent-card-head">
                    <span className={`status-dot status-${status}`} />
                    <div className="grow">
                      <strong>{agent.name}</strong>
                      <div className="muted small mono">{agent.id}</div>
                    </div>
                    <span className={`agent-status-pill ${status}`}>{status}</span>
                  </div>
                  <div className="agent-meta">
                    <div>
                      <div className="k">Strategy</div>
                      <div className="v mono">{agent.strategyId || '—'}</div>
                    </div>
                    <div>
                      <div className="k">Pair / pool</div>
                      <div className="v">{agent.running ? primaryPool(positions) : '—'}</div>
                    </div>
                    <div>
                      <div className="k">Uptime</div>
                      <div className="v">{formatUptime(seenRunning.current[agent.id] ?? null, agent.running)}</div>
                    </div>
                    <div>
                      <div className="k">Heartbeat</div>
                      <div className="v">{formatAgo(hb)}</div>
                    </div>
                  </div>
                </button>
                <div className="row">
                  {agent.running ? (
                    <button
                      type="button"
                      className="danger"
                      disabled={props.busy[agent.id]}
                      onClick={() => void props.onStop(agent.id)}
                    >
                      Stop
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="primary"
                      disabled={props.busy[agent.id]}
                      onClick={() => void props.onStart(agent.id)}
                    >
                      Start
                    </button>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}

      {selected ? (
        <AgentInspector
          agent={selected}
          busy={Boolean(props.busy[selected.id])}
          strategies={props.strategies}
          snapshot={props.snapshot}
          logs={props.logs}
          token={props.token}
          onStart={() => void props.onStart(selected.id)}
          onStop={() => void props.onStop(selected.id)}
          onSetStrategy={(strategyId) => props.onSetStrategy(selected.id, strategyId)}
          onCreateStrategy={props.onCreateStrategy}
        />
      ) : null}
    </>
  )
}

function AgentInspector({
  agent,
  busy,
  strategies,
  snapshot,
  logs,
  token,
  onStart,
  onStop,
  onSetStrategy,
  onCreateStrategy,
}: {
  agent: ManagedAgent
  busy: boolean
  strategies: StrategySummary[]
  snapshot: StateSnapshot | null
  logs: LogEntry[]
  token: string
  onStart: () => void
  onStop: () => void
  onSetStrategy: (strategyId: string) => Promise<void>
  onCreateStrategy: () => void
}) {
  const phase = inferPhase(agent, snapshot, logs)
  const status = fleetStatus(agent, phase, logs)
  const positions = snapshot?.positions ?? []
  const split = assetSplit(positions)
  const exec = lastDecision(logs, agent.id)
  const idx = phaseIndex(phase)

  const [pendingStrategy, setPendingStrategy] = useState(agent.strategyId ?? '')
  const [diffLines, setDiffLines] = useState<DiffLine[] | null>(null)
  const [diffBusy, setDiffBusy] = useState(false)
  const [diffError, setDiffError] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    setPendingStrategy(agent.strategyId ?? '')
    setDiffLines(null)
    setDiffError(null)
  }, [agent.strategyId])

  const previewSwitch = async (nextId: string) => {
    setPendingStrategy(nextId)
    if (!nextId || nextId === (agent.strategyId ?? '')) {
      setDiffLines(null)
      setDiffError(null)
      return
    }
    setDiffBusy(true)
    setDiffError(null)
    try {
      const [curRes, nextRes] = await Promise.all([
        agent.strategyId
          ? fetchJson<{ result?: Record<string, unknown> }>('/api/tool', token, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: 'get_strategy', args: { id: agent.strategyId } }),
            })
          : Promise.resolve({ result: {} as Record<string, unknown> }),
        fetchJson<{ result?: Record<string, unknown> }>('/api/tool', token, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'get_strategy', args: { id: nextId } }),
        }),
      ])
      const from = flattenStrategy((curRes.result ?? {}) as Record<string, unknown>)
      const to = flattenStrategy((nextRes.result ?? {}) as Record<string, unknown>)
      if ((nextRes.result as { error?: string } | undefined)?.error) {
        setDiffError(String((nextRes.result as { error: string }).error))
        setDiffLines(null)
      } else {
        setDiffLines(diffMaps(from, to))
      }
    } catch (e) {
      setDiffError(e instanceof Error ? e.message : String(e))
      setDiffLines(null)
    } finally {
      setDiffBusy(false)
    }
  }

  const applyStrategy = async () => {
    if (!pendingStrategy || pendingStrategy === (agent.strategyId ?? '')) return
    setApplying(true)
    try {
      await onSetStrategy(pendingStrategy)
      setDiffLines(null)
    } finally {
      setApplying(false)
    }
  }

  return (
    <>
      <p className="section-title mt">Agent topology — {agent.name}</p>
      <section className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <span className={`status-dot status-${status}`} />
            <strong>{agent.name}</strong> <span className={`agent-status-pill ${status}`}>{status}</span>
          </div>
          {agent.running ? (
            <button type="button" className="danger" disabled={busy} onClick={onStop}>
              Stop
            </button>
          ) : (
            <button type="button" className="primary" disabled={busy} onClick={onStart}>
              Start
            </button>
          )}
        </div>

        <div className="pipeline mt">
          {pipelinePhases().map((p, i) => (
            <div className="pipeline-step" key={p}>
              <span
                className={`pipeline-node${agent.running && i < idx ? ' done' : ''}${
                  agent.running && p === phase ? ' current' : ''
                }`}
              >
                {labelPhase(p)}
              </span>
              {i < pipelinePhases().length - 1 ? <span className="pipeline-arrow">→</span> : null}
            </div>
          ))}
        </div>
        {!agent.running ? <p className="muted small mt">Start the agent to animate the Idle → Settled loop.</p> : null}
      </section>

      <div className="inspect-layout">
        <section className="card">
          <h2>Position metrics</h2>
          {positions.length === 0 ? (
            <p className="muted small">No open positions in the live snapshot.</p>
          ) : (
            <>
              <table>
                <thead>
                  <tr>
                    <th>Pair</th>
                    <th>Bins</th>
                    <th>Range</th>
                    <th className="num">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p) => {
                    const bins =
                      p.lowerBin != null && p.upperBin != null
                        ? `${p.lowerBin}–${p.upperBin}${p.activeBin != null ? ` @${p.activeBin}` : ''}`
                        : '—'
                    const inRange = p.inRange == null ? '—' : p.inRange ? 'in-range' : 'out-of-range'
                    return (
                      <tr key={p.positionAddress || p.poolAddress}>
                        <td>{p.tokenSymbol ?? shortAddr(p.poolAddress)}</td>
                        <td className="mono small">{bins}</td>
                        <td className={p.inRange === false ? 'neg' : p.inRange ? 'pos' : ''}>{inRange}</td>
                        <td className="num">${Number(p.valueUsd ?? 0).toFixed(2)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <p className="muted small mt">Asset split</p>
              <div className="asset-bars">
                {split.map((s) => (
                  <div className="asset-bar-row" key={s.label}>
                    <span className="mono">{s.label}</span>
                    <div className="asset-bar-track">
                      <div className="asset-bar-fill" style={{ width: `${Math.max(2, s.pct)}%` }} />
                    </div>
                    <span className="muted">{s.pct.toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="card">
          <h2>Execution summary</h2>
          <div className="agent-meta">
            <div>
              <div className="k">Last decision</div>
              <div className="v">{exec.decision}</div>
            </div>
            <div>
              <div className="k">Last tool</div>
              <div className="v mono">{exec.tool}</div>
            </div>
            <div>
              <div className="k">Confidence</div>
              <div className="v">{exec.confidence}</div>
            </div>
            <div>
              <div className="k">Daemon busy</div>
              <div className="v">{snapshot?.busy ? 'yes' : 'no'}</div>
            </div>
            <div>
              <div className="k">Next screen</div>
              <div className="v">{fmtTime(snapshot?.nextScreenAt)}</div>
            </div>
            <div>
              <div className="k">Next manage</div>
              <div className="v">{fmtTime(snapshot?.nextManageAt)}</div>
            </div>
          </div>
        </section>
      </div>

      <section className="card">
        <h2>Strategy management</h2>
        <div className="row">
          <span className="muted small">Strategy</span>
          <select
            value={pendingStrategy}
            onChange={(e) => void previewSwitch(e.target.value)}
            disabled={diffBusy || applying}
          >
            <option value="">— none —</option>
            {strategies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name ?? s.id}
                {s.active ? ' (active)' : ''}
              </option>
            ))}
          </select>
          <button type="button" className="ghost" onClick={onCreateStrategy}>
            Create strategy
          </button>
        </div>
        {diffBusy ? <p className="muted small mt">Loading strategy preview…</p> : null}
        {diffError ? <p className="error mt">{diffError}</p> : null}
        {diffLines ? (
          <div className="diff-panel">
            <p className="muted small">
              Preview diff before switching from <span className="mono">{agent.strategyId || 'none'}</span> →{' '}
              <span className="mono">{pendingStrategy}</span>
            </p>
            <pre>
              {diffLines.map((line) => (
                <div key={`${line.kind}:${line.text}`} className={`diff-line-${line.kind}`}>
                  {line.text}
                </div>
              ))}
            </pre>
            <div className="diff-actions">
              <button type="button" className="primary" disabled={applying} onClick={() => void applyStrategy()}>
                {applying ? 'Applying…' : 'Apply strategy'}
              </button>
              <button
                type="button"
                className="ghost"
                disabled={applying}
                onClick={() => {
                  setPendingStrategy(agent.strategyId ?? '')
                  setDiffLines(null)
                  setDiffError(null)
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </>
  )
}

function labelPhase(p: AgentPhase): string {
  return p.charAt(0).toUpperCase() + p.slice(1)
}

function fmtTime(iso: string | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString()
}
