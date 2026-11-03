import {
  type AgentActivity,
  type AgentPhase,
  formatSince,
  formatUptime,
  PHASE_PIPELINE,
} from '../hooks/useAgentActivity'
import type { ManagedAgent, StateSnapshot } from '../lib/ipc'

interface Props {
  agent: ManagedAgent
  activity: AgentActivity
  snapshot: StateSnapshot | null
  nowMs: number
}

const PHASE_LABEL: Record<AgentPhase, string> = {
  idle: 'Idle',
  evaluating: 'Evaluating',
  rebalancing: 'Rebalancing',
  settled: 'Settled',
  error: 'Error',
}

function fmtUsd(value: number | undefined): string {
  const v = Number(value ?? 0)
  return (v < 0 ? '-$' : '$') + Math.abs(v).toFixed(2)
}

/** A short 0x… address form that keeps first/last 4 characters. */
function shortAddress(value: string | undefined): string {
  if (!value) return '—'
  return value.length > 12 ? `${value.slice(0, 4)}…${value.slice(-4)}` : value
}

/**
 * Agent Topology & State Inspection panel: the agent-loop pipeline,
 * live position metrics, and the execution summary.
 */
export function AgentInspector({ agent, activity, snapshot, nowMs }: Props) {
  const positions = snapshot?.positions ?? []
  const runningPhase = activity.phase

  return (
    <div className="inspector">
      <div className="inspector-grid">
        <section className="inspector-block">
          <h3>Agent loop</h3>
          <div className="pipeline" role="img" aria-label={`Agent phase: ${PHASE_LABEL[runningPhase]}`}>
            {PHASE_PIPELINE.map((phase, i) => {
              const active = phase === runningPhase
              const passed =
                !active && runningPhase !== 'error'
                  ? PHASE_PIPELINE.indexOf(runningPhase) > i && runningPhase !== 'idle'
                  : false
              return (
                <div key={phase} className={`pipeline-step${active ? ' active' : ''}${passed ? ' passed' : ''}`}>
                  <span className="pipeline-node" />
                  <span className="pipeline-label">{PHASE_LABEL[phase]}</span>
                  {active && activity.phaseSince ? (
                    <span className="pipeline-since">{formatUptime(activity.phaseSince, nowMs)}</span>
                  ) : null}
                </div>
              )
            })}
          </div>
          <p className="muted small mt">
            Derived live from WebSocket telemetry. {activity.error ? `Last error: ${activity.error}` : ''}
          </p>
        </section>

        <section className="inspector-block">
          <h3>Execution summary</h3>
          <dl className="kv">
            <div>
              <dt>Last decision</dt>
              <dd>{activity.lastDecision ?? 'No completed cycle yet'}</dd>
            </div>
            <div>
              <dt>Last tool invoked</dt>
              <dd className="mono">{activity.lastTool ?? '—'}</dd>
            </div>
            <div>
              <dt>Heartbeat</dt>
              <dd>{formatSince(activity.lastHeartbeat, nowMs)}</dd>
            </div>
            <div>
              <dt>Session events</dt>
              <dd>{activity.events}</dd>
            </div>
          </dl>
        </section>
      </div>

      <section className="inspector-block">
        <h3>Position metrics</h3>
        {positions.length === 0 ? (
          <p className="muted small">
            No open positions reported by the daemon state snapshot. Metrics appear here as soon as a position is
            deployed.
          </p>
        ) : (
          <div className="pos-grid">
            {positions.map((p) => (
              <div className="pos-card" key={p.positionAddress || p.poolAddress}>
                <div className="pos-head">
                  <strong>{p.tokenSymbol ?? 'Unknown pair'}</strong>
                  <span className={`pos-pill ${Number(p.pnlUsd ?? 0) >= 0 ? 'pill-pos' : 'pill-neg'}`}>
                    {p.pnlPct == null ? '—' : `${Number(p.pnlPct).toFixed(2)}%`}
                  </span>
                </div>
                <dl className="kv tight">
                  <div>
                    <dt>Value</dt>
                    <dd>{fmtUsd(p.valueUsd)}</dd>
                  </div>
                  <div>
                    <dt>PnL</dt>
                    <dd className={Number(p.pnlUsd ?? 0) >= 0 ? 'pos' : 'neg'}>{fmtUsd(p.pnlUsd)}</dd>
                  </div>
                  <div>
                    <dt>Unclaimed fees</dt>
                    <dd>{p.unclaimedFeesUsd == null ? '—' : fmtUsd(p.unclaimedFeesUsd)}</dd>
                  </div>
                  <div>
                    <dt>Pool</dt>
                    <dd className="mono">{shortAddress(p.poolAddress)}</dd>
                  </div>
                  <div>
                    <dt>Position</dt>
                    <dd className="mono">{shortAddress(p.positionAddress)}</dd>
                  </div>
                  <div>
                    <dt>Deployed</dt>
                    <dd>{p.deployedAt ? new Date(p.deployedAt).toLocaleString() : '—'}</dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="inspector-block">
        <h3>Runtime</h3>
        <dl className="kv">
          <div>
            <dt>Agent ID</dt>
            <dd className="mono">{agent.id}</dd>
          </div>
          <div>
            <dt>PID</dt>
            <dd className="mono">{agent.pid ?? '—'}</dd>
          </div>
          <div>
            <dt>Session uptime</dt>
            <dd>{agent.running ? formatUptime(activity.runningSince, nowMs) : 'stopped'}</dd>
          </div>
          <div>
            <dt>Config</dt>
            <dd className="mono small">{agent.configPath}</dd>
          </div>
          <div>
            <dt>Data dir</dt>
            <dd className="mono small">{agent.dataDir}</dd>
          </div>
        </dl>
      </section>
    </div>
  )
}
