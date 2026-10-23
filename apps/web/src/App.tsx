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

export default function App() {
  const [token, setToken] = useState(() => {
    const fromUrl = new URLSearchParams(location.search).get('token')
    if (fromUrl) {
      const clean = new URL(location.href)
      clean.searchParams.delete('token')
      history.replaceState(null, '', clean.pathname + clean.search + clean.hash)
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
  const [tokenEditor, setTokenEditor] = useState(false)
  const [connectionVersion, setConnectionVersion] = useState(0)
  const changeToken = (value: string) => {
    setToken(value)
    setConnectionVersion((previous) => previous + 1)
  }
  const [tokenInput, setTokenInput] = useState('')
  const [tokenError, setTokenError] = useState('')
  const [tab, setTab] = useState<Tab>('agents')
  const [openTool, setOpenTool] = useState<string | null>(null)
  const conn = useAgentConnection(WS_URL, token)
  const agents = useAgents(token)
  const strategies = useStrategies(token)

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <div className="eyebrow">OPERATOR CONSOLE</div>
          <h1>Etemaro</h1>
        </div>
        <span>
          <span className={`status-dot status-${conn.status === 'unauthorized' ? 'Token rejected' : conn.status}`} />
          {conn.status === 'unauthorized' ? 'Token rejected' : conn.status}
        </span>
        <span className="spacer" />
        <span className="muted small endpoint">{DAEMON_URL}</span>
        <button
          type="button"
          className="ghost"
          onClick={() => {
            setTokenEditor(!tokenEditor)
            setTokenInput('')
            setTokenError('')
          }}
        >
          Manage token
        </button>
      </header>
      {tokenEditor ? (
        <section className="card token-panel">
          <h2>Daemon access token</h2>
          <p className="muted small">Saved only in this browser. Changing it clears previous connection data.</p>
          <form
            className="row"
            onSubmit={(event) => {
              event.preventDefault()
              try {
                localStorage.setItem('etemaro.token', tokenInput.trim())
                setTokenError('')
              } catch {
                setTokenError('Browser storage unavailable; token is kept for this session only.')
              }
              changeToken(tokenInput.trim())
              setTokenInput('')
            }}
          >
            <label className="grow">
              Token
              <input
                aria-label="Daemon token"
                type="password"
                autoComplete="off"
                value={tokenInput}
                onChange={(event) => setTokenInput(event.target.value)}
              />
            </label>
            <button type="submit" className="primary">
              Save token
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                try {
                  localStorage.removeItem('etemaro.token')
                } catch {}
                changeToken('')
                setTokenInput('')
              }}
            >
              Forget token
            </button>
          </form>
          {tokenError ? <p role="status">{tokenError}</p> : null}
        </section>
      ) : null}
      <nav className="tabs" aria-label="Console views">
        {TABS.map((t) => (
          <button type="button" key={t} className={t === tab ? 'active' : ''} onClick={() => setTab(t)}>
            {t === 'agents' ? 'Agents / Visualizer' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>
      <main key={connectionVersion}>
        {tab === 'agents' ? (
          <AgentsView
            token={token}
            error={agents.error}
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
        {tab === 'config' ? <ConfigView agents={agents.agents} token={token} /> : null}
        {tab === 'logs' ? <LogsView logs={conn.logs} /> : null}
        {tab === 'chat' ? <ChatView chat={conn.chat} onSend={conn.sendChat} /> : null}
      </main>
    </div>
  )
}
