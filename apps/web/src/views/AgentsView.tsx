/**
 * Agent Visualizer — default view.
 *
 * Fleet view for all managed agents:
 * - Fleet summary strip: total / running / idle / error / stopped, open PnL, live/dry badge
 * - Per-agent AgentCard with:
 *   - Status pill (text + color, not color alone)
 *   - Strategy, uptime, last heartbeat, PID, port, active pool(s), DRY/LIVE badge
 *   - Pipeline: Idle → Evaluating → Rebalancing → Settled
 *   - Positions table + BinRange bar per position
 *   - Execution summary (last tool, last decision, confidence if present)
 *   - Start/Stop controls (Stop on LIVE agent asks for confirmation)
 * - StrategySwitch with diff preview
 * - Create-agent form at the bottom
 */
import { useState } from 'react'
import { BinRange } from '../components/BinRange'
import { StrategySwitch } from '../components/StrategySwitch'
import type { FleetTelemetry } from '../hooks/useFleetTelemetry'
import { useNow } from '../hooks/useNow'
import {
  deriveExecSummary,
  derivePhase,
  deriveStatus,
  fmtHeartbeat,
  fmtUptime,
  lastHeartbeatMs,
  type Phase,
} from '../lib/agentViz'
import type { ManagedAgent, StrategySummary } from '../lib/ipc'
import { useAgentTelemetry, useAllTelemetry } from '../lib/telemetryStore'

// ─── Pipeline display ─────────────────────────────────────────────────────────
const PHASES: Phase[] = ['idle', 'evaluating', 'rebalancing', 'settled']
const PHASE_LABELS: Record<Phase, string> = {
  idle: 'Idle',
  evaluating: 'Evaluating',
  rebalancing: 'Rebalancing',
  settled: 'Settled',
}

function PipelineBar({ phase, source }: { phase: Phase; source: 'daemon' | 'inferred' }) {
  return (
    <section className="pipeline" aria-label={`Agent phase: ${phase}`}>
      {PHASES.map((p, i) => (
        <span key={p} className="phase-step">
          <span className={`phase-label${p === phase ? ' active' : ''}`}>{PHASE_LABELS[p]}</span>
          {i < PHASES.length - 1 && <span className="phase-arrow">›</span>}
        </span>
      ))}
      {source === 'inferred' && <span className="phase-source">(inferred)</span>}
    </section>
  )
}

// ─── USD formatting ───────────────────────────────────────────────────────────
function fmtUsd(v: number | undefined): string {
  const n = Number(v ?? 0)
  return (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2)
}

// ─── AgentCard ────────────────────────────────────────────────────────────────
interface CardProps {
  agent: ManagedAgent
  strategies: StrategySummary[]
  busy: boolean
  token: string
  now: number
  onStart: () => Promise<void>
  onStop: () => Promise<void>
  onStopById: (id: string) => Promise<void>
  onStartById: (id: string) => Promise<void>
  onReload: () => void
}

function AgentCard({
  agent,
  strategies,
  busy,
  token,
  now,
  onStart,
  onStop,
  onStopById,
  onStartById,
  onReload,
}: CardProps) {
  const tel = useAgentTelemetry(agent.id)
  const [confirmStop, setConfirmStop] = useState(false)
  const [expanded, setExpanded] = useState(true)

  const { phase, source: phaseSource } = derivePhase(tel.logs, tel.snapshot)
  const status = deriveStatus(agent.running, tel.logs, tel.snapshot)
  const heartbeatMs = lastHeartbeatMs(tel.lastMessageAt)
  const exec = deriveExecSummary(tel.logs)
  const snapshot = tel.snapshot
  const positions = snapshot?.positions ?? []
  const isLive = snapshot?.dryRun === false

  const startedAt = agent.startedAt ?? snapshot?.startedAt

  const handleStop = () => {
    if (isLive && !confirmStop) {
      setConfirmStop(true)
      return
    }
    setConfirmStop(false)
    void onStop()
  }

  return (
    <article className="agent-card" aria-label={`Agent ${agent.name}`}>
      {/* ── Header ── */}
      <div className="agent-card-header">
        <div className="grow">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 14 }}>{agent.name}</strong>
            <span className={`pill pill-${status}`} role="status" aria-label={`Status: ${status}`}>
              <span className="dot" />
              {status}
            </span>
            {isLive ? <span className="badge badge-live">LIVE</span> : <span className="badge badge-dry">DRY-RUN</span>}
            {tel.status === 'no-port' && agent.running && (
              <span className="muted small" title="No per-agent IPC port — showing process state only">
                (process state only)
              </span>
            )}
          </div>
          <div className="agent-meta">
            {agent.strategyId && <span>strategy: {agent.strategyId}</span>}
            {agent.pid && <span>PID: {agent.pid}</span>}
            {agent.ipcPort && <span>port: {agent.ipcPort}</span>}
            {startedAt && <span>up: {fmtUptime(startedAt, now)}</span>}
            <span>heartbeat: {fmtHeartbeat(heartbeatMs)}</span>
          </div>
        </div>
        <div className="agent-card-actions">
          <button type="button" className="ghost small" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
            {expanded ? '▲' : '▼'}
          </button>
          {agent.running ? (
            confirmStop ? (
              <>
                <span className="muted small">Stop LIVE agent?</span>
                <button
                  type="button"
                  className="danger"
                  disabled={busy}
                  onClick={() => {
                    setConfirmStop(false)
                    void onStop()
                  }}
                >
                  Confirm stop
                </button>
                <button type="button" className="ghost" onClick={() => setConfirmStop(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button type="button" className="danger" disabled={busy} onClick={handleStop} id={`stop-${agent.id}`}>
                {busy ? 'Stopping…' : 'Stop'}
              </button>
            )
          ) : (
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void onStart()}
              id={`start-${agent.id}`}
            >
              {busy ? 'Starting…' : 'Start'}
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <>
          {/* ── Pipeline ── */}
          <PipelineBar phase={phase} source={phaseSource} />

          {/* ── Positions ── */}
          {positions.length > 0 ? (
            <div style={{ marginTop: 8 }}>
              <table>
                <thead>
                  <tr>
                    <th>Pool</th>
                    <th className="num">PnL</th>
                    <th className="num">Value</th>
                    <th className="num">Fees</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p) => (
                    <tr key={p.positionAddress || p.poolAddress}>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>
                        {p.tokenSymbol ?? (p.positionAddress || '').slice(0, 8)}
                      </td>
                      <td className={`num ${Number(p.pnlUsd ?? 0) >= 0 ? 'pos' : 'neg'}`}>{fmtUsd(p.pnlUsd)}</td>
                      <td className="num">{fmtUsd(p.valueUsd)}</td>
                      <td className="num">{p.unclaimedFeesUsd != null ? fmtUsd(p.unclaimedFeesUsd) : '—'}</td>
                      <td>
                        <BinRange pos={p} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : tel.status === 'no-port' && agent.running ? (
            <p className="muted small mt">No telemetry — agent's IPC port not available.</p>
          ) : tel.status === 'connecting' && agent.running ? (
            <p className="muted small mt">Connecting to agent…</p>
          ) : tel.status === 'auth-failed' ? (
            <p className="error small mt">Token rejected by agent daemon.</p>
          ) : agent.running ? (
            <p className="muted small mt">No open positions.</p>
          ) : null}

          {/* ── Execution summary ── */}
          {(exec.lastTool || exec.lastDecision) && (
            <div className="agent-meta" style={{ marginTop: 8, flexDirection: 'column', gap: 2 }}>
              {exec.lastTool && (
                <span>
                  Last tool: <span style={{ fontFamily: 'var(--mono)' }}>{exec.lastTool}</span>
                  {exec.lastToolArgs ? <span className="muted"> ({exec.lastToolArgs})</span> : null}
                </span>
              )}
              {exec.lastDecision && (
                <span>
                  Last decision: <span className="muted">{exec.lastDecision}</span>
                </span>
              )}
              {exec.confidence != null && <span>Confidence: {(exec.confidence * 100).toFixed(0)}%</span>}
            </div>
          )}

          {/* ── Strategy switch ── */}
          <StrategySwitch
            agent={agent}
            strategies={strategies}
            token={token}
            onApplied={onReload}
            onStop={onStopById}
            onStart={onStartById}
          />
        </>
      )}
    </article>
  )
}

// ─── Fleet summary strip ──────────────────────────────────────────────────────
interface FleetStripProps {
  agents: ManagedAgent[]
}
function FleetStrip({ agents }: FleetStripProps) {
  const allTelemetry = useAllTelemetry()
  const total = agents.length
  const running = agents.filter((a) => a.running).length
  const stopped = total - running

  // Aggregate total open PnL and live detection from real telemetry data
  let totalPnl: number | null = null
  let hasLive = false
  for (const agent of agents) {
    const tel = allTelemetry.get(agent.id)
    if (tel?.snapshot) {
      totalPnl = (totalPnl ?? 0) + Number(tel.snapshot.totalPnlUsd ?? 0)
      if (tel.snapshot.dryRun === false) hasLive = true
    }
  }

  return (
    <section className="fleet-strip" aria-label="Fleet summary">
      <div className="fleet-stat">
        <strong>{total}</strong>total
      </div>
      <div className="fleet-stat">
        <strong style={{ color: 'var(--accent)' }}>{running}</strong>running
      </div>
      <div className="fleet-stat">
        <strong>{stopped}</strong>stopped
      </div>
      {totalPnl != null && (
        <div className="fleet-stat">
          <strong className={totalPnl >= 0 ? 'pos' : 'neg'}>
            {(totalPnl < 0 ? '-$' : '$') + Math.abs(totalPnl).toFixed(2)}
          </strong>
          open PnL
        </div>
      )}
      {hasLive && (
        <div className="fleet-stat">
          <span className="badge badge-live">LIVE</span>
        </div>
      )}
    </section>
  )
}

// ─── AgentsView ───────────────────────────────────────────────────────────────
interface Props {
  agents: ManagedAgent[]
  busy: Record<string, boolean>
  agentsError: string | null
  strategies: StrategySummary[]
  telemetry: FleetTelemetry
  token: string
  onCreate: (name: string) => Promise<void>
  onStart: (id: string) => Promise<void>
  onStop: (id: string) => Promise<void>
  onSetStrategy: (id: string, strategyId: string) => Promise<void>
  onReload: () => void
  onCreateStrategy: () => void
}

export function AgentsView(props: Props) {
  const [name, setName] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const now = useNow(5000)

  const submit = async () => {
    const value = name.trim()
    if (!value) return
    setCreateError(null)
    try {
      await props.onCreate(value)
      setName('')
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Create failed')
    }
  }

  return (
    <>
      {props.agentsError && (
        <div className="banner banner-error" role="alert">
          {props.agentsError}
        </div>
      )}

      {props.agents.length > 0 && <FleetStrip agents={props.agents} />}

      {props.agents.length === 0 ? (
        <section className="card">
          <p className="muted">No agents yet — create one below.</p>
        </section>
      ) : (
        props.agents.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            strategies={props.strategies}
            busy={!!props.busy[agent.id]}
            token={props.token}
            now={now}
            onStart={() => props.onStart(agent.id)}
            onStop={() => props.onStop(agent.id)}
            onStopById={props.onStop}
            onStartById={props.onStart}
            onReload={props.onReload}
          />
        ))
      )}

      {/* ── Create agent form ── */}
      <section className="card" aria-label="Create new agent">
        <h2>New agent</h2>
        <div className="row">
          <input
            id="new-agent-name"
            value={name}
            placeholder="Agent name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
          />
          <button type="button" className="primary" onClick={() => void submit()}>
            Create agent
          </button>
          <button type="button" className="ghost" onClick={props.onCreateStrategy}>
            Create strategy
          </button>
        </div>
        {createError && <div className="error small mt">{createError}</div>}
        <p className="muted small mt">Creates an agent configured for dry-run.</p>
      </section>
    </>
  )
}
