import { useState } from 'react'
import { TokenManagerModal } from './components/TokenManagerModal'
import { useAgentConnection } from './hooks/useAgentConnection'
import { useAgents } from './hooks/useAgents'
import { useDecisions } from './hooks/useDecisions'
import { useStrategies } from './hooks/useStrategies'
import { DAEMON_URL, WS_URL } from './lib/api'
import { AgentsView } from './views/AgentsView'
import { ChatView } from './views/ChatView'
import { ConfigView } from './views/ConfigView'
import { DashboardView } from './views/DashboardView'
import { LogsView } from './views/LogsView'
import { ToolsView } from './views/ToolsView'

const TABS = [
  { id: 'agents', label: 'Agents / Visualizer' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'tools', label: 'Tools' },
  { id: 'config', label: 'Config' },
  { id: 'logs', label: 'Logs' },
  { id: 'chat', label: 'Chat' },
] as const

type Tab = (typeof TABS)[number]['id']

export default function App() {
  const [token, setToken] = useState(() => {
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
  const [showTokenModal, setShowTokenModal] = useState(false)

  const conn = useAgentConnection(WS_URL, token)
  const agents = useAgents(token)
  const strategies = useStrategies(token)
  const decisions = useDecisions(`${DAEMON_URL}/api/tool`, token, tab === 'agents')

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-brand">
          <div className="brand-logo-mark">E</div>
          <div>
            <h1>Etemaro Agent Console</h1>
            <div className="muted tiny">Autonomous DLMM Liquidity Operations</div>
          </div>
        </div>

        <div className="topbar-meta">
          <div className={`connection-badge status-${conn.status}`}>
            <span className={`status-dot status-${conn.status}`} />
            <span className="connection-text">{conn.status.toUpperCase()}</span>
          </div>

          <button
            type="button"
            className="token-manage-btn"
            onClick={() => setShowTokenModal(true)}
            title="Manage daemon bearer authentication token"
          >
            <span className="token-icon">🔑</span>
            <span className="token-label">
              {token ? `Token: ${token.slice(0, 4)}…${token.slice(-4)}` : 'Set Token'}
            </span>
          </button>

          <span className="daemon-url-pill mono small">{DAEMON_URL}</span>
        </div>
      </header>

      <nav className="tabs" aria-label="Main Navigation">
        {TABS.map((t) => (
          <button type="button" key={t.id} className={t.id === tab ? 'active' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      <main>
        {tab === 'agents' ? (
          <AgentsView
            agents={agents.agents}
            busy={agents.busy}
            strategies={strategies.strategies}
            decisions={decisions.decisions}
            decisionsLoading={decisions.loading}
            decisionsError={decisions.error}
            logs={conn.logs}
            snapshot={conn.snapshot}
            token={token}
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

        {tab === 'config' ? <ConfigView agents={agents.agents} token={token} /> : null}

        {tab === 'logs' ? <LogsView logs={conn.logs} /> : null}

        {tab === 'chat' ? <ChatView chat={conn.chat} onSend={conn.sendChat} /> : null}
      </main>

      {showTokenModal ? (
        <TokenManagerModal
          currentToken={token}
          onSave={(newToken) => {
            setToken(newToken)
            agents.reload()
            strategies.reload()
            decisions.reload()
          }}
          onClose={() => setShowTokenModal(false)}
        />
      ) : null}
    </div>
  )
}
