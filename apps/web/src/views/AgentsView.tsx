import { useCallback, useEffect, useState } from 'react'
import { type AgentConnection, useAgentConnection } from '../hooks/useAgentConnection'
import { DAEMON_URL, fetchJson, readTool } from '../lib/api'
import {
  agentEndpoint,
  type LivePosition,
  logSeverity,
  loopStage,
  type ManagedAgent,
  type StrategySummary,
  strategyDiff,
} from '../lib/ipc'

interface Props {
  agents: ManagedAgent[]
  busy: Record<string, boolean>
  loading: boolean
  error: string | null
  strategyError: string | null
  token: string
  strategies: StrategySummary[]
  onReload: () => void
  onCreate: (name: string) => Promise<void>
  onStart: (id: string) => Promise<void>
  onStop: (id: string) => Promise<void>
  onSetStrategy: (id: string, strategyId: string) => Promise<void>
  onCreateStrategy: () => void
}
interface Endpoint {
  url: string
  token: string
}
interface Telemetry extends AgentConnection {
  endpoint: Endpoint | null
}

function relativeTime(timestamp: number | null, now: number): string {
  if (!timestamp) return 'Not received'
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000))
  if (seconds < 5) return 'Just now'
  if (seconds < 60) return `${seconds}s ago`
  return `${Math.floor(seconds / 60)}m ago`
}

export function AgentsView(props: Props) {
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [actionError, setActionError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [telemetry, setTelemetry] = useState<Record<string, Telemetry>>({})
  const [now, setNow] = useState(Date.now())
  const selected = props.agents.find((agent) => agent.id === selectedId) ?? props.agents[0]
  const report = useCallback((id: string, value: Telemetry) => setTelemetry((prev) => ({ ...prev, [id]: value })), [])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const create = async () => {
    if (!name.trim() || creating) return
    setCreating(true)
    setActionError(null)
    try {
      await props.onCreate(name.trim())
      setName('')
      setShowCreate(false)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not create agent')
    } finally {
      setCreating(false)
    }
  }
  const action = async (agent: ManagedAgent) => {
    setActionError(null)
    try {
      await (agent.running ? props.onStop(agent.id) : props.onStart(agent.id))
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Agent action failed')
    }
  }
  const running = props.agents.filter((agent) => agent.running).length
  const reporting = props.agents.filter((agent) => telemetry[agent.id]?.status === 'connected').length
  return (
    <>
      <div className="metrics fleet-metrics">
        <div className="metric">
          <span className="label">TOTAL AGENTS</span>
          <strong className="value">{props.agents.length.toString().padStart(2, '0')}</strong>
          <span className="metric-note">Configured in your fleet</span>
        </div>
        <div className="metric">
          <span className="label">
            <span className="status-dot status-connected" />
            RUNNING
          </span>
          <strong className="value pos">{running.toString().padStart(2, '0')}</strong>
          <span className="metric-note">Active agent processes</span>
        </div>
        <div className="metric">
          <span className="label">STOPPED</span>
          <strong className="value">{(props.agents.length - running).toString().padStart(2, '0')}</strong>
          <span className="metric-note">Ready when you are</span>
        </div>
        <div className="metric">
          <span className="label">TELEMETRY</span>
          <strong className="value">
            {reporting}
            <span className="metric-unit"> / {running}</span>
          </strong>
          <span className="metric-note">Connected agent streams</span>
        </div>
      </div>
      <div className="section-heading">
        <div>
          <h2>
            Your agents <span className="count">{props.agents.length}</span>
          </h2>
          <p className="muted small">Select an agent to inspect its live activity.</p>
        </div>
        <div className="row">
          <button
            type="button"
            className="ghost"
            onClick={() => {
              props.onReload()
              setRefreshKey((value) => value + 1)
            }}
          >
            ↻ Refresh
          </button>
          <button
            type="button"
            className="primary"
            aria-expanded={showCreate}
            onClick={() => setShowCreate(!showCreate)}
          >
            + New agent
          </button>
        </div>
      </div>
      {showCreate && (
        <form
          className="card create-form"
          onSubmit={(e) => {
            e.preventDefault()
            void create()
          }}
        >
          <label className="field" htmlFor="agent-name">
            <span>Agent name</span>
            <input
              id="agent-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. SOL liquidity agent"
            />
          </label>
          <button className="primary" type="submit" disabled={creating || !name.trim()}>
            {creating ? 'Creating…' : 'Create agent'}
          </button>
          <p className="muted small">New agents use the daemon's dry-run configuration by default.</p>
        </form>
      )}
      {(props.error || actionError) && (
        <div className="notice error" role="alert">
          {actionError ?? `Cannot load fleet: ${props.error}`}
        </div>
      )}
      {props.loading ? (
        <div className="empty-state card">
          <h3>Loading your fleet…</h3>
        </div>
      ) : props.agents.length === 0 ? (
        <div className="empty-state card">
          <span className="empty-glyph" aria-hidden="true">
            ◇
          </span>
          <h3>{props.error ? 'Fleet unavailable' : 'Your first agent starts here'}</h3>
          <p className="muted">
            {props.error
              ? 'Connect to the daemon to load configured agents.'
              : 'Create an agent, choose a strategy and follow every decision in real time.'}
          </p>
          <button
            type="button"
            className="primary"
            onClick={() => (props.error ? props.onReload() : setShowCreate(true))}
          >
            {props.error ? 'Retry connection' : '+ Create your first agent'}
          </button>
        </div>
      ) : (
        <div className="fleet-layout">
          <section className="agent-list" aria-label="Agent fleet">
            {props.agents.map((agent) => (
              <AgentCard
                key={`${agent.id}-${refreshKey}`}
                agent={agent}
                token={props.token}
                selected={selected?.id === agent.id}
                busy={Boolean(props.busy[agent.id])}
                now={now}
                onSelect={() => setSelectedId(agent.id)}
                onAction={() => void action(agent)}
                onTelemetry={report}
              />
            ))}
          </section>
          {selected && (
            <AgentInspector
              key={selected.id}
              agent={selected}
              telemetry={telemetry[selected.id]}
              strategies={props.strategies}
              strategyError={props.strategyError}
              token={props.token}
              now={now}
              onSetStrategy={props.onSetStrategy}
              onCreateStrategy={props.onCreateStrategy}
            />
          )}
        </div>
      )}
    </>
  )
}

function AgentCard({
  agent,
  token,
  selected,
  busy,
  now,
  onSelect,
  onAction,
  onTelemetry,
}: {
  agent: ManagedAgent
  token: string
  selected: boolean
  busy: boolean
  now: number
  onSelect: () => void
  onAction: () => void
  onTelemetry: (id: string, value: Telemetry) => void
}) {
  const [endpoint, setEndpoint] = useState<Endpoint | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    setEndpoint(null)
    setConfigError(null)
    if (!agent.running || agent.pid === null) return
    fetchJson<{ config: { connection?: { ipcPort?: number; ipcToken?: string } } }>(
      `/api/config?path=${encodeURIComponent(agent.configPath)}`,
      token,
      { signal: controller.signal },
    )
      .then(({ config }) => {
        if (!controller.signal.aborted)
          setEndpoint({
            url: agentEndpoint(DAEMON_URL, config.connection?.ipcPort),
            token: config.connection?.ipcToken ?? token,
          })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setConfigError(error instanceof Error ? error.message : 'Cannot read agent endpoint')
      })
    return () => controller.abort()
  }, [agent.configPath, agent.running, agent.pid, token])
  const conn = useAgentConnection(endpoint ? endpoint.url.replace(/^http/, 'ws') : null, endpoint?.token ?? '')
  const { status, snapshot, lastSeen, error, logs, chat, catalog, sendChat } = conn
  useEffect(() => {
    onTelemetry(agent.id, {
      status,
      snapshot,
      lastSeen,
      error: configError ?? error,
      logs,
      chat,
      catalog,
      sendChat,
      endpoint,
    })
  }, [agent.id, status, snapshot, lastSeen, error, configError, logs, chat, catalog, sendChat, endpoint, onTelemetry])
  const lastLog = logs.at(-1)
  const failed = Boolean(configError || error || (lastLog && logSeverity(lastLog) === 'error'))
  const label = !agent.running
    ? 'Stopped'
    : failed
      ? 'Error'
      : snapshot && !snapshot.busy && snapshot.positions.length === 0
        ? 'Idle'
        : 'Running'
  return (
    <article className={`agent-card${selected ? ' selected' : ''}`}>
      <button type="button" className="agent-select" aria-pressed={selected} onClick={onSelect}>
        <div className="agent-card-top">
          <span className="agent-avatar" aria-hidden="true">
            {agent.name.slice(0, 2).toUpperCase()}
          </span>
          <span className={`state-badge ${label.toLowerCase()}`}>
            <span className="status-dot" />
            {label}
          </span>
        </div>
        <h3>{agent.name}</h3>
        <span className="mono small muted">{agent.id}</span>
        <dl className="agent-facts">
          <div>
            <dt>Strategy</dt>
            <dd>{agent.strategyId ?? 'Unassigned'}</dd>
          </div>
          <div>
            <dt>Pair / pool</dt>
            <dd>{snapshot?.positions[0]?.tokenSymbol ?? '—'}</dd>
          </div>
          <div>
            <dt>Last heartbeat</dt>
            <dd>{relativeTime(lastSeen, now)}</dd>
          </div>
        </dl>
      </button>
      <div className="agent-card-bottom">
        <span className="small muted">
          {!agent.running
            ? 'Process stopped'
            : status === 'connected'
              ? 'Live telemetry'
              : configError
                ? 'Telemetry unavailable'
                : 'Connecting telemetry…'}
        </span>
        <button
          type="button"
          className={agent.running ? 'danger compact' : 'primary compact'}
          disabled={busy}
          onClick={onAction}
          aria-label={`${agent.running ? 'Stop' : 'Start'} ${agent.name}`}
        >
          {busy ? 'Pending…' : agent.running ? 'Stop' : 'Start'}
        </button>
      </div>
    </article>
  )
}

function AgentInspector({
  agent,
  telemetry,
  strategies,
  strategyError,
  token,
  now,
  onSetStrategy,
  onCreateStrategy,
}: {
  agent: ManagedAgent
  telemetry?: Telemetry
  strategies: StrategySummary[]
  strategyError: string | null
  token: string
  now: number
  onSetStrategy: Props['onSetStrategy']
  onCreateStrategy: () => void
}) {
  const [positions, setPositions] = useState<LivePosition[]>([])
  const [decision, setDecision] = useState<Record<string, unknown> | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const endpoint = telemetry?.endpoint
  const connected = telemetry?.status === 'connected'
  useEffect(() => {
    setPositions([])
    setDecision(null)
    setDetailError(null)
    if (!endpoint || !connected) return
    const controller = new AbortController()
    let pending = false
    const reload = async () => {
      if (pending) return
      pending = true
      const results = await Promise.allSettled([
        readTool<{ positions?: LivePosition[] }>(
          'get_my_positions',
          {},
          endpoint.token,
          endpoint.url,
          controller.signal,
        ),
        readTool<{ decisions?: Record<string, unknown>[] }>(
          'get_recent_decisions',
          { limit: 1 },
          endpoint.token,
          endpoint.url,
          controller.signal,
        ),
      ])
      pending = false
      if (controller.signal.aborted) return
      const [positionResult, decisionResult] = results
      if (positionResult.status === 'fulfilled') setPositions(positionResult.value.positions ?? [])
      if (decisionResult.status === 'fulfilled') setDecision(decisionResult.value.decisions?.[0] ?? null)
      const failure = results.find((result) => result.status === 'rejected')
      setDetailError(
        failure?.status === 'rejected'
          ? String(failure.reason instanceof Error ? failure.reason.message : failure.reason)
          : null,
      )
    }
    void reload()
    const timer = window.setInterval(() => void reload(), 15000)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [endpoint, connected])
  const snapshot = telemetry?.snapshot ?? null
  const logs = telemetry?.logs ?? []
  const stage = connected ? loopStage(snapshot, logs) : null
  const lastTool = [...logs].reverse().find((log) => typeof log.metadata?.tool === 'string')
  const confidenceLog = [...logs].reverse().find((log) => typeof log.metadata?.confidence === 'number')
  const confidence = confidenceLog?.metadata?.confidence
  return (
    <section className="inspector card" aria-label={`Inspector for ${agent.name}`}>
      <div className="inspector-header">
        <div>
          <p className="eyebrow">AGENT INSPECTOR</p>
          <h2>{agent.name}</h2>
        </div>
        <span className={`state-badge ${connected ? 'running' : 'stopped'}`}>
          {connected ? 'Live' : 'No live stream'}
        </span>
      </div>
      <div className="inspector-meta">
        <span className="mono small">{agent.id}</span>
        <span>
          {snapshot?.dryRun === true ? 'Dry run' : snapshot?.dryRun === false ? 'Live execution' : 'Mode not reported'}
        </span>
        <span>Heartbeat · {relativeTime(telemetry?.lastSeen ?? null, now)}</span>
      </div>
      {telemetry?.error && (
        <p role="alert" className="error small">
          {telemetry.error}
        </p>
      )}
      <div className="inspector-section">
        <div className="row space-between">
          <h3>Execution loop</h3>
          <span className="small muted">{stage ? 'Derived from live state' : 'Awaiting telemetry'}</span>
        </div>
        <ol className="pipeline">
          {(['Idle', 'Evaluating', 'Rebalancing', 'Settled'] as const).map((step, index) => (
            <li
              key={step}
              className={stage === step ? 'current' : ''}
              aria-current={stage === step ? 'step' : undefined}
            >
              <span className="pipeline-node">
                {stage === step ? <span className="status-dot status-connected" /> : `0${index + 1}`}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="inspector-section">
        <div className="row space-between">
          <h3>Positions</h3>
          <span className="small muted">
            {connected ? `${snapshot?.positions.length ?? positions.length} open` : 'Not connected'}
          </span>
        </div>
        {positions.length === 0 ? (
          <div className="quiet-state">
            {!connected
              ? 'Connect this agent to inspect its positions.'
              : detailError
                ? 'Position details unavailable.'
                : 'No position details reported.'}
          </div>
        ) : (
          positions.map((position) => <PositionCard key={position.position} position={position} />)
        )}
        {detailError && (
          <p className="small error" role="status">
            {detailError}
          </p>
        )}
      </div>
      <div className="inspector-section">
        <h3>Latest execution</h3>
        <dl className="execution-facts">
          <div>
            <dt>Last decision</dt>
            <dd>
              {decision
                ? String(decision.reason ?? decision.action ?? decision.type ?? 'Recorded decision')
                : 'Not reported'}
            </dd>
          </div>
          <div>
            <dt>Last tool</dt>
            <dd className="mono">{lastTool ? String(lastTool.metadata?.tool) : 'Not reported'}</dd>
          </div>
          <div>
            <dt>Confidence</dt>
            <dd>
              {typeof confidence === 'number' && Number.isFinite(confidence) ? String(confidence) : 'Not reported'}
            </dd>
          </div>
        </dl>
      </div>
      <StrategyPanel
        agent={agent}
        strategies={strategies}
        error={strategyError}
        token={token}
        onSetStrategy={onSetStrategy}
        onCreateStrategy={onCreateStrategy}
      />
      <div className="inspector-section">
        <div className="row space-between">
          <h3>Recent activity</h3>
          <span className="small muted">Agent stream</span>
        </div>
        {logs.length === 0 ? (
          <p className="muted small">Waiting for events from this agent.</p>
        ) : (
          <div className="activity-list">
            {logs
              .slice(-4)
              .reverse()
              .map((log) => (
                <div className="activity" key={log.streamId ?? `${log.ts}-${log.category}-${log.message}`}>
                  <span className={`activity-mark ${logSeverity(log)}`} />
                  <div>
                    <span className="category-tag">{log.category}</span>
                    <p>{log.message}</p>
                  </div>
                  <time>{log.ts?.slice(11, 19)}</time>
                </div>
              ))}
          </div>
        )}
      </div>
    </section>
  )
}

function PositionCard({ position }: { position: LivePosition }) {
  const min = position.lower_bin
  const max = position.upper_bin
  const active = position.active_bin
  const hasRange =
    typeof min === 'number' && typeof max === 'number' && Number.isFinite(min) && Number.isFinite(max) && max >= min
  const location =
    hasRange && typeof active === 'number' && Number.isFinite(active)
      ? Math.max(0, Math.min(100, ((active - min) / (max - min || 1)) * 100))
      : null
  const x = position.token_x_value_usd
  const y = position.token_y_value_usd
  const split =
    typeof x === 'number' &&
    typeof y === 'number' &&
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    x >= 0 &&
    y >= 0 &&
    x + y > 0
      ? (x / (x + y)) * 100
      : null
  return (
    <div className="position-card">
      <div className="row space-between">
        <strong>{position.pair ?? 'LP position'}</strong>
        <span
          className={`state-badge ${position.in_range === true ? 'running' : position.in_range === false ? 'idle' : ''}`}
        >
          {position.in_range === true ? 'In range' : position.in_range === false ? 'Out of range' : 'Range unknown'}
        </span>
      </div>
      <p className="mono small muted address">Pool {position.pool}</p>
      {hasRange ? (
        <>
          <div
            className="range-track"
            role="img"
            aria-label={`Bin range ${min} to ${max}; active bin ${active ?? 'unknown'}`}
          >
            <div className="range-fill" />
            {location !== null && <span className="range-marker" style={{ left: `${location}%` }} />}
          </div>
          <div className="range-labels mono">
            <span>{min}</span>
            <span>Active {active ?? '—'}</span>
            <span>{max}</span>
          </div>
        </>
      ) : (
        <p className="muted small">Price range bins not reported.</p>
      )}
      <div className="asset-split">
        <span className="small muted">Asset split · USD value</span>
        {split === null ? (
          <span className="small muted">Not reported by this daemon</span>
        ) : (
          <>
            <div
              className="split-track"
              role="img"
              aria-label={`Asset X ${split.toFixed(1)} percent; asset Y ${(100 - split).toFixed(1)} percent`}
            >
              <span style={{ width: `${split}%` }} />
            </div>
            <div className="range-labels">
              <span>Asset X · {split.toFixed(1)}%</span>
              <span>Asset Y · {(100 - split).toFixed(1)}%</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function StrategyPanel({
  agent,
  strategies,
  error,
  token,
  onSetStrategy,
  onCreateStrategy,
}: {
  agent: ManagedAgent
  strategies: StrategySummary[]
  error: string | null
  token: string
  onSetStrategy: Props['onSetStrategy']
  onCreateStrategy: () => void
}) {
  const [target, setTarget] = useState('')
  const [preview, setPreview] = useState<ReturnType<typeof strategyDiff> | null>(null)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => {
    setTarget(agent.strategyId ?? '')
    setPreview(null)
  }, [agent.strategyId])
  const inspect = async () => {
    setPending(true)
    setMessage(null)
    setPreview(null)
    try {
      const [before, after] = await Promise.all([
        agent.strategyId ? readTool<unknown>('get_strategy', { id: agent.strategyId }, token) : Promise.resolve({}),
        readTool<unknown>('get_strategy', { id: target }, token),
      ])
      setPreview(strategyDiff(before, after))
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Cannot preview strategy')
    } finally {
      setPending(false)
    }
  }
  const apply = async () => {
    if (!preview || !target || target === agent.strategyId) return
    setPending(true)
    setMessage(null)
    try {
      await onSetStrategy(agent.id, target)
      setPreview(null)
      setMessage('Strategy saved. Restart a running agent to load the new configuration.')
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Cannot switch strategy')
    } finally {
      setPending(false)
    }
  }
  return (
    <div className="inspector-section">
      <div className="row space-between">
        <h3>Strategy</h3>
        <button type="button" className="text-button" onClick={onCreateStrategy}>
          Create strategy ↗
        </button>
      </div>
      <div className="row strategy-controls">
        <label className="sr-only" htmlFor="strategy-select">
          Strategy for {agent.name}
        </label>
        <select
          id="strategy-select"
          value={target}
          disabled={pending || Boolean(error)}
          onChange={(e) => {
            setTarget(e.target.value)
            setPreview(null)
            setMessage(null)
          }}
        >
          <option value="" disabled>
            Select a strategy
          </option>
          {agent.strategyId && !strategies.some((strategy) => strategy.id === agent.strategyId) && (
            <option value={agent.strategyId}>{agent.strategyId}</option>
          )}
          {strategies.map((strategy) => (
            <option key={strategy.id} value={strategy.id}>
              {strategy.name ?? strategy.id}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="ghost"
          disabled={pending || !target || target === agent.strategyId || Boolean(error)}
          onClick={() => void inspect()}
        >
          {pending ? 'Loading…' : 'Preview change'}
        </button>
      </div>
      {error && <p className="error small">Strategy catalog unavailable: {error}</p>}
      {preview && (
        <div className="strategy-preview">
          <h4>Review strategy changes</h4>
          <p className="small muted mono">
            {agent.strategyId ?? 'Unassigned'} → {target}
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Setting</th>
                  <th>Current</th>
                  <th>Proposed</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((change) => (
                  <tr key={change.path}>
                    <th className="mono">{change.path}</th>
                    <td className="diff-before mono">{JSON.stringify(change.before) ?? '—'}</td>
                    <td className="diff-after mono">{JSON.stringify(change.after) ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">
            This updates the saved configuration. A running agent must be restarted to load it.
          </p>
          <div className="row">
            <button type="button" className="primary" disabled={pending} onClick={() => void apply()}>
              Confirm strategy switch
            </button>
            <button type="button" className="ghost" disabled={pending} onClick={() => setPreview(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {message && (
        <p className="small" role="status">
          {message}
        </p>
      )}
    </div>
  )
}
