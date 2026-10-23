import { useCallback, useEffect, useState } from 'react'
import { useAgentActivity } from './hooks/useAgentActivity'
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

const TABS = ['agents', 'dashboard', 'tools', 'config', 'logs', 'chat'] as const
type Tab = (typeof TABS)[number]

const TAB_LABEL: Record<Tab, string> = {
  agents: 'Agents / Visualizer',
  dashboard: 'Dashboard',
  tools: 'Tools',
  config: 'Config',
  logs: 'Logs',
  chat: 'Chat',
}

const TOKEN_KEY = 'etemaro.token'

function readToken(): string {
  const fromUrl = new URLSearchParams(location.search).get('token')
  if (fromUrl) {
    try {
      localStorage.setItem(TOKEN_KEY, fromUrl)
    } catch {
      /* ignore */
    }
    return fromUrl
  }
  try {
    return localStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

export default function App() {
  const [token, setToken] = useState(readToken)
  const [tab, setTab] = useState<Tab>('agents')
  const [openTool, setOpenTool] = useState<string | null>(null)
  const [tokenPanelOpen, setTokenPanelOpen] = useState(false)
  const [tokenDraft, setTokenDraft] = useState(token)
  const conn = useAgentConnection(WS_URL, token)
  const agents = useAgents(token)
  const strategies = useStrategies(token)
  const activity = useAgentActivity(conn.logs, agents.agents)

  useEffect(() => {
    setTokenDraft(token)
  }, [token])

  const saveToken = useCallback(() => {
    const value = tokenDraft.trim()
    try {
      if (value) localStorage.setItem(TOKEN_KEY, value)
      else localStorage.removeItem(TOKEN_KEY)
    } catch {
      /* ignore */
    }
    setToken(value)
    setTokenPanelOpen(false)
  }, [tokenDraft])

  const hasToken = token.length > 0
  // Keyboard navigation: press 1-6 to jump between views.
  // Skips keystrokes typed into form controls so search stays usable.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      const idx = Number(e.key)
      const next = idx >= 1 && idx <= TABS.length ? TABS[idx - 1] : undefined
      if (next) setTab(next)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            E
          </span>
          <div className="brand-text">
            <span className="brand-name">Etemaro</span>
            <span className="brand-sub">Agent Console</span>
          </div>
        </div>

        <span className={`conn-badge conn-${conn.status}`}>
          <span className={`status-dot status-${conn.status}`} />
          {conn.status === 'connected' ? 'Daemon online' : conn.status === 'connecting' ? 'Connecting…' : 'Offline'}
        </span>
        <span className="muted small mono daemon-url" title={WS_URL}>
          {DAEMON_URL.replace(/^https?:\/\//, '')}
        </span>

        <span className="spacer" />

        <div className="token-manage">
          <button
            type="button"
            className={`ghost small-btn${hasToken ? '' : ' warn-text'}`}
            onClick={() => setTokenPanelOpen(!tokenPanelOpen)}
            aria-expanded={tokenPanelOpen}
          >
            {hasToken ? 'API token set' : 'No API token'}
          </button>
          {tokenPanelOpen ? (
            <div className="token-panel">
              <label className="field">
                <span>Daemon API token (etemaro.token)</span>
                <input
                  type="password"
                  value={tokenDraft}
                  placeholder="paste bearer token…"
                  onChange={(e) => setTokenDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveToken()
                  }}
                />
                <span className="hint">Stored locally and sent as the Authorization header / WS auth payload.</span>
              </label>
              <div className="row">
                <button type="button" className="primary small-btn" onClick={saveToken}>
                  Save
                </button>
                <button
                  type="button"
                  className="ghost small-btn"
                  onClick={() => {
                    setTokenDraft('')
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </header>

      <nav className="tabs" aria-label="Console views">
        {TABS.map((t) => (
          <button type="button" key={t} className={t === tab ? 'active' : ''} onClick={() => setTab(t)}>
            {TAB_LABEL[t]}
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
            activity={activity}
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
