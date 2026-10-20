import { useEffect, useState } from 'react'
import { AgentCard } from '../components/AgentCard'
import type { AgentsController } from '../hooks/useAgents'
import type { AgentTelemetry } from '../hooks/useAgentTelemetry'
import type { StrategySummary } from '../lib/ipc'
import { type LogStore, logsForAgent } from '../lib/logs'

const CLOCK_TICK_MS = 5000

interface Props {
  controller: AgentsController
  telemetry: Readonly<Record<string, AgentTelemetry>>
  logs: LogStore
  writeTools: ReadonlySet<string>
  strategies: StrategySummary[]
  token: string
  onCreateStrategy: () => void
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

export function AgentsView({ controller, telemetry, logs, writeTools, strategies, token, onCreateStrategy }: Props) {
  const [name, setName] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const now = useNow(CLOCK_TICK_MS)
  const { agents } = controller
  const running = agents.filter((a) => a.running).length

  const submit = () => {
    const value = name.trim()
    if (!value) return
    setCreateError(null)
    controller
      .create(value)
      .then(() => setName(''))
      .catch((e: unknown) => setCreateError(e instanceof Error ? e.message : String(e)))
  }

  return (
    <div className="stack">
      <section className="section-head">
        <div>
          <h2>Agents</h2>
          <p className="muted">
            {agents.length} configured · {running} running. Live data is read from each running agent's own IPC port;
            loop phase is inferred from that agent's logs.
          </p>
        </div>
        <form
          className="create-agent"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <label htmlFor="new-agent-name" className="field-label">
            New agent (dry-run)
          </label>
          <div className="row nowrap">
            <input
              id="new-agent-name"
              value={name}
              placeholder="Agent name"
              onChange={(e) => setName(e.target.value)}
            />
            <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
              Create
            </button>
            <button type="button" className="btn btn-quiet" onClick={onCreateStrategy}>
              New strategy
            </button>
          </div>
          {createError ? (
            <p className="msg msg-error" role="alert">
              {createError}
            </p>
          ) : null}
        </form>
      </section>

      {controller.loadError ? (
        <div className="msg msg-error" role="alert">
          Could not load agents: {controller.loadError}{' '}
          <button type="button" className="btn btn-sm" onClick={controller.reload}>
            Retry
          </button>
        </div>
      ) : null}

      {!controller.loaded ? (
        <p className="muted">Loading agents…</p>
      ) : agents.length === 0 && !controller.loadError ? (
        <div className="empty">
          <p>No agents configured yet.</p>
          <p className="muted small">Create one above — it starts in dry-run mode.</p>
        </div>
      ) : (
        <div className="agent-grid">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              telemetry={telemetry[agent.id]}
              logs={logsForAgent(logs, agent.id)}
              writeTools={writeTools}
              strategies={strategies}
              token={token}
              busy={Boolean(controller.busy[agent.id])}
              error={controller.errors[agent.id]}
              now={now}
              onStart={controller.start}
              onStop={controller.stop}
              onSetStrategy={controller.setStrategy}
            />
          ))}
        </div>
      )}
    </div>
  )
}
