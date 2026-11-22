import { useEffect, useState } from 'react'
import { AgentCard } from '../components/AgentCard'
import type { StrategySummary } from '../lib/ipc'
import { logsForAgent } from '../lib/logs'
import { useAgentsStore } from '../stores/agentsStore'
import { useLogsStore } from '../stores/logsStore'
import { useTelemetryStore } from '../stores/telemetryStore'
import { useUiStore } from '../stores/uiStore'

const CLOCK_TICK_MS = 5000

interface Props {
  writeTools: ReadonlySet<string>
  strategies: StrategySummary[]
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

export function AgentsView({ writeTools, strategies, onCreateStrategy }: Props) {
  const [name, setName] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const now = useNow(CLOCK_TICK_MS)

  const token = useUiStore((s) => s.token)
  const agents = useAgentsStore((s) => s.agents)
  const loaded = useAgentsStore((s) => s.loaded)
  const loadError = useAgentsStore((s) => s.loadError)
  const busy = useAgentsStore((s) => s.busy)
  const errors = useAgentsStore((s) => s.errors)
  const create = useAgentsStore((s) => s.create)
  const start = useAgentsStore((s) => s.start)
  const stop = useAgentsStore((s) => s.stop)
  const setStrategy = useAgentsStore((s) => s.setStrategy)
  const load = useAgentsStore((s) => s.load)

  const telemetry = useTelemetryStore((s) => s.byAgent)
  const logs = useLogsStore((s) => s.store)

  const running = agents.filter((a) => a.running).length

  const submit = () => {
    const value = name.trim()
    if (!value) return
    setCreateError(null)
    create(token, value)
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

      {loadError ? (
        <div className="msg msg-error" role="alert">
          Could not load agents: {loadError}{' '}
          <button type="button" className="btn btn-sm" onClick={() => void load(token)}>
            Retry
          </button>
        </div>
      ) : null}

      {!loaded ? (
        <p className="muted">Loading agents…</p>
      ) : agents.length === 0 && !loadError ? (
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
              busy={Boolean(busy[agent.id])}
              error={errors[agent.id]}
              now={now}
              onStart={(id) => start(token, id)}
              onStop={(id) => stop(token, id)}
              onSetStrategy={(id, strategyId) => setStrategy(token, id, strategyId)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
