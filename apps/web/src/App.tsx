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

const TABS = ['agents', 'dashboard', 'tools', 'config', 'logs', 'chat'] as const
type Tab = (typeof TABS)[number]
const LABELS: Record<Tab, string> = {
  agents: 'Agents / Visualizer',
  dashboard: 'Dashboard',
  tools: 'Tools',
  config: 'Config',
  logs: 'Logs',
  chat: 'Chat',
}
const TITLES: Record<Tab, [string, string]> = {
  agents: ['Agent fleet', 'A clear view of every agent. From strategy to execution.'],
  dashboard: ['Daemon overview', 'Positions, performance and the next cycle at a glance.'],
  tools: ['Tool workspace', 'Inspect the catalog and run the tools exposed by your daemon.'],
  config: ['Configuration', 'Manage the operating parameters of your agents.'],
  logs: ['Live telemetry', 'Follow decisions, tool calls and events as they happen.'],
  chat: ['Agent conversation', 'A direct line to the connected daemon.'],
}

function initialToken(): string {
  const url = new URL(location.href)
  const fromUrl = url.searchParams.get('token')
  if (fromUrl) {
    url.searchParams.delete('token')
    history.replaceState(null, '', url)
    try {
      localStorage.setItem('etemaro.token', fromUrl)
    } catch {
      /* storage may be unavailable */
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
  const [token, setToken] = useState(initialToken)
  return <Console key={token} token={token} onToken={setToken} />
}

function Console({ token, onToken }: { token: string; onToken: (token: string) => void }) {
  const [tab, setTab] = useState<Tab>('agents')
  const [openTool, setOpenTool] = useState<string | null>(null)
  const [editingToken, setEditingToken] = useState(false)
  const [draftToken, setDraftToken] = useState('')
  const [tokenError, setTokenError] = useState<string | null>(null)
  const conn = useAgentConnection(WS_URL, token)
  const agents = useAgents(token)
  const strategies = useStrategies(token)

  const saveToken = (value: string) => {
    try {
      if (value) localStorage.setItem('etemaro.token', value)
      else localStorage.removeItem('etemaro.token')
    } catch {
      setTokenError('Browser storage is unavailable. The token will be used for this session.')
    }
    setDraftToken('')
    setEditingToken(false)
    onToken(value)
  }

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            e
          </span>
          <div>
            <strong>
              etemaro<span className="pos">.</span>
            </strong>
            <span className="brand-caption">OPERATOR CONSOLE</span>
          </div>
        </div>
        <div className="header-tools">
          <span className={`connection-badge ${conn.status}`} role="status">
            <span className={`status-dot status-${conn.status}`} />
            {conn.status === 'connected'
              ? 'Daemon connected'
              : conn.status === 'connecting'
                ? 'Connecting'
                : 'Daemon offline'}
          </span>
          <button
            type="button"
            className="ghost token-button"
            aria-expanded={editingToken}
            onClick={() => setEditingToken(!editingToken)}
          >
            {' '}
            {token ? 'Manage token' : 'Connect with token'} <span aria-hidden="true">↗</span>
          </button>
        </div>
      </header>
      {editingToken && (
        <form
          className="token-panel card"
          onSubmit={(e) => {
            e.preventDefault()
            saveToken(draftToken.trim())
          }}
        >
          <label className="field" htmlFor="daemon-token">
            <span>Daemon bearer token</span>
            <input
              id="daemon-token"
              type="password"
              autoComplete="off"
              value={draftToken}
              onChange={(e) => setDraftToken(e.target.value)}
              placeholder="Paste a new token"
            />
          </label>
          <p className="muted small">Stored in this browser for {DAEMON_URL}. Saving reconnects the console.</p>
          <div className="row">
            <button type="submit" className="primary" disabled={!draftToken.trim()}>
              Save & connect
            </button>
            <button type="button" className="ghost" onClick={() => setEditingToken(false)}>
              Cancel
            </button>
            {token && (
              <button type="button" className="danger" onClick={() => saveToken('')}>
                Remove token
              </button>
            )}
          </div>
        </form>
      )}
      {tokenError && (
        <p className="notice" role="status">
          {tokenError}
        </p>
      )}
      <nav className="tabs" aria-label="Console navigation">
        {TABS.map((item) => (
          <button
            type="button"
            key={item}
            className={item === tab ? 'active' : ''}
            aria-current={item === tab ? 'page' : undefined}
            onClick={() => setTab(item)}
          >
            {LABELS[item]}
            {item === 'agents' && <span className="nav-count">{agents.agents.length}</span>}
          </button>
        ))}
      </nav>
      <main id="main">
        <div className="page-heading">
          <div>
            <p className="eyebrow">WORKSPACE / {tab === 'agents' ? 'AGENTS' : tab.toUpperCase()}</p>
            <h1>{TITLES[tab][0]}</h1>
            <p className="muted">{TITLES[tab][1]}</p>
          </div>
          <span className="small muted endpoint">
            <span className="status-dot status-connected" />
            {DAEMON_URL}
          </span>
        </div>
        {(conn.status !== 'connected' || conn.error) && (
          <div className="notice" role="status">
            <strong>{conn.error ? 'Connection needs attention' : 'Waiting for the daemon'}</strong>
            <span>
              {conn.error ?? `Start your Etemaro daemon at ${DAEMON_URL}. The console reconnects automatically.`}
            </span>
          </div>
        )}
        {tab === 'agents' && (
          <AgentsView
            agents={agents.agents}
            busy={agents.busy}
            loading={agents.loading}
            error={agents.error}
            strategyError={strategies.error}
            token={token}
            strategies={strategies.strategies}
            onReload={() => {
              agents.reload()
              strategies.reload()
            }}
            onCreate={agents.create}
            onStart={agents.start}
            onStop={agents.stop}
            onSetStrategy={agents.setStrategy}
            onCreateStrategy={() => {
              setOpenTool('add_strategy')
              setTab('tools')
            }}
          />
        )}
        {tab === 'dashboard' && <DashboardView snapshot={conn.snapshot} />}
        {tab === 'tools' && <ToolsView catalog={conn.catalog} token={token} initialToolName={openTool} />}
        {tab === 'config' && <ConfigView agents={agents.agents} token={token} />}
        {tab === 'logs' && <LogsView logs={conn.logs} />}
        {tab === 'chat' && <ChatView chat={conn.chat} onSend={conn.sendChat} />}
      </main>
      <footer className="footer">
        <span>
          ETEMARO <span className="muted">/</span> ENGINEERED FOR CLARITY
        </span>
        <span>
          HTTP + WebSocket IPC <span className="muted">·</span> Local daemon
        </span>
      </footer>
    </div>
  )
}
