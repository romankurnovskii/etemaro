import { useState } from 'react'
import { useAgentConnection } from '../hooks/useAgentConnection'
import type { ManagedAgent, StrategySummary } from '../lib/ipc'

interface Props {
  agents: ManagedAgent[]
  busy: Record<string, boolean>
  strategies: StrategySummary[]
  token: string
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
        <div className="fleet-grid">
          {props.agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} {...props} />
          ))}
        </div>
      )}
    </>
  )
}

function AgentCard({ agent, ...props }: Props & { agent: ManagedAgent }) {
  const [nextStrategy, setNextStrategy] = useState('')
  const [switching, setSwitching] = useState(false)
  const telemetry = useAgentConnection(
    agent.running && agent.ipcPort
      ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:${agent.ipcPort}`
      : '',
    props.token,
  )
  const lastLog = telemetry.logs.at(-1)
  const lastTool = [...telemetry.logs].reverse().find((l) => l.category === 'tool_start')
  const lastDecision = [...telemetry.logs].reverse().find((l) => l.category === 'agent_loop_end')
  const positions = telemetry.snapshot?.positions ?? []
  const phase = !agent.running
    ? 'Stopped'
    : telemetry.status !== 'connected'
      ? 'Error'
      : telemetry.snapshot?.busy
        ? lastTool?.category === lastLog?.category
          ? 'Rebalancing'
          : 'Evaluating'
        : lastDecision
          ? 'Settled'
          : 'Idle'
  const selected = props.strategies.find((strategy) => strategy.id === nextStrategy)
  const current = props.strategies.find((strategy) => strategy.id === agent.strategyId)
  const uptime = agent.startedAt ? Math.max(0, Math.floor((Date.now() - Date.parse(agent.startedAt)) / 60000)) : null

  return (
    <section className="card agent-card">
      <div className="agent-row">
        <span
          className={`status-dot ${phase === 'Error' || phase === 'Stopped' ? 'status-disconnected' : 'status-connected'}`}
        />
        <div className="grow">
          <div>
            <strong>{agent.name}</strong> <span className="muted small">{phase}</span>
          </div>
          <div className="muted small">
            {agent.strategyId ?? 'No strategy'} · {uptime == null ? 'No uptime' : `${uptime}m uptime`}
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
      {agent.running ? (
        <div className="telemetry">
          <div className="muted small">
            Last heartbeat:{' '}
            {telemetry.lastHeartbeat ? new Date(telemetry.lastHeartbeat).toLocaleTimeString() : 'Waiting for state'}
          </div>
          <div className="pipeline">
            {['Idle', 'Evaluating', 'Rebalancing', 'Settled'].map((step) => (
              <span key={step} className={phase === step ? 'active' : ''}>
                {step}
              </span>
            ))}
          </div>
          <div className="muted small">Last decision: {lastDecision?.message ?? '—'}</div>
          <div className="muted small">Last tool: {String(lastTool?.metadata?.tool ?? '—')}</div>
          <div className="muted small">Confidence: {String(lastDecision?.metadata?.confidence ?? 'not reported')}</div>
          {positions.map((position) => (
            <div className="position-summary" key={position.positionAddress}>
              <strong>{position.tokenSymbol ?? 'Pair unavailable'}</strong>{' '}
              <span className="mono">{position.poolAddress.slice(0, 10)}…</span>
              <div className="muted small">
                Bins {position.lowerBin ?? '—'} → {position.activeBin ?? '—'} → {position.upperBin ?? '—'} ·{' '}
                {position.inRange == null ? 'Range unknown' : position.inRange ? 'In range' : 'Out of range'}
              </div>
              <div className="muted small">Asset split: not reported by daemon</div>
            </div>
          ))}
          {positions.length === 0 ? <div className="muted small">No open positions</div> : null}
        </div>
      ) : null}
      <div className="row mt">
        <span className="muted small">Strategy</span>
        <select
          aria-label={`Strategy for ${agent.name}`}
          value={nextStrategy || agent.strategyId || ''}
          onChange={(e) => setNextStrategy(e.target.value)}
        >
          {!agent.strategyId ? <option value="">Select strategy</option> : null}
          {props.strategies.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name ?? s.id}
            </option>
          ))}
        </select>
        {nextStrategy && nextStrategy !== agent.strategyId ? (
          <div className="strategy-preview">
            <span>
              <strong>Switch preview</strong>
              <br />
              Name: {current?.name ?? agent.strategyId ?? 'None'} → {selected?.name ?? nextStrategy}
              <br />
              LP: {current?.lpStrategy ?? '—'} → {selected?.lpStrategy ?? '—'}
              <br />
              Best for: {current?.bestFor ?? '—'} → {selected?.bestFor ?? '—'}
            </span>
            <button
              type="button"
              className="primary"
              disabled={switching}
              onClick={() => {
                setSwitching(true)
                void props
                  .onSetStrategy(agent.id, nextStrategy)
                  .then(() => setNextStrategy(''))
                  .finally(() => setSwitching(false))
              }}
            >
              Apply switch
            </button>
          </div>
        ) : null}
        <button type="button" className="ghost" onClick={props.onCreateStrategy}>
          Create strategy
        </button>
      </div>
    </section>
  )
}
