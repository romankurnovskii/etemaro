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
  { id: 'agents', label: 'Agents' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'tools', label: 'Tools' },
  { id: 'config', label: 'Config' },
  { id: 'logs', label: 'Logs' },
  { id: 'chat', label: 'Chat' },
] as const
type Tab = (typeof TABS)[number]['id']

const TOKEN_KEY = 'etemaro.token'

function readToken(): string {
  const fromUrl = new URLSearchParams(location.search).get('token')
  if (fromUrl) {
    try {
      localStorage.setItem(TOKEN_KEY, fromUrl)
    } catch {
      /* storage unavailable */
    }
    return fromUrl
  }
  try {
    return localStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

function persistToken(value: string): void {
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* storage unavailable */
  }
}

function TokenControl({ token, onChange }: { token: string; onChange: (t: string) => void }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(token)
  return (
    <div className="token">
      <button
        type="button"
        className="ghost"
        aria-expanded={open}
        onClick={() => {
          setDraft(token)
          setOpen((o) => !o)
        }}
      >
        {token ? 'Token set' : 'No token'}
      </button>
      {open ? (
        <form
          className="token-pop card"
          onSubmit={(e) => {
            e.preventDefault()
            onChange(draft.trim())
            setOpen(false)
          }}
        >
          <label className="field" htmlFor="token-input">
            <span>Bearer token</span>
            <input
              id="token-input"
              type="password"
              className="mono"
              value={draft}
              autoComplete="off"
              onChange={(e) => setDraft(e.target.value)}
            />
          </label>
          <div className="row">
            <button type="submit" className="primary">
              Save
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => {
                onChange('')
                setDraft('')
                setOpen(false)
              }}
            >
              Clear
            </button>
          </div>
        </form>
      ) : null}
    </div>
  )
}

export default function App() {
  const [token, setTokenState] = useState(readToken)
  const [tab, setTab] = useState<Tab>('agents')
  const [openTool, setOpenTool] = useState<string | null>(null)
  const conn = useAgentConnection(WS_URL, token)
  const agents = useAgents(token)
  const strategies = useStrategies(token)

  const setToken = (value: string) => {
    persistToken(value)
    setTokenState(value)
  }

  const statusText =
    conn.status === 'connected'
      ? 'Connected'
      : conn.status === 'connecting'
        ? conn.attempt > 0
          ? `Reconnecting (${conn.attempt})`
          : 'Connecting'
        : 'Disconnected'

  return (
    <div className="app">
      <header className="topbar">
        <h1>Etemaro</h1>
        <span className={`pill pill-conn-${conn.status}`}>
          <span className={`status-dot status-${conn.status}`} />
          {statusText}
        </span>
        {conn.authError ? <span className="error small">{conn.authError}</span> : null}
        <span className="spacer" />
        <span className="muted small mono">{DAEMON_URL}</span>
        {conn.status === 'disconnected' ? (
          <button type="button" className="ghost" onClick={conn.reconnect}>
            Retry now
          </button>
        ) : null}
        <TokenControl token={token} onChange={setToken} />
      </header>
      <nav className="tabs" aria-label="Views">
        {TABS.map((t) => (
          <button
            type="button"
            key={t.id}
            className={t.id === tab ? 'active' : ''}
            aria-current={t.id === tab ? 'page' : undefined}
            onClick={() => setTab(t.id)}
          >
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
        {tab === 'logs' ? <LogsView logs={conn.logs} onClear={conn.clearLogs} /> : null}
        {tab === 'chat' ? <ChatView chat={conn.chat} onSend={conn.sendChat} /> : null}
      </main>
    </div>
  )
}
