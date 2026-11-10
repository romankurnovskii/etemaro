import { type ReactNode, useEffect, useMemo, useState } from 'react'
import type {
  AssetSplit,
  InRangeStatus,
  LogEntry,
  ManagedAgent,
  PositionSummary,
  PriceRangeBins,
  StateSnapshot,
  StrategySummary,
  ToolDescriptor,
} from '../lib/ipc'

interface Props {
  agents: ManagedAgent[]
  busy: Record<string, boolean>
  strategies: StrategySummary[]
  snapshot: StateSnapshot | null
  catalog: ToolDescriptor[]
  logs: LogEntry[]
  onCreate: (name: string) => Promise<void>
  onStart: (id: string) => Promise<void>
  onStop: (id: string) => Promise<void>
  onSetStrategy: (id: string, strategyId: string) => Promise<void>
  onCreateStrategy: () => void
}

/* ========================================================================
   Derivations
   ======================================================================== */

type FleetStatus = 'running' | 'stopped' | 'idle' | 'error'

const FLEET_STATUSES: readonly FleetStatus[] = ['running', 'stopped', 'idle', 'error']

const STATUS_HINT: Record<FleetStatus, string> = {
  running: 'Process alive',
  stopped: 'Configured, not running',
  idle: 'No strategy assigned',
  error: 'Marked running, no process',
}

/**
 * ManagedAgent exposes only `running`, `pid` and `strategyId`, so the four
 * fleet states are derived from those fields:
 * running = running + pid · error = running without pid (process lost)
 * stopped = not running, strategy set · idle = not running, no strategy
 */
function fleetStatus(agent: ManagedAgent): FleetStatus {
  if (agent.running) return agent.pid != null ? 'running' : 'error'
  return agent.strategyId ? 'stopped' : 'idle'
}

const LOOP_STAGES = [
  { key: 'idle', label: 'Idle', hint: 'Awaiting next cycle' },
  { key: 'evaluating', label: 'Evaluating', hint: 'Screening pools' },
  { key: 'rebalancing', label: 'Rebalancing', hint: 'Managing positions' },
  { key: 'settled', label: 'Settled', hint: 'Positions held' },
] as const

type LoopStage = (typeof LOOP_STAGES)[number]['key']

/**
 * Loop stage from the live daemon snapshot (re-broadcast after every cycle):
 * busy without positions = screening, busy with positions = managing,
 * idle with positions = settled, otherwise idle.
 */
function loopStage(snapshot: StateSnapshot | null, anyRunning: boolean): LoopStage {
  if (!snapshot || !anyRunning) return 'idle'
  const hasPositions = snapshot.positions.length > 0
  if (snapshot.busy) return hasPositions ? 'rebalancing' : 'evaluating'
  return hasPositions ? 'settled' : 'idle'
}

interface ToolStat {
  name: string
  runs: number
  ok: number
  blocked: number
  avgMs: number | null
  lastTs: string
}

/** Aggregates agent-loop telemetry (`tool_finish` / `tool_blocked` log entries). */
function toolStats(logs: LogEntry[]): { stats: ToolStat[]; inFlight: number } {
  const byName = new Map<string, ToolStat & { totalMs: number; timed: number }>()
  let starts = 0
  let ends = 0
  for (const entry of logs) {
    if (entry.category === 'tool_start') {
      starts += 1
      continue
    }
    if (entry.category !== 'tool_finish' && entry.category !== 'tool_blocked') continue
    ends += 1
    const name = typeof entry.metadata?.tool === 'string' ? entry.metadata.tool : 'unknown'
    const stat = byName.get(name) ?? {
      name,
      runs: 0,
      ok: 0,
      blocked: 0,
      avgMs: null,
      lastTs: entry.ts,
      totalMs: 0,
      timed: 0,
    }
    stat.runs += 1
    if (entry.category === 'tool_finish') stat.ok += 1
    else stat.blocked += 1
    const ms = entry.metadata?.duration_ms
    if (typeof ms === 'number') {
      stat.totalMs += ms
      stat.timed += 1
    }
    if (entry.ts > stat.lastTs) stat.lastTs = entry.ts
    byName.set(name, stat)
  }
  const stats = [...byName.values()]
    .map(({ totalMs, timed, ...s }) => ({ ...s, avgMs: timed ? Math.round(totalMs / timed) : null }))
    .sort((a, b) => b.runs - a.runs)
  return { stats, inFlight: Math.max(0, starts - ends) }
}

/* ========================================================================
   Formatting
   ======================================================================== */

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })

function formatUsd(value: number | undefined): string {
  return value == null || Number.isNaN(value) ? '—' : usd.format(value)
}

function pnlClass(value: number | undefined): string {
  if (value == null || value === 0) return ''
  return value > 0 ? 'pos' : 'neg'
}

function formatSpan(sec: number): string {
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.round(sec / 60)}m`
  if (sec < 86400) return `${Math.round(sec / 3600)}h`
  return `${Math.round(sec / 86400)}d`
}

function formatWhen(iso: string | undefined): string {
  if (!iso) return '—'
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return '—'
  const diffSec = Math.round((ts - Date.now()) / 1000)
  const span = formatSpan(Math.abs(diffSec))
  return diffSec >= 0 ? `in ${span}` : `${span} ago`
}

/** Elapsed time since an ISO timestamp, e.g. "2h" — "—" when unknown. */
function formatSince(iso: string | null | undefined): string {
  if (!iso) return '—'
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return '—'
  return formatSpan(Math.max(0, Math.round((Date.now() - ts) / 1000)))
}

function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address
}

/** Splits a pair label like "SOL-USDC" or "SOL/USDC" into its two token names. */
function pairTokens(symbol: string | undefined): [string, string] {
  const parts = (symbol ?? '').split(/[-/]/).filter(Boolean)
  return [parts[0] ?? 'X', parts[1] ?? 'Y']
}

function strategyLabel(strategies: StrategySummary[], id: string | null | undefined): string {
  if (!id) return 'None'
  return strategies.find((s) => s.id === id)?.name ?? id
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/* ========================================================================
   View
   ======================================================================== */

export function AgentsView(props: Props) {
  const [switchAgentId, setSwitchAgentId] = useState<string | null>(null)
  const switchAgent = props.agents.find((a) => a.id === switchAgentId) ?? null

  return (
    <>
      <FleetOverview {...props} onOpenSwitch={setSwitchAgentId} />
      <AgentTopology
        agents={props.agents}
        snapshot={props.snapshot}
        catalog={props.catalog}
        logs={props.logs}
        strategies={props.strategies}
      />
      <section className="card">
        <div className="card-head">
          <h2>Strategy management</h2>
          <span className="spacer" />
          <button type="button" className="ghost" onClick={props.onCreateStrategy}>
            Create strategy
          </button>
        </div>
        {props.agents.length === 0 ? (
          <p className="muted small">Create an agent to assign a strategy.</p>
        ) : (
          <StrategyEditor
            agents={props.agents}
            busy={props.busy}
            strategies={props.strategies}
            onSetStrategy={props.onSetStrategy}
          />
        )}
      </section>

      {switchAgent ? (
        <Overlay title={`Switch strategy · ${switchAgent.name}`} onClose={() => setSwitchAgentId(null)}>
          <StrategyEditor
            agents={props.agents}
            busy={props.busy}
            strategies={props.strategies}
            onSetStrategy={props.onSetStrategy}
            fixedAgentId={switchAgent.id}
            onApplied={() => setSwitchAgentId(null)}
          />
        </Overlay>
      ) : null}
    </>
  )
}

/* ---------- Fleet Overview ---------- */

function FleetOverview(props: Props & { onOpenSwitch: (id: string) => void }) {
  const { agents, busy, strategies } = props
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const counts = useMemo(() => {
    const out: Record<FleetStatus, number> = { running: 0, stopped: 0, idle: 0, error: 0 }
    for (const agent of agents) out[fleetStatus(agent)] += 1
    return out
  }, [agents])

  const run = (task: Promise<void>) => {
    setError(null)
    task.catch((err: unknown) => setError(errorText(err)))
  }

  const submit = () => {
    const value = name.trim()
    if (!value || creating) return
    setCreating(true)
    setError(null)
    props
      .onCreate(value)
      .then(() => setName(''))
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setCreating(false))
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Fleet overview</h2>
        <span className="spacer" />
        <span className="muted small">
          {agents.length} {agents.length === 1 ? 'agent' : 'agents'}
        </span>
      </div>

      <div className="metrics">
        {FLEET_STATUSES.map((status) => (
          <div className="metric" key={status}>
            <div className="label">
              <span className={`status-dot status-${status}`} />
              {status}
            </div>
            <div className="value">{counts[status]}</div>
            <div className="muted small">{STATUS_HINT[status]}</div>
          </div>
        ))}
      </div>

      <div className="fleet-list mt">
        {agents.length === 0 ? (
          <p className="muted small">No agents yet — create one below.</p>
        ) : (
          agents.map((agent) => {
            const status = fleetStatus(agent)
            const isBusy = Boolean(busy[agent.id])
            return (
              <div className="fleet-item" key={agent.id}>
                <div className="agent-row">
                  <span className={`status-dot status-${status}`} title={STATUS_HINT[status]} />
                  <div className="grow">
                    <div>
                      <strong>{agent.name}</strong> <span className={`badge badge-${status}`}>{status}</span>
                    </div>
                    <div className="meta">
                      {strategyLabel(strategies, agent.strategyId)} · pid {agent.pid ?? '—'}
                      {agent.startedAt ? ` · up ${formatSince(agent.startedAt)}` : ''} · {agent.id}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={isBusy || strategies.length === 0}
                    onClick={() => props.onOpenSwitch(agent.id)}
                  >
                    Switch strategy
                  </button>
                  {agent.running ? (
                    <button
                      type="button"
                      className="danger"
                      disabled={isBusy}
                      onClick={() => run(props.onStop(agent.id))}
                    >
                      {isBusy ? 'Stopping…' : 'Stop'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="primary"
                      disabled={isBusy}
                      onClick={() => run(props.onStart(agent.id))}
                    >
                      {isBusy ? 'Starting…' : 'Start'}
                    </button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      <div className="row mt">
        <input
          value={name}
          placeholder="New agent name"
          aria-label="New agent name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
        <button type="button" className="primary" disabled={!name.trim() || creating} onClick={submit}>
          {creating ? 'Creating…' : 'Create agent'}
        </button>
      </div>
      <p className="muted small">New agents are configured for dry-run.</p>
      {error ? <p className="error small">{error}</p> : null}
    </section>
  )
}

/* ---------- Agent Topology & State Inspection ---------- */

function AgentTopology(props: {
  agents: ManagedAgent[]
  snapshot: StateSnapshot | null
  catalog: ToolDescriptor[]
  logs: LogEntry[]
  strategies: StrategySummary[]
}) {
  const { snapshot, catalog, logs } = props
  const anyRunning = props.agents.some((a) => fleetStatus(a) === 'running')
  const stage = loopStage(snapshot, anyRunning)
  const currentIndex = LOOP_STAGES.findIndex((s) => s.key === stage)
  const positions: PositionSummary[] = snapshot?.positions ?? []

  const catalogStats = useMemo(() => {
    let write = 0
    let guarded = 0
    for (const tool of catalog) {
      if (tool.isWrite) write += 1
      if (tool.isProtected) guarded += 1
    }
    return { total: catalog.length, read: catalog.length - write, write, guarded }
  }, [catalog])

  const telemetry = useMemo(() => toolStats(logs), [logs])

  return (
    <section className="card">
      <div className="card-head">
        <h2>Agent topology</h2>
        <span className="spacer" />
        {snapshot?.dryRun ? <span className="badge badge-muted">dry-run</span> : null}
        <span className="muted small">
          {snapshot ? (snapshot.busy ? 'cycle in progress' : 'waiting') : 'no live state'}
        </span>
      </div>

      <ol className="pipeline" aria-label="Execution loop">
        {LOOP_STAGES.map((s, i) => {
          const state = i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'pending'
          return (
            <li key={s.key} className={`stage ${state}`} aria-current={state === 'current' ? 'step' : undefined}>
              <span className="stage-node">{i + 1}</span>
              <span className="stage-label">{s.label}</span>
              <span className="stage-hint">{s.hint}</span>
            </li>
          )
        })}
      </ol>

      <div className="metrics">
        <Metric label="Open positions" value={String(positions.length)} />
        <Metric
          label="Total PnL"
          value={formatUsd(snapshot?.totalPnlUsd)}
          className={pnlClass(snapshot?.totalPnlUsd)}
        />
        <Metric
          label="Session PnL"
          value={formatUsd(snapshot?.sessionPnlUsd)}
          className={pnlClass(snapshot?.sessionPnlUsd)}
        />
        <Metric label="Unclaimed fees" value={formatUsd(snapshot?.unclaimedFeesUsd)} />
        <Metric label="Next screen" value={formatWhen(snapshot?.nextScreenAt)} />
        <Metric label="Next manage" value={formatWhen(snapshot?.nextManageAt)} />
        <Metric label="Uptime" value={formatSince(snapshot?.uptime?.startedAt)} />
        <Metric label="Last heartbeat" value={formatWhen(snapshot?.heartbeatAt)} />
      </div>

      <h3 className="subhead">Last decision</h3>
      {snapshot?.lastDecision ? (
        <div className="decision">
          <div className="agent-row">
            <span className={`badge badge-decision-${snapshot.lastDecision.type}`}>{snapshot.lastDecision.type}</span>
            <strong>{snapshot.lastDecision.poolName ?? 'No pool'}</strong>
            <span className="muted small">by {snapshot.lastDecision.actor}</span>
            <span className="spacer" />
            <span className="muted small">{formatWhen(snapshot.lastDecision.ts)}</span>
          </div>
          {snapshot.lastDecision.summary ? (
            <p className="small decision-summary">{snapshot.lastDecision.summary}</p>
          ) : null}
        </div>
      ) : (
        <p className="muted small">No structured decisions recorded yet.</p>
      )}

      <h3 className="subhead">Positions</h3>
      {positions.length === 0 ? (
        <p className="muted small">No open positions.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Position</th>
                <th>Token</th>
                <th>Range (bins)</th>
                <th>Status</th>
                <th>Split</th>
                <th className="num">Value</th>
                <th className="num">PnL</th>
                <th className="num">PnL %</th>
                <th className="num">Fees</th>
                <th className="num">Age</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => (
                <tr key={p.positionAddress}>
                  <td className="mono" title={`Position ${p.positionAddress}\nPool ${p.poolAddress}`}>
                    {shortAddress(p.positionAddress)}
                  </td>
                  <td>{p.tokenSymbol ?? '—'}</td>
                  <td>
                    <RangeBar bins={p.priceRangeBins ?? null} inRange={p.inRangeStatus?.inRange ?? null} />
                  </td>
                  <td>
                    <RangeStatus status={p.inRangeStatus ?? null} />
                  </td>
                  <td>
                    <SplitBar split={p.assetSplit ?? null} tokenSymbol={p.tokenSymbol} />
                  </td>
                  <td className="num">{formatUsd(p.valueUsd)}</td>
                  <td className={`num ${pnlClass(p.pnlUsd)}`}>{formatUsd(p.pnlUsd)}</td>
                  <td className={`num ${pnlClass(p.pnlPct)}`}>{p.pnlPct == null ? '—' : `${p.pnlPct.toFixed(2)}%`}</td>
                  <td className="num">{formatUsd(p.unclaimedFeesUsd)}</td>
                  <td className="num">{formatWhen(p.deployedAt).replace(' ago', '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="subhead">Tool execution</h3>
      <div className="row small">
        <span className="muted">Catalog</span>
        <span>{catalogStats.total} tools</span>
        <span className="badge badge-read">{catalogStats.read} read</span>
        <span className="badge badge-write">{catalogStats.write} write</span>
        <span className="badge badge-muted">{catalogStats.guarded} protected</span>
        <span className="spacer" />
        <span className="muted">{telemetry.inFlight > 0 ? `${telemetry.inFlight} in flight` : 'none in flight'}</span>
      </div>
      {telemetry.stats.length === 0 ? (
        <p className="muted small">No tool calls in the current log buffer.</p>
      ) : (
        <div className="table-wrap mt">
          <table>
            <thead>
              <tr>
                <th>Tool</th>
                <th className="num">Runs</th>
                <th className="num">OK</th>
                <th className="num">Blocked</th>
                <th className="num">Avg ms</th>
                <th className="num">Last</th>
              </tr>
            </thead>
            <tbody>
              {telemetry.stats.slice(0, 8).map((t) => (
                <tr key={t.name}>
                  <td className="mono">{t.name}</td>
                  <td className="num">{t.runs}</td>
                  <td className="num pos">{t.ok}</td>
                  <td className={`num ${t.blocked ? 'neg' : ''}`}>{t.blocked}</td>
                  <td className="num">{t.avgMs ?? '—'}</td>
                  <td className="num">{formatWhen(t.lastTs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/** Bin range track with the pool's active bin marked; "—" when bins are unknown. */
function RangeBar(props: { bins: PriceRangeBins | null; inRange: boolean | null }) {
  const { bins } = props
  if (!bins) return <span className="muted">—</span>
  const { lower, upper, active } = bins
  const min = Math.min(lower, active ?? lower)
  const max = Math.max(upper, active ?? upper)
  const pad = Math.max(1, (max - min) * 0.15)
  const lo = min - pad
  const span = max + pad - lo
  const pos = (bin: number) => `${((bin - lo) / span) * 100}%`
  const state = props.inRange == null ? 'unknown' : props.inRange ? 'in' : 'out'
  return (
    <div
      className={`range-bar range-${state}`}
      title={`Bins ${lower} to ${upper}${active != null ? ` · active ${active}` : ''}`}
    >
      <div className="range-track">
        <span className="range-fill" style={{ left: pos(lower), width: `${((upper - lower) / span) * 100}%` }} />
        {active != null ? <span className="range-marker" style={{ left: pos(active) }} /> : null}
      </div>
      <span className="range-label mono">
        {`${lower} … ${upper}`}
        {active != null ? ` · @${active}` : ''}
      </span>
    </div>
  )
}

function RangeStatus(props: { status: InRangeStatus | null }) {
  const { status } = props
  if (!status) return <span className="muted">—</span>
  if (status.inRange) return <span className="badge badge-running">in range</span>
  return (
    <span className="badge badge-error">
      out{status.minutesOutOfRange > 0 ? ` ${formatSpan(status.minutesOutOfRange * 60)}` : ''}
    </span>
  )
}

/** Two-segment bar: token X share vs token Y share of position value. */
function SplitBar(props: { split: AssetSplit | null; tokenSymbol: string | undefined }) {
  const { split } = props
  if (!split) return <span className="muted">—</span>
  const [x, y] = pairTokens(props.tokenSymbol)
  return (
    <div className="split-bar" title={`${x} ${split.tokenXPct}% · ${y} ${split.tokenYPct}%`}>
      <div className="split-track">
        <span className="split-x" style={{ width: `${split.tokenXPct}%` }} />
      </div>
      <span className="split-label mono">
        {Math.round(split.tokenXPct)}/{Math.round(split.tokenYPct)}
      </span>
    </div>
  )
}

function Metric(props: { label: string; value: string; className?: string }) {
  return (
    <div className="metric">
      <div className="label">{props.label}</div>
      <div className={`value ${props.className ?? ''}`}>{props.value}</div>
    </div>
  )
}

/* ---------- Strategy Management ---------- */

function StrategyEditor(props: {
  agents: ManagedAgent[]
  busy: Record<string, boolean>
  strategies: StrategySummary[]
  onSetStrategy: (id: string, strategyId: string) => Promise<void>
  fixedAgentId?: string
  onApplied?: () => void
}) {
  const { agents, strategies } = props
  const [agentId, setAgentId] = useState(props.fixedAgentId ?? '')
  const [draft, setDraft] = useState('')
  const [applying, setApplying] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const agent = agents.find((a) => a.id === agentId) ?? (props.fixedAgentId ? undefined : agents[0])
  const current = agent?.strategyId ?? null
  const target = draft || current || ''
  const changed = Boolean(agent && target && target !== current)
  const targetMeta = strategies.find((s) => s.id === target)

  const apply = () => {
    if (!agent || !changed) return
    setApplying(true)
    setMessage(null)
    props
      .onSetStrategy(agent.id, target)
      .then(() => {
        setDraft('')
        setMessage({ kind: 'ok', text: `${agent.name} now uses ${strategyLabel(strategies, target)}.` })
        props.onApplied?.()
      })
      .catch((err: unknown) => setMessage({ kind: 'error', text: errorText(err) }))
      .finally(() => setApplying(false))
  }

  if (!agent) return <p className="muted small">Agent not found.</p>

  return (
    <>
      <div className="row">
        {props.fixedAgentId ? null : (
          <label className="field grow">
            <span>Agent</span>
            <select
              value={agent.id}
              onChange={(e) => {
                setAgentId(e.target.value)
                setDraft('')
                setMessage(null)
              }}
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field grow">
          <span>Strategy catalog</span>
          <select
            value={target}
            disabled={strategies.length === 0}
            onChange={(e) => {
              setDraft(e.target.value)
              setMessage(null)
            }}
          >
            {target ? null : <option value="">Select a strategy</option>}
            {strategies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name ?? s.id}
                {s.active ? ' (active)' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="diff">
        <div className="diff-cell">
          <div className="label">Current</div>
          <div className="value">{strategyLabel(strategies, current)}</div>
          <div className="muted small mono">{current ?? 'unassigned'}</div>
        </div>
        <span className="diff-arrow" aria-hidden="true">
          →
        </span>
        <div className={`diff-cell ${changed ? 'next' : ''}`}>
          <div className="label">After apply</div>
          <div className="value">{strategyLabel(strategies, target || null)}</div>
          <div className="muted small mono">
            {changed ? `${target}${targetMeta?.active ? ' · globally active' : ''}` : 'no change'}
          </div>
        </div>
      </div>

      <pre className="diff-text">
        <span className="ctx">{`agent: ${agent.id}\n`}</span>
        {changed ? (
          <>
            <span className="del">{`- strategyId: ${JSON.stringify(current)}\n`}</span>
            <span className="add">{`+ strategyId: ${JSON.stringify(target)}\n`}</span>
          </>
        ) : (
          <span className="ctx">{`  strategyId: ${JSON.stringify(current)}  (unchanged)\n`}</span>
        )}
      </pre>

      <div className="row mt">
        {agent.running && changed ? (
          <span className="warn">Agent is running — the new strategy applies on its next cycle.</span>
        ) : null}
        <span className="spacer" />
        <button
          type="button"
          className="ghost"
          disabled={!draft || applying}
          onClick={() => {
            setDraft('')
            setMessage(null)
          }}
        >
          Reset
        </button>
        <button
          type="button"
          className="primary"
          disabled={!changed || applying || Boolean(props.busy[agent.id])}
          onClick={apply}
        >
          {applying ? 'Applying…' : 'Apply strategy'}
        </button>
      </div>
      {message ? <p className={`small ${message.kind === 'error' ? 'error' : 'muted'}`}>{message.text}</p> : null}
      {strategies.length === 0 ? (
        <p className="muted small">No strategies found — the catalog loads from the list_strategies tool.</p>
      ) : null}
    </>
  )
}

/* ---------- Overlay ---------- */

function Overlay(props: { title: string; onClose: () => void; children: ReactNode }) {
  const { onClose } = props
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="overlay">
      <div className="dialog" role="dialog" aria-modal="true" aria-label={props.title}>
        <div className="card-head">
          <h2>{props.title}</h2>
          <span className="spacer" />
          <button type="button" className="ghost" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        {props.children}
      </div>
    </div>
  )
}
