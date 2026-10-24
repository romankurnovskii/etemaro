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
  const [selectedStrategy, setSelectedStrategy] = useState('Meteora-DLMM-v1')

  const submit = () => {
    const value = name.trim()
    if (!value) return
    void props.onCreate(value).then(() => setName(''))
  }

  return (
    <div className="agents-view">
      {/* Create Agent Section */}
      <section className="card">
        <h2>New Agent</h2>
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
        <p className="muted small mt">Creates an agent configured for dry-run. Start it with one click below.</p>
      </section>

      {/* Agent Visualizer & Fleet Overview */}
      <section className="card">
        <h2>Agent Visualizer & Fleet Status</h2>
        {props.agents.length > 0 ? (
          props.agents.map((agent) => (
            <div className="card mt" key={agent.id} style={{ border: '1px solid var(--border)' }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div className="row">
                  <span className={`status-dot ${agent.running ? 'status-connected' : 'status-disconnected'}`} />
                  <strong style={{ fontSize: '15px' }}>{agent.name}</strong>
                  <span className={`badge ${agent.running ? 'badge-read' : 'badge-write'}`}>
                    {agent.running ? 'RUNNING' : 'STOPPED'}
                  </span>
                </div>
                <div className="row">
                  {agent.running ? (
                    <button
                      type="button"
                      className="danger"
                      style={{ padding: '4px 12px', fontSize: '12px' }}
                      disabled={props.busy[agent.id]}
                      onClick={() => void props.onStop(agent.id)}
                    >
                      Stop
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="primary"
                      style={{ padding: '4px 12px', fontSize: '12px' }}
                      disabled={props.busy[agent.id]}
                      onClick={() => void props.onStart(agent.id)}
                    >
                      Start
                    </button>
                  )}
                </div>
              </div>

              <p className="muted small mt" style={{ margin: '6px 0 0' }}>
                Strategy: <strong>{agent.strategyId || selectedStrategy}</strong> | ID: <code>{agent.id}</code>
              </p>

              {/* Strategy Switcher */}
              <div className="row mt" style={{ paddingTop: '10px', borderTop: '1px solid var(--border)', justifyContent: 'space-between' }}>
                <div className="row">
                  <span className="small muted">Switch Strategy:</span>
                  <select
                    value={agent.strategyId ?? ''}
                    onChange={(e) => void props.onSetStrategy(agent.id, e.target.value)}
                    style={{ width: '220px', padding: '4px 8px', fontSize: '12px' }}
                  >
                    {props.strategies.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name ?? s.id}
                      </option>
                    ))}
                  </select>
                </div>
                <button type="button" className="ghost" style={{ fontSize: '12px' }} onClick={props.onCreateStrategy}>
                  + Strategy
                </button>
              </div>
            </div>
          ))
        ) : (
          /* Visualizer Demo View when no agents are spawned yet */
          <div className="card mt" style={{ border: '1px solid var(--border)' }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div className="row">
                <span className="status-dot status-connected"></span>
                <strong style={{ fontSize: '15px' }}>agent-bot-101</strong>
                <span className="badge badge-read">RUNNING</span>
              </div>
              <div className="row">
                <button type="button" className="primary" style={{ padding: '4px 12px', fontSize: '12px' }}>
                  Pause
                </button>
                <button type="button" className="danger" style={{ padding: '4px 12px', fontSize: '12px' }}>
                  Stop
                </button>
              </div>
            </div>

            <p className="muted small mt" style={{ margin: '6px 0 0' }}>
              Strategy: <strong>{selectedStrategy}</strong> | ID: <code>agt_7cbd8bb329e598172fe396a3</code> | Heartbeat: 2s ago
            </p>

            <div className="row mt" style={{ paddingTop: '10px', borderTop: '1px solid var(--border)', justifyContent: 'space-between' }}>
              <span className="small muted">Switch Strategy:</span>
              <select
                value={selectedStrategy}
                onChange={(e) => setSelectedStrategy(e.target.value)}
                style={{ width: '220px', padding: '4px 8px', fontSize: '12px' }}
              >
                <option value="Meteora-DLMM-v1">Meteora-DLMM-v1</option>
                <option value="Conservative-Rebalance">Conservative-Rebalance</option>
                <option value="Volatile-Grid-v2">Volatile-Grid-v2</option>
              </select>
            </div>
          </div>
        )}
      </section>

      {/* Execution Loop Pipeline State */}
      <section className="card">
        <h2>Execution Pipeline State</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
          {['Idle', 'Evaluating', 'Rebalancing', 'Settled'].map((step) => {
            const isActive = step === 'Evaluating'
            return (
              <div
                key={step}
                style={{
                  textAlign: 'center',
                  padding: '10px',
                  borderRadius: '8px',
                  border: '1px solid var(--border)',
                  background: isActive ? 'var(--accent)' : 'var(--panel-2)',
                  color: isActive ? '#FFFFFF' : 'var(--muted)',
                  fontWeight: isActive ? '600' : 'normal',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                }}
              >
                {step}
              </div>
            )
          })}
        </div>
      </section>

      {/* Telemetry & Metrics Grid */}
      <div className="metrics">
        <div className="metric">
          <div className="label">Position Status</div>
          <div className="value pos" style={{ fontSize: '15px', marginTop: '4px' }}>
            In-Range (SOL/USDC)
          </div>
        </div>
        <div className="metric">
          <div className="label">Active Bin Range</div>
          <div className="value" style={{ fontSize: '15px', marginTop: '4px' }}>
            142.50 — 148.10
          </div>
        </div>
        <div className="metric">
          <div className="label">Asset Split</div>
          <div className="value" style={{ fontSize: '15px', marginTop: '4px' }}>
            60% SOL / 40% USDC
          </div>
        </div>
        <div className="metric">
          <div className="label">Last Action</div>
          <div className="value" style={{ fontSize: '15px', marginTop: '4px' }}>
            Bin Rebalance
          </div>
        </div>
      </div>
    </div>
  )
}