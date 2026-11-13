import { useState } from 'react'
import { DecisionFeed } from '../components/DecisionFeed'
import { LoopPipeline } from '../components/LoopPipeline'
import { PositionMetricsCard } from '../components/PositionMetricsCard'
import { StrategyDiffModal } from '../components/StrategyDiffModal'
import { deriveLoopStage, extractLastTool, isLoopActive, relativeTime, shortenAddress } from '../lib/agentViz'
import type { Decision, LogEntry, ManagedAgent, StateSnapshot, StrategySummary } from '../lib/ipc'

interface Props {
  agents: ManagedAgent[]
  busy: Record<string, boolean>
  strategies: StrategySummary[]
  decisions: Decision[]
  decisionsLoading: boolean
  decisionsError: string | null
  logs: LogEntry[]
  snapshot: StateSnapshot | null
  token: string
  onCreate: (name: string) => Promise<void>
  onStart: (id: string) => Promise<void>
  onStop: (id: string) => Promise<void>
  onSetStrategy: (id: string, strategyId: string) => Promise<void>
  onCreateStrategy: () => void
}

export function AgentsView(props: Props) {
  const [name, setName] = useState('')
  const [pendingDiff, setPendingDiff] = useState<{
    agent: ManagedAgent
    targetStrategyId: string
  } | null>(null)

  const submit = () => {
    const value = name.trim()
    if (!value) return
    void props.onCreate(value).then(() => setName(''))
  }

  const stage = deriveLoopStage(props.logs)
  const active = isLoopActive(props.logs)
  const runningCount = props.agents.filter((a) => a.running).length
  const stoppedCount = props.agents.length - runningCount
  const lastTool = extractLastTool(props.logs)
  const latestDecision = props.decisions[0] ?? null

  const handleStrategySelect = (agent: ManagedAgent, newStrategyId: string) => {
    if (!newStrategyId || newStrategyId === agent.strategyId) return
    setPendingDiff({ agent, targetStrategyId: newStrategyId })
  }

  return (
    <>
      {/* ─── Fleet & Lifecycle Pipeline ─── */}
      <section className="card fleet-card">
        <div className="fleet-header">
          <div>
            <h2>Agent Fleet & Pipeline</h2>
            <div className="fleet-metrics-strip mt-1">
              <span className="fleet-pill fleet-pill-running">
                <strong>{runningCount}</strong> Running
              </span>
              <span className="fleet-pill fleet-pill-stopped">
                <strong>{stoppedCount}</strong> Stopped
              </span>
              <span className="fleet-pill fleet-pill-total">
                <strong>{props.agents.length}</strong> Total Agents
              </span>
            </div>
          </div>
          <div className="fleet-status-badge">
            <span className={`live-indicator ${active ? 'live-on' : 'live-idle'}`}>
              <span className="live-dot" />
              {active ? 'LOOP ITERATING' : 'IDLE / LISTENING'}
            </span>
          </div>
        </div>

        <LoopPipeline stage={stage} active={active} />
      </section>

      {/* ─── Execution Summary & Confidence Metrics ─── */}
      <section className="card execution-summary-card">
        <div className="section-head">
          <h2>Execution Summary & Telemetry</h2>
          <span className="muted small">Real-time daemon state</span>
        </div>

        <div className="metrics mt">
          <div className="metric">
            <div className="label">Loop Stage</div>
            <div className="value small font-bold text-accent">{stage}</div>
          </div>
          <div className="metric">
            <div className="label">Last Tool Invoked</div>
            <div className="value small mono">
              {lastTool ? (
                <span title={`Status: ${lastTool.status} at ${lastTool.timestamp}`}>
                  {lastTool.name}{' '}
                  <span
                    className={`status-dot status-${lastTool.status === 'completed' ? 'connected' : lastTool.status === 'failed' ? 'disconnected' : 'connecting'}`}
                  />
                </span>
              ) : (
                'None yet'
              )}
            </div>
          </div>
          <div className="metric">
            <div className="label">Latest Decision</div>
            <div className="value small">
              {latestDecision ? (
                <span className="font-medium">
                  {latestDecision.type.toUpperCase()}{' '}
                  <span className="muted tiny">({relativeTime(latestDecision.ts)})</span>
                </span>
              ) : (
                'Awaiting decisions'
              )}
            </div>
          </div>
          <div className="metric">
            <div className="label">Decision Confidence</div>
            <div className="value small font-bold text-accent">
              {latestDecision?.metrics?.confidence
                ? `${Math.round(Number(latestDecision.metrics.confidence) * 100)}%`
                : latestDecision?.metrics?.organic_score
                  ? `Score ${Number(latestDecision.metrics.organic_score).toFixed(1)}`
                  : 'Calibrated (100%)'}
            </div>
          </div>
        </div>
      </section>

      {/* ─── Position Metrics (Price Bins, Range, Asset Split) ─── */}
      <PositionMetricsCard positions={props.snapshot?.positions ?? []} />

      {/* ─── Agent Fleet Cards ─── */}
      <section className="card">
        <div className="section-head">
          <h2>Managed Agents</h2>
          <span className="muted small">{props.agents.length} agent(s) configured</span>
        </div>

        {props.agents.length === 0 ? (
          <p className="muted mt">No agents found. Create an agent below to begin.</p>
        ) : (
          <div className="agents-fleet-list mt">
            {props.agents.map((agent) => (
              <div className="agent-fleet-card" key={agent.id}>
                <div className="agent-card-top">
                  <div className="agent-identity">
                    <span className={`status-dot ${agent.running ? 'status-connected' : 'status-disconnected'}`} />
                    <div>
                      <strong className="agent-title">{agent.name}</strong>
                      <span className={`agent-status-tag ${agent.running ? 'tag-running' : 'tag-stopped'}`}>
                        {agent.running ? 'RUNNING' : 'STOPPED'}
                      </span>
                    </div>
                  </div>

                  <div className="agent-actions">
                    {agent.running ? (
                      <button
                        type="button"
                        className="danger"
                        disabled={props.busy[agent.id]}
                        onClick={() => void props.onStop(agent.id)}
                      >
                        Stop Agent
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="primary"
                        disabled={props.busy[agent.id]}
                        onClick={() => void props.onStart(agent.id)}
                      >
                        Start Agent
                      </button>
                    )}
                  </div>
                </div>

                <div className="agent-details-grid mt">
                  <div>
                    <span className="muted tiny">ACTIVE STRATEGY</span>
                    <div className="mono small font-medium">{agent.strategyId ?? 'None assigned'}</div>
                  </div>
                  <div>
                    <span className="muted tiny">PROCESS ID</span>
                    <div className="mono small">{agent.pid ? `pid ${agent.pid}` : 'Not running'}</div>
                  </div>
                  <div>
                    <span className="muted tiny">ACTIVE POOL / PAIR</span>
                    <div className="mono small">{props.snapshot?.positions?.[0]?.tokenSymbol ?? 'SOL DLMM Pool'}</div>
                  </div>
                  <div>
                    <span className="muted tiny">CONFIG LOCATION</span>
                    <div className="mono small" title={agent.configPath}>
                      {shortenAddress(agent.configPath, 10, 8)}
                    </div>
                  </div>
                </div>

                <div className="strategy-control-row mt">
                  <label className="strategy-select-label" htmlFor={`strat-select-${agent.id}`}>
                    <span className="muted small">Switch Strategy:</span>
                    <select
                      id={`strat-select-${agent.id}`}
                      value={agent.strategyId ?? ''}
                      onChange={(e) => handleStrategySelect(agent, e.target.value)}
                    >
                      <option value="" disabled>
                        Select strategy…
                      </option>
                      {props.strategies.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name ?? s.id}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="button" className="ghost" onClick={props.onCreateStrategy}>
                    + Add New Strategy
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ─── New Agent Provisioning ─── */}
      <section className="card">
        <h2>Provision New Agent</h2>
        <div className="row mt">
          <input
            value={name}
            placeholder="Agent name (e.g. sol-dlmm-agent-01)"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
          />
          <button type="button" className="primary" onClick={submit}>
            Create Agent
          </button>
        </div>
        <p className="muted small mt-1">
          Provisions an isolated agent environment configured for dry-run trading. Start it with one click above.
        </p>
      </section>

      {/* ─── Structured Decision Log Feed ─── */}
      <section className="card">
        <div className="section-head">
          <div>
            <h2>Structured Decision Feed</h2>
            <p className="muted small">Records reason, metrics, risks, and rejected alternatives for every action</p>
          </div>
        </div>
        <DecisionFeed decisions={props.decisions} loading={props.decisionsLoading} error={props.decisionsError} />
      </section>

      {/* ─── Strategy Diff Modal ─── */}
      {pendingDiff ? (
        <StrategyDiffModal
          agentName={pendingDiff.agent.name}
          currentStrategyId={pendingDiff.agent.strategyId}
          targetStrategyId={pendingDiff.targetStrategyId}
          token={props.token}
          onConfirm={async () => {
            await props.onSetStrategy(pendingDiff.agent.id, pendingDiff.targetStrategyId)
          }}
          onClose={() => setPendingDiff(null)}
        />
      ) : null}
    </>
  )
}
