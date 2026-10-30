import { useState } from 'react'
import { AgentCard } from '../components/AgentCard'
import type { LogEntry, ManagedAgent, StateSnapshot, StrategySummary } from '../lib/ipc'

interface Props {
  agents: ManagedAgent[]
  busy: Record<string, boolean>
  error: string | null
  logs: LogEntry[]
  snapshot: StateSnapshot | null
  token: string
  strategies: StrategySummary[]
  onCreate: (name: string) => Promise<void>
  onStart: (id: string) => Promise<void>
  onStop: (id: string) => Promise<void>
  onSetStrategy: (id: string, strategyId: string) => Promise<void>
  onCreateStrategy: () => void
}

export function AgentsView(props: Props) {
  const [name, setName] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)

  const submit = () => {
    const value = name.trim()
    if (!value) return
    setCreateError(null)
    props
      .onCreate(value)
      .then(() => setName(''))
      .catch((e: unknown) => setCreateError(e instanceof Error ? e.message : String(e)))
  }

  const running = props.agents.filter((a) => a.running).length

  return (
    <>
      {props.error ? (
        <p className="banner banner-error" role="alert">
          Can’t reach the agent API: {props.error}
        </p>
      ) : null}

      <div className="fleet-head">
        <h2>Fleet</h2>
        <span className="muted small">
          {props.agents.length} agent{props.agents.length === 1 ? '' : 's'} · {running} running
        </span>
        <span className="spacer" />
        <button type="button" className="ghost" onClick={props.onCreateStrategy}>
          Create strategy
        </button>
      </div>

      {props.agents.length === 0 ? (
        <section className="card">
          <p className="muted">No agents yet — create one below.</p>
        </section>
      ) : (
        <div className="fleet">
          {props.agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              busy={Boolean(props.busy[agent.id])}
              logs={props.logs}
              snapshot={props.snapshot}
              strategies={props.strategies}
              token={props.token}
              onStart={props.onStart}
              onStop={props.onStop}
              onSetStrategy={props.onSetStrategy}
            />
          ))}
        </div>
      )}

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
        {createError ? <p className="error small">{createError}</p> : null}
        <p className="muted small">Creates an agent configured for dry-run. Start it with one click above.</p>
      </section>
    </>
  )
}
