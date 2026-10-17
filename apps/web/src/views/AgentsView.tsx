import { useEffect, useRef, useState } from 'react'
import { useAgentConnection } from '../hooks/useAgentConnection'
import { agentWsUrl, fetchJson } from '../lib/api'
import type { ManagedAgent, PositionSummary, StrategySummary } from '../lib/ipc'

interface Props {
  agents: ManagedAgent[]
  busy: Record<string, boolean>
  strategies: StrategySummary[]
  token: string
  loading?: boolean
  loadError?: string | null
  onCreate: (name: string) => Promise<void>
  onStart: (id: string) => Promise<void>
  onStop: (id: string) => Promise<void>
  onSetStrategy: (id: string, strategyId: string) => Promise<void>
  onCreateStrategy: () => void
}

export function strategyDiff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const ignored = new Set(['id', 'name', 'is_active', 'addedAt'])
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .sort()
    .filter((key) => !ignored.has(key) && JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => ({ key, before: before[key], after: after[key] }))
}

export function elapsed(iso: string | number | null | undefined, now: number): string {
  const timestamp = typeof iso === 'number' ? iso : iso ? Date.parse(iso) : Number.NaN
  if (!Number.isFinite(timestamp)) return 'Not reported'
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000))
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}

export const LOOP_PHASES = ['Idle', 'Evaluating', 'Rebalancing', 'Settled'] as const

export function positionRange(position: PositionSummary) {
  const { lowerBin, upperBin, activeBin } = position
  if (
    !Number.isInteger(lowerBin) ||
    !Number.isInteger(upperBin) ||
    lowerBin == null ||
    upperBin == null ||
    lowerBin > upperBin
  )
    return null
  const active = Number.isInteger(activeBin) && activeBin != null ? activeBin : null
  return {
    lowerBin,
    upperBin,
    activeBin: active,
    inRange: active == null ? (position.inRange ?? null) : active >= lowerBin && active <= upperBin,
    marker:
      active == null
        ? null
        : lowerBin === upperBin
          ? 50
          : Math.max(0, Math.min(100, ((active - lowerBin) / (upperBin - lowerBin)) * 100)),
  }
}

export function confidenceLabel(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? `${(value * 100).toFixed(0)}%`
    : 'Not reported'
}

export function AgentsView(props: Props) {
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const submit = async () => {
    const value = name.trim()
    if (!value || creating) return
    setCreating(true)
    setError('')
    try {
      await props.onCreate(value)
      setName('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }
  return (
    <>
      <section className="fleet-heading">
        <div>
          <p className="eyebrow">Agent visualizer</p>
          <h2>Your agents, at a glance</h2>
        </div>
        <span className="pill">
          {props.agents.filter((a) => a.running).length} running / {props.agents.length} configured
        </span>
      </section>
      <section className="card">
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <label htmlFor="agent-name">New agent</label>
          <input
            id="agent-name"
            value={name}
            placeholder="Agent name"
            disabled={creating}
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" className="primary" disabled={creating || !name.trim()}>
            {creating ? 'Creating…' : 'Create agent'}
          </button>
        </form>
        <p className="muted small">New agents start in dry-run mode. Start an agent to receive its own telemetry.</p>
        {error ? (
          <p role="alert" className="error">
            {error}
          </p>
        ) : null}
      </section>
      {props.loadError ? (
        <p role="alert" className="card error">
          Could not refresh agents: {props.loadError}. Any visible cards show the last successful response.
        </p>
      ) : null}
      {props.loading ? (
        <section className="card" role="status">
          Loading agents…
        </section>
      ) : props.agents.length === 0 && !props.loadError ? (
        <section className="card empty-state">
          <h3>No agents configured</h3>
          <p className="muted">Create your first agent above.</p>
        </section>
      ) : (
        <div className="agent-grid">
          {props.agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} now={now} {...props} />
          ))}
        </div>
      )}
    </>
  )
}

function AgentCard({ agent, now, ...props }: Props & { agent: ManagedAgent; now: number }) {
  const conn = useAgentConnection(
    agent.running ? agentWsUrl(agent.ipcPort) : null,
    props.token,
    agent.configPath,
    agent.id,
  )
  const snapshot = agent.running && conn.status === 'connected' ? conn.snapshot : null
  const [target, setTarget] = useState(agent.strategyId ?? '')
  const [preview, setPreview] = useState<{
    from: string | null
    to: string
    changes: ReturnType<typeof strategyDiff>
  } | null>(null)
  const previewGeneration = useRef(0)
  const previewContext = useRef({ strategyId: agent.strategyId, token: props.token })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (previewContext.current.strategyId === agent.strategyId && previewContext.current.token === props.token) return
    previewContext.current = { strategyId: agent.strategyId, token: props.token }
    previewGeneration.current += 1
    setTarget(agent.strategyId ?? '')
    setPreview(null)
  }, [agent.strategyId, props.token])
  useEffect(
    () => () => {
      previewGeneration.current += 1
    },
    [],
  )
  const action = async (fn: () => Promise<void>) => {
    setPending(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPending(false)
    }
  }
  const inspect = () =>
    action(async () => {
      const generation = ++previewGeneration.current
      const from = agent.strategyId
      const to = target
      const load = async (id: string | null) => {
        if (!id) return {}
        const res = await fetchJson<{ result?: Record<string, unknown>; error?: unknown }>('/api/tool', props.token, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'get_strategy', args: { id } }),
        })
        if (!res.result || res.error || res.result.error) throw new Error(`Cannot load strategy: ${id}`)
        return res.result
      }
      const [before, after] = await Promise.all([load(from), load(to)])
      if (generation !== previewGeneration.current) return
      setPreview({ from, to, changes: strategyDiff(before, after) })
    })
  const status = !agent.running
    ? 'stopped'
    : conn.status === 'rejected'
      ? 'error'
      : snapshot?.lastError
        ? 'error'
        : snapshot
          ? snapshot.busy
            ? 'running'
            : 'idle'
          : 'running'
  const logs = agent.running ? conn.logs : []
  const latestTool = [...logs].reverse().find((log) => log.category === 'tool_start')
  const latestDecision = [...logs].reverse().find((log) => log.category === 'agent_loop_end')
  const phase = LOOP_PHASES.find((item) => item === snapshot?.phase)
  const disabled = pending || props.busy[agent.id]
  return (
    <article className={`card agent-card agent-${status}`} aria-label={`Agent ${agent.name}`}>
      <div className="agent-row">
        <div className="agent-symbol" aria-hidden="true">
          {agent.name.slice(0, 1).toUpperCase()}
        </div>
        <div className="grow">
          <h3>{agent.name}</h3>
          <span className="muted small">{agent.id}</span>
        </div>
        <span className={`pill state-${status}`}>
          <span className="status-dot" />
          {status}
        </span>
      </div>
      <dl className="agent-facts">
        <div>
          <dt>Strategy</dt>
          <dd>{snapshot?.activeStrategyId ?? agent.strategyId ?? 'None'}</dd>
        </div>
        <div>
          <dt>Uptime</dt>
          <dd>{agent.running ? elapsed(agent.startedAt, now) : 'Stopped'}</dd>
        </div>
        <div>
          <dt>Last state received</dt>
          <dd>{snapshot ? `${elapsed(conn.lastHeartbeat, now)} ago` : 'Unavailable'}</dd>
        </div>
        <div>
          <dt>Telemetry</dt>
          <dd>{!agent.running ? 'Stopped' : !agent.ipcPort ? 'Port not reported' : conn.status}</dd>
        </div>
      </dl>
      {conn.status === 'rejected' ? (
        <p className="error" role="alert">
          Endpoint rejected the connection. Check its token; automatic retries have stopped.
        </p>
      ) : null}
      {snapshot?.lastError ? (
        <p className="error" role="alert">
          Last reported error: {snapshot.lastError.message}
        </p>
      ) : null}
      <div className="agent-section">
        <h4>Activity</h4>
        <ol className="visualizer-pipeline" aria-label="Agent loop phases">
          {LOOP_PHASES.map((item) => (
            <li
              key={item}
              className={phase === item ? 'current' : ''}
              aria-current={phase === item ? 'step' : undefined}
            >
              {item}
            </li>
          ))}
        </ol>
        <p>
          {phase
            ? `${phase}${snapshot?.phaseSince ? ` · ${elapsed(snapshot.phaseSince, now)}` : ''}`
            : snapshot
              ? snapshot.busy
                ? 'Busy · detailed phase not reported'
                : 'Idle · detailed phase not reported'
              : 'Waiting for this agent’s state'}
        </p>
        <p className="muted small">
          Settled means the agent cycle finished; it does not confirm an on-chain transaction.
        </p>
      </div>
      <div className="agent-section">
        <h4>Positions {snapshot ? `(${snapshot.positions.length})` : ''}</h4>
        {!snapshot ? (
          <p className="muted small">No telemetry available for this agent.</p>
        ) : snapshot.positions.length === 0 ? (
          <p className="muted small">No open positions.</p>
        ) : (
          snapshot.positions.map((p) => <PositionCard key={p.positionAddress} position={p} />)
        )}
      </div>
      <div className="agent-section">
        <h4>Latest execution events</h4>
        <p className="small">
          Tool:{' '}
          {snapshot?.lastTool
            ? `${snapshot.lastTool.name} · ${snapshot.lastTool.status}`
            : (latestTool?.message ?? 'No event received')}
        </p>
        <p className="small">Decision: {snapshot?.lastDecision?.summary ?? 'Not reported'}</p>
        <p className="small">Confidence: {confidenceLabel(snapshot?.confidence)}</p>
        {!snapshot?.lastDecision && latestDecision ? (
          <p className="muted small">Last loop event: {latestDecision.message}</p>
        ) : null}
      </div>
      <div className="agent-section">
        <label className="field">
          <span>Strategy for next start</span>
          <select
            value={target}
            disabled={disabled}
            onChange={(e) => {
              previewGeneration.current += 1
              setTarget(e.target.value)
              setPreview(null)
            }}
          >
            <option value="" disabled>
              Select strategy
            </option>
            {agent.strategyId && !props.strategies.some((s) => s.id === agent.strategyId) ? (
              <option value={agent.strategyId}>{agent.strategyId}</option>
            ) : null}
            {props.strategies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name ?? s.id}
              </option>
            ))}
          </select>
        </label>
        <div className="row">
          <button
            type="button"
            disabled={disabled || !target || target === agent.strategyId}
            onClick={() => void inspect()}
          >
            Preview changes
          </button>
          <button type="button" className="ghost" onClick={props.onCreateStrategy}>
            Create strategy
          </button>
        </div>
        {preview &&
        preview.from === agent.strategyId &&
        preview.to === target &&
        previewContext.current.token === props.token ? (
          <section className="strategy-preview" role="dialog" aria-label={`Strategy preview for ${agent.name}`}>
            <h4>
              {preview.from ?? 'None'} → {preview.to}
            </h4>
            <p className="muted small">
              Saving changes the configuration only. A running agent keeps its current strategy until you stop and start
              it.
            </p>
            {preview.changes.length === 0 ? (
              <p>No parameter changes.</p>
            ) : (
              preview.changes.map((change) => (
                <div key={change.key} className="diff-row">
                  <strong>{change.key}</strong>
                  <pre className="diff-before">{JSON.stringify(change.before, null, 2) ?? '(unset)'}</pre>
                  <pre className="diff-after">{JSON.stringify(change.after, null, 2) ?? '(unset)'}</pre>
                </div>
              ))
            )}
            <div className="row">
              <button
                type="button"
                className="primary"
                disabled={disabled}
                onClick={() =>
                  void action(async () => {
                    await props.onSetStrategy(agent.id, preview.to)
                    setPreview(null)
                  })
                }
              >
                Save for next start
              </button>
              <button type="button" disabled={disabled} onClick={() => setPreview(null)}>
                Cancel
              </button>
            </div>
          </section>
        ) : null}
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="row agent-actions">
        <button
          type="button"
          className={agent.running ? 'danger' : 'primary'}
          disabled={disabled}
          onClick={() => void action(() => (agent.running ? props.onStop(agent.id) : props.onStart(agent.id)))}
        >
          {disabled ? 'Working…' : agent.running ? 'Stop agent' : 'Start agent'}
        </button>
      </div>
    </article>
  )
}

function PositionCard({ position }: { position: PositionSummary }) {
  const range = positionRange(position)
  const split = position.assetSplit
  const amounts =
    split &&
    Number.isFinite(split.tokenXAmount) &&
    Number.isFinite(split.tokenYAmount) &&
    split.tokenXAmount >= 0 &&
    split.tokenYAmount >= 0
      ? split
      : null
  return (
    <div className="position-row">
      <strong>{position.tokenSymbol ?? 'Pair not reported'}</strong>
      <span className="muted small break-word">Pool: {position.poolAddress}</span>
      <span className="small">
        PnL:{' '}
        {typeof position.pnlUsd !== 'number' || !Number.isFinite(position.pnlUsd)
          ? 'Not reported'
          : `$${position.pnlUsd.toFixed(2)}`}
      </span>
      {range ? (
        <>
          <div className="row small">
            <span>
              Bins {range.lowerBin} → {range.upperBin}
            </span>
            <span className={range.inRange === true ? 'pos' : range.inRange === false ? 'neg' : 'muted'}>
              {range.inRange === true
                ? 'In range'
                : range.inRange === false
                  ? 'Out of range'
                  : 'Range status not reported'}
            </span>
          </div>
          <div
            className="visualizer-range"
            role="img"
            aria-label={`Range ${range.lowerBin} to ${range.upperBin}; active bin ${range.activeBin ?? 'not reported'}`}
          >
            {range.marker == null ? null : (
              <span className="visualizer-range-marker" style={{ left: `${range.marker}%` }} />
            )}
          </div>
          <span className="small muted">Active bin: {range.activeBin ?? 'Not reported'}</span>
        </>
      ) : (
        <span className="small muted">Range bins not reported</span>
      )}
      <span className="small">
        Asset split:{' '}
        {amounts
          ? `X ${amounts.tokenXAmount.toLocaleString(undefined, { maximumFractionDigits: 9 })} / Y ${amounts.tokenYAmount.toLocaleString(undefined, { maximumFractionDigits: 9 })}`
          : 'Not reported'}
      </span>
      {amounts ? <span className="small muted">Token quantities, not comparable USD percentages.</span> : null}
    </div>
  )
}
