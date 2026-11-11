import { useMemo, useState } from 'react'
import { fetchJson } from '../lib/api'
import type { LogEntry, ManagedAgent, StateSnapshot, StrategySummary } from '../lib/ipc'

const PHASES = ['Idle', 'Evaluating', 'Rebalancing', 'Settled'] as const
type Phase = (typeof PHASES)[number]

interface Props {
  agents: ManagedAgent[]
  busy: Record<string, boolean>
  strategies: StrategySummary[]
  snapshot: StateSnapshot | null
  logs: LogEntry[]
  token: string
  onCreate: (name: string) => Promise<void>
  onStart: (id: string) => Promise<void>
  onStop: (id: string) => Promise<void>
  onSetStrategy: (id: string, strategyId: string) => Promise<void>
  onCreateStrategy: () => void
}

function loopPhase(agent: ManagedAgent, snapshot: StateSnapshot | null): Phase {
  if (!agent.running) return 'Idle'
  const open = snapshot?.positions?.length ?? 0
  if (snapshot?.busy && open > 0) return 'Rebalancing'
  if (snapshot?.busy) return 'Evaluating'
  if (open > 0) return 'Settled'
  return 'Idle'
}

function lastLogFor(agent: ManagedAgent, logs: LogEntry[]): LogEntry | undefined {
  const id = agent.id
  for (let i = logs.length - 1; i >= 0; i--) {
    const row = logs[i]
    if (row && (row.agentId === id || row.agentId === agent.name)) return row
  }
  return undefined
}

function fmtUsd(value: number | undefined): string {
  const v = Number(value ?? 0)
  return (v < 0 ? '-$' : '$') + Math.abs(v).toFixed(2)
}

function compact(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function AgentsView(props: Props) {
  const [name, setName] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pendingStrategy, setPendingStrategy] = useState<{ agentId: string; strategyId: string } | null>(null)
  const [preview, setPreview] = useState<string>('')
  const [previewBusy, setPreviewBusy] = useState(false)

  const selected = useMemo(
    () => props.agents.find((a) => a.id === (selectedId ?? props.agents[0]?.id)) ?? null,
    [props.agents, selectedId],
  )

  const submit = () => {
    const value = name.trim()
    if (!value) return
    void props.onCreate(value).then(() => setName(''))
  }

  const requestStrategy = async (agent: ManagedAgent, strategyId: string) => {
    if (!strategyId || strategyId === (agent.strategyId ?? '')) return
    setPendingStrategy({ agentId: agent.id, strategyId })
    setPreviewBusy(true)
    setPreview('')
    try {
      const [current, next] = await Promise.all([
        agent.strategyId
          ? fetchJson<{ result?: unknown }>('/api/tool', props.token, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: 'get_strategy', args: { id: agent.strategyId } }),
            })
          : Promise.resolve({ result: { id: null } }),
        fetchJson<{ result?: unknown }>('/api/tool', props.token, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'get_strategy', args: { id: strategyId } }),
        }),
      ])
      setPreview(`current:\n${compact(current.result)}\n\nnext:\n${compact(next.result)}`)
    } catch (e) {
      setPreview(`Preview unavailable (${e instanceof Error ? e.message : String(e)}).\nApply ${strategyId} anyway?`)
    } finally {
      setPreviewBusy(false)
    }
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
        <div className="fleet">
          {props.agents.map((agent) => {
            const phase = loopPhase(agent, agent.running ? props.snapshot : null)
            const last = lastLogFor(agent, props.logs)
            const pair = props.snapshot?.positions?.[0]?.tokenSymbol
            return (
              <section
                className="card"
                key={agent.id}
                style={selected?.id === agent.id ? { outline: '1px solid var(--accent)' } : undefined}
              >
                <div className="agent-row">
                  <span className={`status-dot ${agent.running ? 'status-connected' : 'status-disconnected'}`} />
                  <div className="grow">
                    <div>
                      <button type="button" className="ghost" onClick={() => setSelectedId(agent.id)}>
                        <strong>{agent.name}</strong>
                      </button>{' '}
                      <span className={`badge ${agent.running ? 'badge-read' : 'badge-idle'}`}>
                        {agent.running ? 'running' : 'stopped'}
                      </span>
                    </div>
                    <div className="muted small">
                      {agent.strategyId ?? 'no strategy'}
                      {pair ? ` · ${pair}` : ''}
                      {agent.pid ? ` · pid ${agent.pid}` : ''}
                    </div>
                  </div>
                  {agent.running ? (
                    <button
                      type="button"
                      className="danger"
                      disabled={props.busy[agent.id]}
                      onClick={() => {
                        void props.onStop(agent.id)
                      }}
                    >
                      Stop
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="primary"
                      disabled={props.busy[agent.id]}
                      onClick={() => {
                        void props.onStart(agent.id)
                      }}
                    >
                      Start
                    </button>
                  )}
                </div>
                <div className="pipeline">
                  {PHASES.map((step, index) => {
                    const current = PHASES.indexOf(phase)
                    const cls = index === current ? 'active' : index < current ? 'done' : ''
                    return (
                      <div className={`pipeline-step ${cls}`} key={step}>
                        {step}
                      </div>
                    )
                  })}
                </div>
                <div className="muted small">
                  Last: {last ? `${last.category} · ${last.message.slice(0, 80)}` : 'no telemetry yet'}
                </div>
              </section>
            )
          })}
        </div>
      )}

      {selected ? (
        <section className="card">
          <h2>Agent topology · {selected.name}</h2>
          <p className="muted small">
            Loop {loopPhase(selected, selected.running ? props.snapshot : null)}
            {props.snapshot?.busy ? ' · daemon busy' : ''}
            {props.snapshot?.dryRun ? ' · dry-run' : ''}
          </p>
          <div className="metrics mt">
            <div className="metric">
              <div className="label">Open PnL</div>
              <div className={`value ${Number(props.snapshot?.totalPnlUsd ?? 0) >= 0 ? 'pos' : 'neg'}`}>
                {fmtUsd(props.snapshot?.totalPnlUsd)}
              </div>
            </div>
            <div className="metric">
              <div className="label">Positions</div>
              <div className="value">{props.snapshot?.positions?.length ?? 0}</div>
            </div>
            <div className="metric">
              <div className="label">Pool</div>
              <div className="value small mono">{props.snapshot?.positions?.[0]?.poolAddress?.slice(0, 10) ?? '—'}</div>
            </div>
          </div>
          <div className="row mt">
            <span className="muted small">Strategy</span>
            <select
              value={
                pendingStrategy?.agentId === selected.id ? pendingStrategy.strategyId : (selected.strategyId ?? '')
              }
              onChange={(e) => void requestStrategy(selected, e.target.value)}
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
          {pendingStrategy?.agentId === selected.id ? (
            <div className="mt">
              <p className="muted small">{previewBusy ? 'Loading strategy diff…' : 'Preview before apply'}</p>
              {preview ? <div className="diff">{preview}</div> : null}
              <div className="row mt">
                <button
                  type="button"
                  className="primary"
                  disabled={previewBusy}
                  onClick={() => {
                    void props.onSetStrategy(pendingStrategy.agentId, pendingStrategy.strategyId).then(() => {
                      setPendingStrategy(null)
                      setPreview('')
                    })
                  }}
                >
                  Apply strategy
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setPendingStrategy(null)
                    setPreview('')
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  )
}
