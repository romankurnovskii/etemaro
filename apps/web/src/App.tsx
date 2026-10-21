import { useState } from 'react'
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

const TABS = [
  { id: 'agents', label: 'Visualizer' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'tools', label: 'Tools' },
  { id: 'config', label: 'Config' },
  { id: 'logs', label: 'Logs' },
  { id: 'chat', label: 'Chat' },
] as const

type Tab = (typeof TABS)[number]['id']

function readStoredToken(): string {
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
}

export default function App() {
  const [token, setToken] = useState(readStoredToken)
  const [tokenDraft, setTokenDraft] = useState(token)
  const [showToken, setShowToken] = useState(false)
  const [tab, setTab] = useState<Tab>('agents')
  const [openTool, setOpenTool] = useState<string | null>(null)
  const conn = useAgentConnection(WS_URL, token)
  const agents = useAgents(token)
  const strategies = useStrategies(token)

  const saveToken = () => {
    const next = tokenDraft.trim()
    try {
      if (next) localStorage.setItem('etemaro.token', next)
      else localStorage.removeItem('etemaro.token')
    } catch {
      /* ignore */
    }
    setToken(next)
    setShowToken(false)
  }

  const clearToken = () => {
    setTokenDraft('')
    try {
      localStorage.removeItem('etemaro.token')
    } catch {
      /* ignore */
    }
    setToken('')
    setShowToken(false)
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>Etemaro</h1>
        <span className="conn-badge">
          <span className={`status-dot status-${conn.status}`} />
          {conn.status}
        </span>
        <span className="spacer" />
        <span className="muted small mono">{DAEMON_URL}</span>
        <div className="token-box">
          {showToken ? (
            <>
              <input
                type="password"
                value={tokenDraft}
                placeholder="Bearer token"
                onChange={(e) => setTokenDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveToken()
                }}
                aria-label="Daemon bearer token"
              />
              <button type="button" className="primary" onClick={saveToken}>
                Save
              </button>
              <button type="button" className="ghost" onClick={clearToken}>
                Clear
              </button>
              <button type="button" className="ghost" onClick={() => setShowToken(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className="ghost" onClick={() => setShowToken(true)}>
              {token ? 'Token · set' : 'Token · unset'}
            </button>
          )}
        </div>
      </header>
      <nav className="tabs">
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
            snapshot={conn.snapshot}
            logs={conn.logs}
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
    </div>
  )
}
