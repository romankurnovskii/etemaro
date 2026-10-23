import { useEffect, useState } from 'react'
import { useAgentConnection } from '../hooks/useAgentConnection'
import { fetchJson, WS_URL } from '../lib/api'
import type { ManagedAgent, PositionSummary, StrategySummary } from '../lib/ipc'
import { agentWsUrl, assetSplit, binProgress, elapsed, type StrategyChange, strategyChanges } from '../lib/visualizer'

interface Props {
  token: string
  error: string | null
  agents: ManagedAgent[]
  busy: Record<string, boolean>
  strategies: StrategySummary[]
  onCreate: (name: string) => Promise<void>
  onStart: (id: string) => Promise<void>
  onStop: (id: string) => Promise<void>
  onSetStrategy: (id: string, strategyId: string) => Promise<void>
  onCreateStrategy: () => void
}
const PHASES = ['idle', 'evaluating', 'rebalancing', 'settled'] as const
const money = (value: number | undefined) =>
  typeof value === 'number' && Number.isFinite(value)
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
    : 'Not reported'

export function AgentsView(props: Props) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [filter, setFilter] = useState('all')
  const running = props.agents.filter((agent) => agent.running).length
  const submit = async () => {
    if (!name.trim()) return
    setCreating(true)
    setError('')
    try {
      await props.onCreate(name.trim())
      setName('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setCreating(false)
    }
  }
  return (
    <>
      <section className="fleet-heading">
        <div>
          <div className="eyebrow">AGENTS / VISUALIZER</div>
          <h2>Your fleet, at a glance.</h2>
          <p className="muted">Live state from each agent’s own daemon connection.</p>
        </div>
        <div className="fleet-count">
          <strong>{running}</strong>
          <span>running / {props.agents.length} configured</span>
        </div>
      </section>
      <section className="card">
        <form
          className="row"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <label className="grow">
            New agent
            <input value={name} placeholder="Agent name" onChange={(event) => setName(event.target.value)} />
          </label>
          <button type="submit" className="primary" disabled={creating || !name.trim()}>
            {creating ? 'Creating…' : 'Create dry-run agent'}
          </button>
          <label>
            Show
            <select value={filter} onChange={(event) => setFilter(event.target.value)}>
              <option value="all">All agents</option>
              <option value="running">Running</option>
              <option value="stopped">Stopped</option>
            </select>
          </label>
        </form>
        {error || props.error ? (
          <p className="error" role="alert">
            {error || props.error}
          </p>
        ) : null}
      </section>
      <div className="agent-grid">
        {props.agents
          .filter((agent) => filter === 'all' || agent.running === (filter === 'running'))
          .map((agent) => (
            <AgentCard key={agent.id} {...props} agent={agent} />
          ))}
      </div>
      {!props.agents.length ? (
        <section className="card empty-state">
          No agents available. Create a dry-run agent or check daemon access.
        </section>
      ) : null}
    </>
  )
}

function AgentCard({ agent, ...props }: Props & { agent: ManagedAgent }) {
  const endpoint = agentWsUrl(agent, WS_URL)
  const conn = useAgentConnection(endpoint ?? '', props.token, Boolean(endpoint), agent.id)
  const [target, setTarget] = useState('')
  const [preview, setPreview] = useState<{ current: string | null; target: string; changes: StrategyChange[] } | null>(
    null,
  )
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    setPreview(null)
    setError('')
    setPending(false)
    if (!target || target === agent.strategyId) return
    const controller = new AbortController()
    setPending(true)
    const read = async (id: string | null) => {
      if (!id) return null
      const response = await fetchJson<{ result?: Record<string, unknown> }>('/api/tool', props.token, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'get_strategy', args: { id } }),
      })
      if (!response.result || response.result.error)
        throw new Error(String(response.result?.error ?? 'Strategy details unavailable'))
      return response.result
    }
    Promise.all([read(agent.strategyId), read(target)])
      .then(([before, after]) => {
        if (!controller.signal.aborted)
          setPreview({ current: agent.strategyId, target, changes: strategyChanges(before, after) })
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (!controller.signal.aborted) setPending(false)
      })
    return () => controller.abort()
  }, [target, agent.strategyId, props.token])
  const act = async (operation: () => Promise<void>) => {
    setPending(true)
    setError('')
    setNotice('')
    try {
      await operation()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setPending(false)
    }
  }
  const state = conn.snapshot
  const phase = state?.phase
  const status = !agent.running
    ? 'stopped'
    : conn.status === 'error' || conn.status === 'unauthorized' || phase === 'error'
      ? 'error'
      : phase === 'idle' || phase === 'settled'
        ? 'idle'
        : 'running'
  const currentStrategy = state?.activeStrategyId ?? 'Not reported'
  const disabled = pending || props.busy[agent.id]
  return (
    <section className="card agent-card" aria-label={`Agent ${agent.name}`}>
      <div className="agent-row">
        <div className="grow">
          <div className="eyebrow">{agent.id}</div>
          <h3>{agent.name}</h3>
        </div>
        <span className={`agent-status state-${status}`}>{status}</span>
        <button
          type="button"
          className={agent.running ? 'danger' : 'primary'}
          disabled={disabled}
          onClick={() => void act(() => (agent.running ? props.onStop(agent.id) : props.onStart(agent.id)))}
        >
          {agent.running ? 'Stop' : 'Start'}
        </button>
      </div>
      <div className="agent-meta">
        <span>
          Uptime <strong>{agent.running ? elapsed(agent.startedAt ?? state?.startedAt, now) : '—'}</strong>
        </span>
        <span>
          Last heartbeat <strong>{conn.heartbeat ? `${elapsed(conn.heartbeat, now)} ago` : 'None'}</strong>
        </span>
      </div>
      <p className={`small ${conn.status === 'unauthorized' ? 'error' : 'muted'}`}>
        {!agent.running
          ? 'Agent stopped; no live telemetry.'
          : !endpoint
            ? 'Dedicated IPC port not reported. Update the daemon to expose it.'
            : conn.status === 'unauthorized'
              ? 'Agent token rejected. Update the access token.'
              : `Telemetry: ${conn.status}`}
      </p>
      <ol className="pipeline" aria-label="Reported agent loop phase">
        {PHASES.map((step) => (
          <li key={step} className={step === phase ? 'current' : ''} aria-current={step === phase ? 'step' : undefined}>
            {step}
          </li>
        ))}
      </ol>
      <p className="muted small">{phase ? `Reported phase: ${phase}` : 'Loop phase not reported by this daemon.'}</p>
      <dl className="agent-details">
        <div>
          <dt>Configured strategy</dt>
          <dd>{agent.strategyId ?? 'None'}</dd>
        </div>
        <div>
          <dt>Runtime strategy</dt>
          <dd>{currentStrategy}</dd>
        </div>
        <div>
          <dt>Open PnL</dt>
          <dd>{money(state?.totalPnlUsd)}</dd>
        </div>
        <div>
          <dt>Last tool</dt>
          <dd>{state?.lastTool ? `${state.lastTool.name} · ${state.lastTool.status}` : 'Not reported'}</dd>
        </div>
      </dl>
      <div className="decision">
        <span className="eyebrow">LAST DECISION</span>
        <p>{state?.lastDecision?.summary ?? 'Not reported'}</p>
        <span className="muted small">
          Confidence:{' '}
          {state?.lastDecision?.confidence != null
            ? `${Math.round(state.lastDecision.confidence * 100)}% (reported)`
            : 'Not reported'}
        </span>
      </div>
      <div className="positions">
        {state?.positions.length ? (
          state.positions.map((position) => <Position key={position.positionAddress} position={position} />)
        ) : (
          <p className="muted small">{state ? 'No open positions.' : 'Position data unavailable.'}</p>
        )}
      </div>
      <div className="strategy-panel">
        <label>
          Choose a strategy
          <select
            aria-label={`Strategy for ${agent.name}`}
            value={target || agent.strategyId || ''}
            disabled={disabled}
            onChange={(event) => {
              setTarget(event.target.value)
              setNotice('')
            }}
          >
            <option value="">Select strategy</option>
            {props.strategies.map((strategy) => (
              <option key={strategy.id} value={strategy.id}>
                {strategy.name ?? strategy.id}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="ghost" onClick={props.onCreateStrategy}>
          New strategy
        </button>
      </div>
      {preview ? (
        <section className="strategy-preview" aria-label={`Strategy preview for ${agent.name}`}>
          <h4>Review strategy change</h4>
          <p>
            <code>{preview.current ?? 'None'}</code> → <code>{preview.target}</code>
          </p>
          <div className="diff-list">
            {preview.changes.map((change) => (
              <div key={change.path}>
                <strong>{change.path}</strong>
                <del>{change.before}</del>
                <ins>{change.after}</ins>
              </div>
            ))}
          </div>
          <p className="muted small">
            Saves configuration. A running agent keeps its runtime strategy until you stop and start it.
          </p>
          <div className="row">
            <button
              type="button"
              className="ghost"
              disabled={pending}
              onClick={() => {
                setTarget('')
                setPreview(null)
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              disabled={disabled || preview.current !== agent.strategyId}
              onClick={() =>
                void act(async () => {
                  await props.onSetStrategy(agent.id, preview.target)
                  setNotice('Strategy configuration saved. Restart a running agent to load it.')
                  setTarget('')
                  setPreview(null)
                })
              }
            >
              Apply configuration
            </button>
          </div>
        </section>
      ) : null}
      {pending ? (
        <p role="status" className="muted small">
          Working…
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
    </section>
  )
}

function Position({ position }: { position: PositionSummary }) {
  const split = assetSplit(position)
  const progress = binProgress(position)
  const complete = progress != null
  const range = progress ?? 0
  return (
    <article className="position-card">
      <strong>{position.tokenSymbol ?? 'Position'}</strong>
      <div className="muted small mono" title={position.poolAddress}>
        Pool: {position.poolAddress}
      </div>
      <div className="row">
        <span>{money(position.valueUsd)}</span>
        <span className={position.inRange === false ? 'error' : 'muted'}>
          {position.inRange == null ? 'Range not reported' : position.inRange ? 'In range' : 'Out of range'}
        </span>
      </div>
      {complete ? (
        <>
          <div
            className="range-bar"
            role="img"
            aria-label={`Bins ${position.lowerBin} to ${position.upperBin}, active ${position.activeBin}`}
          >
            <span style={{ left: `${range}%` }} />
          </div>
          <div className="range-labels">
            <span>{position.lowerBin}</span>
            <strong>Active {position.activeBin}</strong>
            <span>{position.upperBin}</span>
          </div>
        </>
      ) : null}
      {split == null ? (
        <p className="muted small">Asset split not reported.</p>
      ) : (
        <>
          <div
            className="split-bar"
            role="img"
            aria-label={`Asset value split X ${split.toFixed(1)}%, Y ${(100 - split).toFixed(1)}%`}
          >
            <span style={{ width: `${split}%` }} />
          </div>
          <p className="muted small">
            Value split · X {split.toFixed(1)}% / Y {(100 - split).toFixed(1)}%
          </p>
        </>
      )}
    </article>
  )
}
