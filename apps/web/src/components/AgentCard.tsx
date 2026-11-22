import type { ReactNode } from 'react'
import { type AgentStatus, deriveStatus, inferPhase, lastDecision, lastTool } from '../lib/agentActivity'
import { DASH, fmtAgo, fmtClock, shortAddr } from '../lib/format'
import type { ManagedAgent, StrategySummary } from '../lib/ipc'
import { type LogRecord, logKey, severityOf } from '../lib/logs'
import type { AgentTelemetry } from '../stores/telemetryStore'
import { PhasePipeline } from './PhasePipeline'
import { StrategySwitch } from './StrategySwitch'
import { Button, Pill, type PillTone } from './ui'

const RECENT_LOGS = 8

/** Fields the daemon does not publish over IPC — shown once, not as four dashes. */
const NOT_EXPOSED = ['Range bins', 'In range', 'Asset split', 'Uptime']

interface Props {
  agent: ManagedAgent
  telemetry: AgentTelemetry | undefined
  /** This agent's logs only (exact agentId match). */
  logs: readonly LogRecord[]
  writeTools: ReadonlySet<string>
  strategies: StrategySummary[]
  busy: boolean
  error: string | undefined
  now: number
  onStart: (id: string) => void
  onStop: (id: string) => void
  onSetStrategy: (id: string, strategyId: string) => Promise<void>
}

const STATUS_LABEL: Record<AgentStatus, string> = {
  running: 'Running',
  idle: 'Idle',
  stopped: 'Stopped',
  error: 'Error',
}

const STATUS_TONE: Record<AgentStatus, PillTone> = {
  running: 'success',
  idle: 'neutral',
  stopped: 'danger',
  error: 'danger',
}

function linkText(agent: ManagedAgent, t: AgentTelemetry | undefined): string {
  if (!agent.running) return 'Not running — no live telemetry'
  if (!t || t.link === 'resolving') return 'Resolving agent IPC endpoint…'
  if (t.link === 'unavailable') return `Telemetry unavailable: ${t.reason ?? 'unknown reason'}`
  const where = t.endpoint ?? 'agent IPC'
  const reason = t.reason ? ` · ${t.reason}` : ''
  return `${where} · ${t.link}${reason}`
}

function Metric({ label, children, title }: { label: string; children: ReactNode; title?: string }) {
  return (
    <div className="kv" title={title}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

export function AgentCard(props: Props) {
  const { agent, telemetry, logs, writeTools, now } = props
  const connected = telemetry?.link === 'connected'
  const snapshot = telemetry?.snapshot ?? null
  const status = deriveStatus({ running: agent.running, hasTelemetry: connected, snapshot, logs, writeTools })
  const phase = agent.running ? inferPhase(logs, writeTools) : null
  const tool = lastTool(logs)
  const decision = lastDecision(logs)
  const positions = snapshot?.positions ?? null
  const recent = logs.slice(-RECENT_LOGS).reverse()

  const phaseNote = !agent.running ? (
    'Process stopped (from supervisor)'
  ) : phase?.basis ? (
    <>
      <span className="tag tag-inferred">inferred</span> from <span className="mono">{phase.basis.category}</span> at{' '}
      {fmtClock(phase.basis.ts)}
    </>
  ) : (
    <>
      <span className="tag tag-inferred">inferred</span> no phase signal in this agent's logs yet
    </>
  )

  return (
    <article className={`agent-card status-${status}`} aria-labelledby={`agent-${agent.id}-name`}>
      <header className="agent-card-head">
        <div className="agent-title">
          <h3 id={`agent-${agent.id}-name`}>{agent.name}</h3>
          <p className="mono small muted">
            {agent.id}
            {agent.pid ? ` · pid ${agent.pid}` : ''}
          </p>
        </div>
        <Pill tone={STATUS_TONE[status]} dot>
          {STATUS_LABEL[status]}
        </Pill>
        {agent.running ? (
          <Button size="sm" variant="danger" disabled={props.busy} onClick={() => props.onStop(agent.id)}>
            {props.busy ? 'Stopping…' : 'Stop'}
          </Button>
        ) : (
          <Button size="sm" variant="primary" disabled={props.busy} onClick={() => props.onStart(agent.id)}>
            {props.busy ? 'Starting…' : 'Start'}
          </Button>
        )}
      </header>

      {props.error ? (
        <p className="msg msg-error" role="alert">
          {props.error}
        </p>
      ) : null}

      <p className={`link-line${connected ? '' : ' muted'}`}>
        <span className="mono">{linkText(agent, telemetry)}</span>
      </p>

      <PhasePipeline phase={agent.running ? (phase?.phase ?? null) : 'idle'} note={phaseNote} />

      <dl className="kv-grid">
        <Metric label="Strategy">
          <span className="mono">{agent.strategyId ?? DASH}</span>
        </Metric>
        <Metric label="Last message">
          {telemetry?.lastMessageAt ? (
            <>
              {fmtClock(telemetry.lastMessageAt)}{' '}
              <span className="muted">({fmtAgo(telemetry.lastMessageAt, now)})</span>
            </>
          ) : (
            DASH
          )}
        </Metric>
        <Metric label="Active pool">
          {positions === null ? (
            DASH
          ) : positions.length === 0 ? (
            'No open position'
          ) : (
            <span className="mono">
              {positions
                .map((p) => `${p.tokenSymbol || DASH} · ${shortAddr(p.poolAddress)}`)
                .slice(0, 3)
                .join(', ')}
              {positions.length > 3 ? ` +${positions.length - 3}` : ''}
            </span>
          )}
        </Metric>
        <Metric label="Last tool">
          {tool ? (
            <>
              <span className="mono">{tool.name}</span> <span className="muted">{fmtClock(tool.ts)}</span>
            </>
          ) : (
            DASH
          )}
        </Metric>
        <Metric label="Last decision">
          {decision ? (
            <span className="clamp" title={decision.text}>
              {decision.text}
            </span>
          ) : (
            DASH
          )}
        </Metric>
      </dl>

      <p className="not-exposed small muted">Not exposed over IPC: {NOT_EXPOSED.join(' · ')}</p>

      <StrategySwitch
        key={`${agent.id}:${agent.strategyId ?? ''}`}
        agent={agent}
        strategies={props.strategies}
        onApply={props.onSetStrategy}
      />

      <details className="recent-logs">
        <summary>Recent logs ({logs.length})</summary>
        {recent.length === 0 ? (
          <p className="muted small">No logs received from this agent.</p>
        ) : (
          <ul className="log-list compact">
            {recent.map((r) => (
              <li key={logKey(r)} className={`log-line sev-${severityOf(r.entry.category)}`}>
                <span className="ts">{fmtClock(r.entry.ts)}</span> <span className="cat">{r.entry.category}</span>{' '}
                <span className="msg-text">{r.entry.message}</span>
              </li>
            ))}
          </ul>
        )}
      </details>
    </article>
  )
}
