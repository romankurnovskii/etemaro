import { useMemo, useState } from 'react'
import { Pipeline } from '../components/Pipeline'
import { StrategySwitch } from '../components/StrategySwitch'
import { useNow, useRunningSince } from '../hooks/useUptime'
import type { LogEntry, ManagedAgent, StateSnapshot, StrategySummary } from '../lib/ipc'
import { type AgentHealth, fmtDuration, healthOf, relTime, telemetryFor } from '../lib/telemetry'

interface Props {
  agents: ManagedAgent[]
  busy: Record<string, boolean>
  strategies: StrategySummary[]
  logs: LogEntry[]
  snapshot: StateSnapshot | null
  token: string
  onCreate: (name: string) => Promise<void>
  onStart: (id: string) => Promise<void>
  onStop: (id: string) => Promise<void>
  onSetStrategy: (id: string, strategyId: string) => Promise<void>
  onCreateStrategy: () => void
}

const HEALTH_LABEL: Record<AgentHealth, string> = {
  running: 'Running',
  idle: 'Idle',
  stopped: 'Stopped',
  error: 'Error',
}

function fmtUsd(v: number | undefined): string {
  const n = Number(v ?? 0)
  return (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2)
}

function fmtTime(iso: string | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString()
}

export function AgentsView(props: Props) {
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const now = useNow(1000)
  const since = useRunningSince(props.agents)

  const rows = useMemo(
    () =>
      props.agents.map((agent) => {
        const t = telemetryFor(agent, props.logs, props.snapshot)
        return { agent, t, health: healthOf(agent, t) }
      }),
    [props.agents, props.logs, props.snapshot],
  )

  const counts = useMemo(() => {
    const c: Record<AgentHealth, number> = { running: 0, idle: 0, stopped: 0, error: 0 }
    for (const r of rows) c[r.health]++
    return c
  }, [rows])

  const active = rows.find((r) => r.agent.id === selected) ?? rows[0] ?? null

  const submit = () => {
    const value = name.trim()
    if (!value) return
    void props.onCreate(value).then(() => setName(''))
  }

  const run = (fn: () => Promise<void>) => {
    setActionError(null)
    fn().catch((e: unknown) => setActionError(e instanceof Error ? e.message : String(e)))
  }

  const positions = props.snapshot?.positions ?? []

  return (
    <>
      <div className="metrics">
        {(['running', 'idle', 'stopped', 'error'] as AgentHealth[]).map((h) => (
          <div className="metric" key={h}>
            <div className="label">{HEALTH_LABEL[h]}</div>
            <div className={`value tone-${h}`}>{counts[h]}</div>
          </div>
        ))}
      </div>

      {actionError ? <p className="error mt">{actionError}</p> : null}

      <h2 className="section-title">Fleet</h2>
      {rows.length === 0 ? (
        <section className="card">
          <p className="muted">No agents yet. Create one below.</p>
        </section>
      ) : (
        <div className="fleet">
          {rows.map(({ agent, t, health }) => {
            const started = since[agent.id]
            return (
              <article key={agent.id} className={`card agent-card${active?.agent.id === agent.id ? ' selected' : ''}`}>
                <header className="agent-head">
                  <span className={`status-dot dot-${health}`} />
                  <strong className="grow">{agent.name}</strong>
                  <span className={`pill pill-${health}`}>{HEALTH_LABEL[health]}</span>
                </header>
                <dl className="kv">
                  <dt>Strategy</dt>
                  <dd className="mono">{agent.strategyId ?? '—'}</dd>
                  <dt>Pair / pool</dt>
                  <dd className="mono">
                    {positions.length > 0 && props.snapshot?.activeStrategyId === agent.strategyId
                      ? positions.map((p) => p.tokenSymbol ?? p.poolAddress.slice(0, 6)).join(', ')
                      : '—'}
                  </dd>
                  <dt>Uptime</dt>
                  <dd>{agent.running && started ? fmtDuration(now - started) : '—'}</dd>
                  <dt>Heartbeat</dt>
                  <dd>{agent.running ? relTime(t.lastLogAt, now) : '—'}</dd>
                </dl>
                <div className="row">
                  {agent.running ? (
                    <button
                      type="button"
                      className="danger"
                      disabled={props.busy[agent.id]}
                      onClick={() => run(() => props.onStop(agent.id))}
                    >
                      Stop
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="primary"
                      disabled={props.busy[agent.id]}
                      onClick={() => run(() => props.onStart(agent.id))}
                    >
                      Start
                    </button>
                  )}
                  <button type="button" className="ghost" onClick={() => setSelected(agent.id)}>
                    Inspect
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {active ? (
        <section className="card inspector">
          <h2>
            {active.agent.name} <span className="muted mono small">{active.agent.id}</span>
          </h2>
          <Pipeline stage={active.t.stage} active={active.agent.running} />
          <p className="muted small">
            Stage is inferred from the agent's log categories; the daemon does not report it directly.
          </p>

          <div className="split">
            <div>
              <h3>Execution</h3>
              <dl className="kv">
                <dt>Last decision</dt>
                <dd>{active.t.lastDecision ? <span className="clamp">{active.t.lastDecision}</span> : '—'}</dd>
                <dt>Last tool</dt>
                <dd className="mono">
                  {active.t.lastTool ?? '—'}
                  {active.t.lastToolOk === true ? <span className="pill pill-running">ok</span> : null}
                  {active.t.lastToolOk === false ? <span className="pill pill-error">blocked</span> : null}
                </dd>
                <dt>Warnings / errors</dt>
                <dd>
                  {active.t.warns} / {active.t.errors}
                </dd>
                <dt>Confidence</dt>
                <dd className="muted">not reported by daemon</dd>
                <dt>PID</dt>
                <dd className="mono">{active.agent.pid ?? '—'}</dd>
              </dl>
            </div>
            <div>
              <h3>Positions</h3>
              {props.snapshot ? (
                <dl className="kv">
                  <dt>Cycle</dt>
                  <dd>{props.snapshot.busy ? 'busy' : 'waiting'}</dd>
                  <dt>Next screening</dt>
                  <dd>{fmtTime(props.snapshot.nextScreenAt)}</dd>
                  <dt>Next management</dt>
                  <dd>{fmtTime(props.snapshot.nextManageAt)}</dd>
                  <dt>Total PnL</dt>
                  <dd className={Number(props.snapshot.totalPnlUsd) >= 0 ? 'pos' : 'neg'}>
                    {fmtUsd(props.snapshot.totalPnlUsd)}
                  </dd>
                  <dt>Range bins / in-range / split</dt>
                  <dd className="muted">not reported by daemon</dd>
                </dl>
              ) : (
                <p className="muted small">Waiting for the daemon state snapshot.</p>
              )}
              <p className="muted small">Snapshot is the daemon's own agent, not per child process.</p>
            </div>
          </div>

          <h3>Strategy</h3>
          <StrategySwitch
            agent={active.agent}
            strategies={props.strategies}
            token={props.token}
            onApply={props.onSetStrategy}
          />
          <div className="row mt">
            <button type="button" className="ghost" onClick={props.onCreateStrategy}>
              Create strategy
            </button>
          </div>
        </section>
      ) : null}

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
        <p className="muted small">Agents are created in dry-run mode.</p>
      </section>
    </>
  )
}
