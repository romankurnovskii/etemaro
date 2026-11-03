import { useEffect, useMemo, useState } from 'react'
import type { AgentActivity, AgentPhase } from '../hooks/useAgentActivity'
import { formatSince, formatUptime } from '../hooks/useAgentActivity'
import type { ManagedAgent, StateSnapshot, StrategySummary } from '../lib/ipc'
import { AgentInspector } from './AgentInspector'
import { StrategySwitcher } from './StrategySwitcher'

interface Props {
  agents: ManagedAgent[]
  busy: Record<string, boolean>
  strategies: StrategySummary[]
  snapshot: StateSnapshot | null
  activity: Record<string, AgentActivity>
  token: string
  onCreate: (name: string) => Promise<void>
  onStart: (id: string) => Promise<void>
  onStop: (id: string) => Promise<void>
  onSetStrategy: (id: string, strategyId: string) => Promise<void>
  onCreateStrategy: () => void
}

/** Visual agent state combining process state with the derived loop phase. */
type FleetStatus = 'stopped' | AgentPhase

const STATUS_LABEL: Record<FleetStatus, string> = {
  stopped: 'Stopped',
  idle: 'Idle',
  evaluating: 'Evaluating',
  rebalancing: 'Rebalancing',
  settled: 'Settled',
  error: 'Error',
}

function fleetStatus(agent: ManagedAgent, activity: AgentActivity | undefined): FleetStatus {
  if (!agent.running) return 'stopped'
  return activity?.phase ?? 'idle'
}

/** Re-render every few seconds so uptimes and heartbeats stay current. */
function useNow(intervalMs = 5000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

/**
 * Agent Visualizer — fleet overview with live status cards, quick controls,
 * per-agent state inspection, and strategy switching with diff preview.
 */
export function AgentsView(props: Props) {
  const [name, setName] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const nowMs = useNow()

  const fleet = useMemo(() => {
    const counts = { total: props.agents.length, running: 0, stopped: 0, alerts: 0 }
    for (const agent of props.agents) {
      const status = fleetStatus(agent, props.activity[agent.id])
      if (status === 'stopped') counts.stopped += 1
      else {
        counts.running += 1
        if (status === 'error') counts.alerts += 1
      }
    }
    return counts
  }, [props.agents, props.activity])

  const submit = () => {
    const value = name.trim()
    if (!value) return
    void props.onCreate(value).then(() => setName(''))
  }

  return (
    <>
      <section className="fleet-summary">
        <div className="fleet-stat">
          <span className="fleet-num">{fleet.total}</span>
          <span className="fleet-label">Agents</span>
        </div>
        <div className="fleet-stat">
          <span className="fleet-num pos">{fleet.running}</span>
          <span className="fleet-label">Running</span>
        </div>
        <div className="fleet-stat">
          <span className="fleet-num neg">{fleet.stopped}</span>
          <span className="fleet-label">Stopped</span>
        </div>
        <div className="fleet-stat">
          <span className={`fleet-num ${fleet.alerts > 0 ? 'warn-text' : ''}`}>{fleet.alerts}</span>
          <span className="fleet-label">Alerts</span>
        </div>
        <div className="fleet-create">
          <input
            value={name}
            placeholder="New agent name…"
            aria-label="New agent name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
          />
          <button type="button" className="primary" onClick={submit}>
            Create
          </button>
        </div>
      </section>

      {props.agents.length === 0 ? (
        <section className="card">
          <h2>Fleet</h2>
          <p className="muted">
            No agents yet — create one above. New agents start in dry-run and appear here with live status once started.
          </p>
        </section>
      ) : (
        <div className="fleet-grid">
          {props.agents.map((agent) => {
            const activity = props.activity[agent.id]
            const status = fleetStatus(agent, props.activity[agent.id])
            const isOpen = expanded === agent.id
            return (
              <section className={`agent-card${isOpen ? ' open' : ''}`} key={agent.id}>
                <div className="agent-card-head">
                  <span className={`status-dot dot-${status}`} />
                  <div className="grow">
                    <div className="agent-name">
                      <strong>{agent.name}</strong>
                      <span className={`status-badge badge-${status}`}>{STATUS_LABEL[status]}</span>
                    </div>
                    <div className="muted small mono">{agent.id}</div>
                  </div>
                  {agent.running ? (
                    <button
                      type="button"
                      className="danger small-btn"
                      disabled={props.busy[agent.id]}
                      onClick={() => void props.onStop(agent.id)}
                    >
                      Stop
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="primary small-btn"
                      disabled={props.busy[agent.id]}
                      onClick={() => void props.onStart(agent.id)}
                    >
                      Start
                    </button>
                  )}
                </div>

                <dl className="agent-meta">
                  <div>
                    <dt>Uptime</dt>
                    <dd>{agent.running ? formatUptime(activity?.runningSince ?? null, nowMs) : '—'}</dd>
                  </div>
                  <div>
                    <dt>Heartbeat</dt>
                    <dd>{formatSince(activity?.lastHeartbeat ?? null, nowMs)}</dd>
                  </div>
                  <div>
                    <dt>Pair / pool</dt>
                    <dd>{activity?.activePair ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Last tool</dt>
                    <dd className="mono">{activity?.lastTool ?? '—'}</dd>
                  </div>
                </dl>

                <div className="agent-card-foot">
                  <StrategySwitcher
                    agentId={agent.id}
                    agentName={agent.name}
                    currentStrategyId={agent.strategyId}
                    strategies={props.strategies}
                    token={props.token}
                    busy={Boolean(props.busy[agent.id])}
                    onApply={(strategyId) => props.onSetStrategy(agent.id, strategyId)}
                  />
                  <button
                    type="button"
                    className="ghost small-btn"
                    onClick={() => setExpanded(isOpen ? null : agent.id)}
                    aria-expanded={isOpen}
                  >
                    {isOpen ? 'Hide inspector' : 'Inspect'}
                  </button>
                </div>

                {isOpen ? (
                  <AgentInspector agent={agent} activity={activity ?? EMPTY} snapshot={props.snapshot} nowMs={nowMs} />
                ) : null}
              </section>
            )
          })}
        </div>
      )}

      <p className="muted small">
        Status is derived live from daemon telemetry.{' '}
        <button type="button" className="linklike" onClick={props.onCreateStrategy}>
          Create a new strategy →
        </button>
      </p>
    </>
  )
}

const EMPTY: AgentActivity = {
  phase: 'idle',
  phaseSince: null,
  lastHeartbeat: null,
  lastTool: null,
  lastDecision: null,
  error: null,
  activePair: null,
  events: 0,
  runningSince: null,
}
