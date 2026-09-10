import { useState } from 'react'
import { useAgentConnection } from './hooks/useAgentConnection'
import { useAgents } from './hooks/useAgents'
import { useStrategies } from './hooks/useStrategies'
import { DAEMON_URL, WS_URL } from './lib/api'
import { AgentsView } from './views/AgentsView'
import { ChatView } from './views/ChatView'
import { DashboardView } from './views/DashboardView'
import { LogsView } from './views/LogsView'
import { ToolsView } from './views/ToolsView'

const TABS = ['agents', 'dashboard', 'tools', 'logs', 'chat'] as const
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

  return (
    <div className="app">
      <header className="topbar">
        <h1>Etemaro Agent Console</h1>
        <span>
          <span className={`status-dot status-${conn.status}`} />
          {conn.status}
        </span>
        <span className="spacer" />
        <span className="muted small">{DAEMON_URL}</span>
      </header>
      <nav className="tabs">
        {TABS.map((t) => (
          <button type="button" key={t} className={t === tab ? 'active' : ''} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </nav>
      <main>
        {tab === 'agents' ? (
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
        ) : null}
        {tab === 'dashboard' ? <DashboardView snapshot={conn.snapshot} /> : null}
        {tab === 'tools' ? <ToolsView catalog={conn.catalog} token={token} initialToolName={openTool} /> : null}
        {tab === 'logs' ? <LogsView logs={conn.logs} /> : null}
        {tab === 'chat' ? <ChatView chat={conn.chat} onSend={conn.sendChat} /> : null}
      </main>
    </div>
  )
}
