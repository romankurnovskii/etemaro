import { useState } from 'react'
import { DecisionFeed } from '../components/DecisionFeed'
import { LoopPipeline } from '../components/LoopPipeline'
import { deriveLoopStage, isLoopActive, shortenAddress } from '../lib/agentViz'
import type { Decision, LogEntry, ManagedAgent, StrategySummary } from '../lib/ipc'

interface Props {
  agents: ManagedAgent[]
  busy: Record<string, boolean>
  strategies: StrategySummary[]
  /** Structured decisions recorded by the daemon. */
  decisions: Decision[]
  decisionsLoading: boolean
  decisionsError: string | null
  /** Live log stream, used to derive the loop stage. */
  logs: LogEntry[]
  onCreate: (name: string) => Promise<void>
  onStart: (id: string) => Promise<void>
  onStop: (id: string) => Promise<void>
  onSetStrategy: (id: string, strategyId: string) => Promise<void>
  onCreateStrategy: () => void
}

export function AgentsView(props: Props) {
  const [name, setName] = useState('')

  const submit = () => {
    const value = name.trim()
    if (!value) return
    void props.onCreate(value).then(() => setName(''))
  }

  const stage = deriveLoopStage(props.logs)
  const active = isLoopActive(props.logs)
  const runningCount = props.agents.filter((a) => a.running).length

  return (
    <>
      <section className="card fleet">
        <div className="fleet-head">
          <div>
            <h2>Fleet</h2>
            <p className="muted small">
              {runningCount} running · {props.agents.length} total
            </p>
          </div>
          <span className={`live-indicator${active ? ' live-on' : ''}`}>
            <span className="live-dot" />
            {active ? 'live' : 'idle'}
          </span>
        </div>
        <LoopPipeline stage={stage} active={active} />
      </section>

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
        <p className="muted small">Creates an agent configured for dry-run. Start it with one click below.</p>
      </section>

      {props.agents.length === 0 ? (
        <section className="card">
          <p className="muted">No agents yet — create one above.</p>
        </section>
      ) : (
        props.agents.map((agent) => (
          <section className="card agent-card" key={agent.id}>
            <div className="agent-row">
              <span className={`status-dot ${agent.running ? 'status-active' : 'status-stopped'}`} />
              <div className="grow">
                <div>
                  <strong>{agent.name}</strong>{' '}
                  <span className="muted small">{agent.running ? 'running' : 'stopped'}</span>
                </div>
                <div className="muted small mono">
                  {agent.strategyId ?? 'no strategy'}
                  {agent.pid ? ` · pid ${agent.pid}` : ''}
                </div>
              </div>
              {agent.running ? (
                <button
                  type="button"
                  className="danger"
                  disabled={props.busy[agent.id]}
                  onClick={() => void props.onStop(agent.id)}
                >
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  className="primary"
                  disabled={props.busy[agent.id]}
                  onClick={() => void props.onStart(agent.id)}
                >
                  Start
                </button>
              )}
            </div>

            <dl className="agent-meta">
              <div>
                <dt>Data dir</dt>
                <dd className="mono">{shortenAddress(agent.dataDir, 12, 8)}</dd>
              </div>
              <div>
                <dt>Config</dt>
                <dd className="mono">{shortenAddress(agent.configPath, 14, 10)}</dd>
              </div>
            </dl>

            <div className="row mt">
              <span className="muted small">Strategy</span>
              <select
                value={agent.strategyId ?? ''}
                onChange={(e) => void props.onSetStrategy(agent.id, e.target.value)}
              >
                {props.strategies.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name ?? s.id}
                  </option>
                ))}
              </select>
              <button type="button" className="ghost" onClick={props.onCreateStrategy}>
                Create strategy
              </button>
            </div>
          </section>
        ))
      )}

      <section className="card">
        <div className="fleet-head">
          <div>
            <h2>Decision log</h2>
            <p className="muted small">Structured decisions recorded by the daemon</p>
          </div>
        </div>
        <DecisionFeed decisions={props.decisions} loading={props.decisionsLoading} error={props.decisionsError} />
      </section>
    </>
  )
}
