import { useState } from 'react'
import { ConnectionBadge } from './components/ConnectionBadge'
import { TokenControl } from './components/TokenControl'
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

const TAB_LABELS: Record<Tab, string> = {
  agents: 'Agents',
  dashboard: 'Dashboard',
  tools: 'Tools',
  config: 'Config',
  logs: 'Logs',
  chat: 'Chat',
}

function readToken(): string {
  const params = new URLSearchParams(location.search)
  const fromUrl = params.get('token')
  if (fromUrl) {
    try {
      localStorage.setItem('etemaro.token', fromUrl)
    } catch {
      /* ignore */
    }
    // Keep the secret out of the address bar, history and screenshots.
    params.delete('token')
    const qs = params.toString()
    history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : '') + location.hash)
    return fromUrl
  }
  try {
    return localStorage.getItem('etemaro.token') ?? ''
  } catch {
    return ''
  }
}

export default function App() {
  const [token, setToken] = useState(readToken)
  const saveToken = (value: string) => {
    try {
      if (value) localStorage.setItem('etemaro.token', value)
      else localStorage.removeItem('etemaro.token')
    } catch {
      /* ignore */
    }
    setToken(value)
  }
  const [tab, setTab] = useState<Tab>('agents')
  const [openTool, setOpenTool] = useState<string | null>(null)
  const conn = useAgentConnection(WS_URL, token)
  const agents = useAgents(token)
  const strategies = useStrategies(token)

  return (
    <div className="app">
      <header className="topbar">
        <h1>
          <span className="brand-mark" aria-hidden="true" />
          Etemaro <span className="muted">Agent Console</span>
        </h1>
        <ConnectionBadge status={conn.status} retryAt={conn.retryAt} />
        <span className="spacer" />
        <span className="mono muted small">{DAEMON_URL}</span>
        <TokenControl token={token} onSave={saveToken} />
      </header>
      <nav className="tabs" aria-label="Views">
        {TABS.map((t) => (
          <button
            type="button"
            key={t}
            className={t === tab ? 'active' : ''}
            aria-current={t === tab ? 'page' : undefined}
            onClick={() => setTab(t)}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </nav>
      <main>
        {tab === 'agents' ? (
          <AgentsView
            agents={agents.agents}
            busy={agents.busy}
            error={agents.error}
            logs={conn.logs}
            snapshot={conn.snapshot}
            token={token}
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
