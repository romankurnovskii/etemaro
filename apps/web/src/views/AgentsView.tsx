import { useEffect, useState } from 'react'
import { AgentCard } from '../components/AgentCard'
import { Button, Field, Pill } from '../components/ui'
import { useAgentMutations, useAgentsQuery } from '../hooks/useAgentsQuery'
import { useHealthQuery } from '../hooks/useHealthQuery'
import type { StrategySummary } from '../lib/ipc'
import { logsForAgent } from '../lib/logs'
import { useConnectionStore } from '../stores/connectionStore'
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
  const now = useNow(CLOCK_TICK_MS)

  const token = useUiStore((s) => s.token)
  const agentsQuery = useAgentsQuery(token)
  const { create, setRunning, setStrategy } = useAgentMutations(token)

  const telemetry = useTelemetryStore((s) => s.byAgent)
  const logs = useLogsStore((s) => s.store)
  const health = useHealthQuery().data
  const daemonId = health?.agentId
  const hostOnly = health?.hostOnly === true
  const daemonDryRun = useConnectionStore((s) => s.snapshot?.dryRun)

  const agents = agentsQuery.data ?? []
  const running = agents.filter((a) => a.running).length

  const submit = () => {
    const value = name.trim()
    if (!value) return
    create.mutate(value, { onSuccess: () => setName('') })
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
          {/* The process serving this console is either an agent itself (default)
              or a host-only control plane. Say which, so "0 running" is never
              mistaken for a stopped fleet. */}
          <p className="muted small daemon-line">
            <Pill tone="success" dot>
              {hostOnly ? 'Console host' : 'Console daemon'}
            </Pill>{' '}
            <span className="mono">{daemonId ?? '—'}</span>
            {' · '}
            {hostOnly
              ? 'host only — does not trade. Every agent below runs its own cycles.'
              : `${daemonDryRun === false ? 'LIVE' : 'dry-run'} — runs its own cycles and sends notifications. Managed agents are listed below.`}
          </p>
        </div>
        <form
          className="create-agent"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <Field label="New agent (dry-run)" htmlFor="new-agent-name">
            <div className="row nowrap">
              <input
                id="new-agent-name"
                value={name}
                placeholder="Agent name"
                onChange={(e) => setName(e.target.value)}
              />
              <Button type="submit" variant="primary" disabled={!name.trim() || create.isPending}>
                {create.isPending ? 'Creating…' : 'Create'}
              </Button>
              <Button variant="quiet" onClick={onCreateStrategy}>
                New strategy
              </Button>
            </div>
          </Field>
          {create.error ? (
            <p className="msg msg-error" role="alert">
              {create.error.message}
            </p>
          ) : null}
        </form>
      </section>

      {agentsQuery.error ? (
        <div className="msg msg-error" role="alert">
          Could not load agents: {agentsQuery.error.message}{' '}
          <Button size="sm" onClick={() => void agentsQuery.refetch()}>
            Retry
          </Button>
        </div>
      ) : null}

      {agentsQuery.isPending ? (
        <p className="muted">Loading agents…</p>
      ) : agents.length === 0 && !agentsQuery.error ? (
        <div className="empty">
          <p>No agents configured yet.</p>
          <p className="muted small">Create one above — it starts in dry-run mode.</p>
        </div>
      ) : (
        <div className="agent-grid">
          {agents.map((agent) => {
            const busy = setRunning.isPending && setRunning.variables?.id === agent.id
            const actionError =
              setRunning.error && setRunning.variables?.id === agent.id ? setRunning.error.message : undefined
            return (
              <AgentCard
                key={agent.id}
                agent={agent}
                telemetry={telemetry[agent.id]}
                logs={logsForAgent(logs, agent.id)}
                writeTools={writeTools}
                strategies={strategies}
                busy={Boolean(busy)}
                error={actionError}
                now={now}
                onStart={(id) => setRunning.mutate({ id, running: true })}
                onStop={(id) => setRunning.mutate({ id, running: false })}
                onSetStrategy={(id, strategyId) => setStrategy.mutateAsync({ id, strategyId })}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
