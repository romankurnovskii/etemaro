import { useNow } from '../hooks/useNow'
import {
  agentLogs,
  type FleetStatus,
  fleetStatus,
  inferPhase,
  lastByCategory,
  lastHeartbeat,
  PHASES,
  relTime,
  shortAddr,
  snapshotFor,
} from '../lib/agentViz'
import type { LogEntry, ManagedAgent, StateSnapshot, StrategySummary } from '../lib/ipc'
import { StrategySwitch } from './StrategySwitch'

interface Props {
  agent: ManagedAgent
  busy: boolean
  logs: LogEntry[]
  snapshot: StateSnapshot | null
  strategies: StrategySummary[]
  token: string
  onStart: (id: string) => Promise<void>
  onStop: (id: string) => Promise<void>
  onSetStrategy: (id: string, strategyId: string) => Promise<void>
}

const fmtUsd = (v: number | undefined) => `${Number(v ?? 0) < 0 ? '-' : ''}$${Math.abs(Number(v ?? 0)).toFixed(2)}`
const clip = (v: string, n: number) => (v.length > n ? `${v.slice(0, n)}…` : v)

export function AgentCard({ agent, busy, logs, snapshot, strategies, token, onStart, onStop, onSetStrategy }: Props) {
  const now = useNow(5000)
  const mine = agentLogs(logs, agent.id)
  const snap = snapshotFor(agent, snapshot)
  const hasTelemetry = mine.length > 0 || snap !== null
  const phase = inferPhase(mine, snap ? snap.busy : null, now)
  const status: FleetStatus = fleetStatus(agent, mine, hasTelemetry, phase, now)
  const beat = lastHeartbeat(mine)
  const tool = lastByCategory(mine, 'tool_start')
  const decision = lastByCategory(mine, 'agent_reply')
  const positions = snap?.positions ?? []
  const pools = [...new Set(positions.map((p) => p.poolAddress))]

  return (
    <section className={`card agent-card agent-${status}`}>
      <div className="agent-row">
        <span className={`pill pill-${status}`}>{status}</span>
        <div className="grow">
          <strong>{agent.name}</strong> <span className="mono muted small">{agent.id}</span>
        </div>
        {agent.running ? (
          <button type="button" className="danger" disabled={busy} onClick={() => void onStop(agent.id)}>
            Stop
          </button>
        ) : (
          <button type="button" className="primary" disabled={busy} onClick={() => void onStart(agent.id)}>
            Start
          </button>
        )}
      </div>

      <dl className="kv">
        <div>
          <dt>Strategy</dt>
          <dd className="mono">{agent.strategyId ?? '—'}</dd>
        </div>
        <div>
          <dt>Last heartbeat</dt>
          <dd>{agent.running ? (beat ? relTime(beat, now) : 'no telemetry') : '—'}</dd>
        </div>
        <div>
          <dt>PID</dt>
          <dd className="mono">{agent.pid ?? '—'}</dd>
        </div>
        <div>
          <dt>Active pool</dt>
          <dd className="mono" title={pools.join('\n')}>
            {pools.length === 0 ? '—' : pools.length === 1 ? shortAddr(pools[0] ?? '') : `${pools.length} pools`}
          </dd>
        </div>
      </dl>

      {agent.running && hasTelemetry ? (
        <>
          <ol className="pipeline" aria-label="Agent loop phase (inferred from recent logs)">
            {PHASES.map((p) => (
              <li key={p} className={p === phase ? 'on' : ''} aria-current={p === phase ? 'step' : undefined}>
                {p}
              </li>
            ))}
          </ol>
          <p className="muted small">Phase is inferred from recent log activity.</p>
        </>
      ) : null}

      {snap ? (
        <div className="metrics mt">
          <div className="metric">
            <div className="label">PnL</div>
            <div className={`value ${Number(snap.totalPnlUsd) >= 0 ? 'pos' : 'neg'}`}>{fmtUsd(snap.totalPnlUsd)}</div>
          </div>
          <div className="metric">
            <div className="label">Positions</div>
            <div className="value">{positions.length}</div>
          </div>
          <div className="metric">
            <div className="label">Next screen</div>
            <div className="value small">
              {snap.nextScreenAt ? new Date(snap.nextScreenAt).toLocaleTimeString() : '—'}
            </div>
          </div>
        </div>
      ) : null}

      {positions.length > 0 ? (
        <table className="mt">
          <thead>
            <tr>
              <th>Token</th>
              <th>Pool</th>
              <th className="num">Value</th>
              <th className="num">PnL</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => (
              <tr key={p.positionAddress}>
                <td>{p.tokenSymbol ?? '—'}</td>
                <td className="mono">{shortAddr(p.poolAddress)}</td>
                <td className="num">{fmtUsd(p.valueUsd)}</td>
                <td className={`num ${Number(p.pnlUsd ?? 0) >= 0 ? 'pos' : 'neg'}`}>
                  {p.pnlPct === undefined ? fmtUsd(p.pnlUsd) : `${p.pnlPct.toFixed(1)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {decision || tool ? (
        <dl className="kv mt">
          {tool ? (
            <div>
              <dt>Last tool</dt>
              <dd className="mono">{clip(tool.message, 80)}</dd>
            </div>
          ) : null}
          {decision ? (
            <div>
              <dt>Last decision</dt>
              <dd>{clip(decision.message, 160)}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      <div className="mt">
        <StrategySwitch agent={agent} strategies={strategies} token={token} onApply={onSetStrategy} />
      </div>
    </section>
  )
}
