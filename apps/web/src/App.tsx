import { useState } from 'react'
import { type Agent, AgentVisualizer } from './components/AgentVisualizer'
import { useAgentConnection } from './hooks/useAgentConnection'
import { useAgents } from './hooks/useAgents'
import { useStrategies } from './hooks/useStrategies'
import { DAEMON_URL, WS_URL } from './lib/api'
import { AgentsView } from './views/AgentsView'
import { ChatView } from './views/ChatView'
import { ConfigView } from './views/ConfigView'
import { DashboardView } from './views/DashboardView'
import { LogsView } from './views/LogsView'
import { ToolsView } from './views/ToolsView'

type Dict = Record<string, string | number | boolean | null | undefined>

const TABS = ['agents', 'dashboard', 'tools', 'config', 'logs', 'chat'] as const
type Tab = (typeof TABS)[number]

export default function App() {
  const [token] = useState(() => {
    const fromUrl = new URLSearchParams(location.search).get('token')
    if (fromUrl) {
      try {
        localStorage.setItem('etemaro.token', fromUrl)
      } catch {
        /* ignore */
      }
      return fromUrl
    }
    try {
      return localStorage.getItem('etemaro.token') ?? ''
    } catch {
      return ''
    }
  })
  const [tab, setTab] = useState<Tab>('agents')
  const [openTool, setOpenTool] = useState<string | null>(null)
  const conn = useAgentConnection(WS_URL, token)
  const agents = useAgents(token)
  const strategies = useStrategies(token)

  // Map daemon agent data cleanly without any or type errors
  const formattedAgents: Agent[] = (agents.agents || []).map((raw) => {
    const a = raw as unknown as Dict
    const status = a?.status
    const state = a?.state
    return {
      id: String(a?.id || a?.name || 'agent-01'),
      name: String(a?.name || a?.id || 'etemaro-agent'),
      status:
        status === 'running' || status === 'stopped' || status === 'idle' || status === 'error'
          ? status
          : a?.running === true
            ? 'running'
            : 'stopped',
      state:
        state === 'Idle' || state === 'Evaluating' || state === 'Rebalancing' || state === 'Settled'
          ? state
          : 'Evaluating',
      strategyId: String(a?.strategyId || a?.strategy || 'dlmm-range-dynamic'),
      pair: String(a?.pair || 'SOL/USDC (Meteora)'),
      uptime: String(a?.uptime || 'Active'),
      lastHeartbeat: String(a?.lastHeartbeat || '10s ago'),
      lastDecision: String(a?.lastDecision || 'Hold active liquidity bin range'),
      lastTool: String(a?.lastTool || 'meteora_get_pool_state'),
      confidence: typeof a?.confidence === 'number' ? a.confidence : 0.92,
    }
  })

  const formattedStrategies = (strategies.strategies || []).map((raw) => {
    if (typeof raw === 'string') {
      return { id: raw, name: raw }
    }
    const s = raw as unknown as Dict
    return {
      id: String(s?.id || s?.name || 'strategy'),
      name: String(s?.name || s?.id || 'Strategy'),
    }
  })

  return (
    <div className="app">
      <header className="topbar">
        <h1>Etemaro Agent Console</h1>
        <span>
          <span className={`status-dot status-${conn.status}`} />
          {conn.status}
        </span>
        <span className="spacer" />
        <span className="muted small font-mono">{DAEMON_URL}</span>
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button type="button" key={t} className={t === tab ? 'active' : ''} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>

      <main>
        {tab === 'agents' ? (
          <div className="space-y-4">
            <AgentVisualizer
              agents={formattedAgents}
              strategies={formattedStrategies}
              onStartAgent={agents.start}
              onStopAgent={agents.stop}
              onChangeStrategy={agents.setStrategy}
            />
            <AgentsView
              agents={agents.agents}
              busy={agents.busy}
              strategies={strategies.strategies}
              onCreate={agents.create}
              onStart={agents.start}
              onStop={agents.stop}
              onSetStrategy={agents.setStrategy}
              onCreateStrategy={() => {
                setOpenTool('add_strategy')
                setTab('tools')
              }}
            />
          </div>
        ) : null}

        {tab === 'dashboard' ? <DashboardView snapshot={conn.snapshot} /> : null}
        {tab === 'tools' ? <ToolsView catalog={conn.catalog} token={token} initialToolName={openTool} /> : null}
        {tab === 'config' ? <ConfigView agents={agents.agents} token={token} /> : null}
        {tab === 'logs' ? <LogsView logs={conn.logs} /> : null}
        {tab === 'chat' ? <ChatView chat={conn.chat} onSend={conn.sendChat} /> : null}
      </main>
    </div>
  )
}
