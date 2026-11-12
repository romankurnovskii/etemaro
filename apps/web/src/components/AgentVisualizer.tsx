import type React from 'react'
import { useState } from 'react'

export type PipelineState = 'Idle' | 'Evaluating' | 'Rebalancing' | 'Settled'
export type AgentStatus = 'running' | 'stopped' | 'idle' | 'error'

export interface Agent {
  id: string
  name: string
  status: AgentStatus
  state: PipelineState
  strategyId: string
  pair: string
  uptime: string
  lastHeartbeat: string
  lastDecision: string
  lastTool: string
  confidence: number
}

interface AgentVisualizerProps {
  agents: Agent[]
  strategies: { id: string; name: string }[]
  onStartAgent?: (id: string) => void
  onStopAgent?: (id: string) => void
  onChangeStrategy?: (id: string, strategyId: string) => void
}

const PIPELINE_STEPS: PipelineState[] = ['Idle', 'Evaluating', 'Rebalancing', 'Settled']

export const AgentVisualizer: React.FC<AgentVisualizerProps> = ({
  agents,
  strategies,
  onStartAgent,
  onStopAgent,
  onChangeStrategy,
}) => {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(agents[0]?.id || null)
  const activeAgent = agents.find((a) => a.id === selectedAgentId) || agents[0]

  return (
    <div className="agent-visualizer-container">
      {/* Fleet Overview Grid */}
      <div className="card">
        <h2>Agent Fleet Overview</h2>
        {agents.length === 0 ? (
          <div className="muted small">No active agents found in daemon.</div>
        ) : (
          <div className="metrics" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            {agents.map((agent) => {
              const isSelected = activeAgent?.id === agent.id
              return (
                <button
                  type="button"
                  key={agent.id}
                  onClick={() => setSelectedAgentId(agent.id)}
                  className="metric"
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    cursor: 'pointer',
                    borderColor: isSelected ? 'var(--accent)' : 'var(--border)',
                    boxShadow: isSelected ? '0 0 0 1px var(--accent)' : 'none',
                  }}
                >
                  <div className="row" style={{ justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span style={{ fontWeight: 600, fontFamily: 'monospace' }}>{agent.name}</span>
                    <span
                      className="badge"
                      style={{
                        backgroundColor:
                          agent.status === 'running' ? 'rgba(85, 107, 47, 0.15)' : 'rgba(184, 50, 50, 0.15)',
                        color: agent.status === 'running' ? 'var(--green)' : 'var(--red)',
                      }}
                    >
                      {agent.status.toUpperCase()}
                    </span>
                  </div>
                  <div className="small muted">
                    <div>
                      Pool: <span style={{ color: 'var(--text)' }}>{agent.pair}</span>
                    </div>
                    <div>
                      Strategy: <span style={{ color: 'var(--text)' }}>{agent.strategyId}</span>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Active Agent Pipeline & Details */}
      {activeAgent && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: '12px' }}>
            <div>
              <h2 style={{ margin: 0 }}>Agent State Inspection: {activeAgent.name}</h2>
              <span className="small muted font-mono">Last Heartbeat: {activeAgent.lastHeartbeat}</span>
            </div>
            <div className="row">
              <span className="small muted">Strategy:</span>
              <select
                value={activeAgent.strategyId}
                onChange={(e) => onChangeStrategy?.(activeAgent.id, e.target.value)}
                style={{ fontSize: '12px' }}
              >
                {strategies.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* State Machine Pipeline */}
          <div className="field">
            <span className="small muted font-mono">STATE PIPELINE</span>
            <div className="pipeline-container">
              {PIPELINE_STEPS.map((step) => (
                <div key={step} className={`pipeline-step ${activeAgent.state === step ? 'active' : ''}`}>
                  {step}
                </div>
              ))}
            </div>
          </div>

          {/* Execution Metrics */}
          <div className="metrics mt">
            <div className="metric">
              <div className="label">Last Decision</div>
              <div className="value" style={{ fontSize: '13px' }}>
                {activeAgent.lastDecision || 'N/A'}
              </div>
            </div>
            <div className="metric">
              <div className="label">Last Tool Invoked</div>
              <div className="value" style={{ fontSize: '13px' }}>
                {activeAgent.lastTool || 'N/A'}
              </div>
            </div>
            <div className="metric">
              <div className="label">Confidence Score</div>
              <div className="value">{(activeAgent.confidence * 100).toFixed(0)}%</div>
            </div>
          </div>

          {/* Action Controls */}
          <div className="row mt" style={{ justifyContent: 'flex-end' }}>
            {activeAgent.status === 'running' ? (
              <button type="button" className="danger" onClick={() => onStopAgent?.(activeAgent.id)}>
                Stop Agent
              </button>
            ) : (
              <button type="button" className="primary" onClick={() => onStartAgent?.(activeAgent.id)}>
                Start Agent
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
