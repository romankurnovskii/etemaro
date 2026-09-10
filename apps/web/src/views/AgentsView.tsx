import { useState } from 'react'
import type { ManagedAgent, StrategySummary } from '../lib/ipc'

interface Props {
  agents: ManagedAgent[]
  busy: Record<string, boolean>
  strategies: StrategySummary[]
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

  return (
    <>
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
          <section className="card" key={agent.id}>
            <div className="agent-row">
              <span className={`status-dot ${agent.running ? 'status-connected' : 'status-disconnected'}`} />
              <div className="grow">
                <div>
                  <strong>{agent.name}</strong>{' '}
                  <span className="muted small">{agent.running ? 'running' : 'stopped'}</span>
                </div>
                {agent.strategyId ? <div className="muted small">{agent.strategyId}</div> : null}
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
    </>
  )
}
