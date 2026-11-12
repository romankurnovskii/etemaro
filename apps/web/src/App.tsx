import { useMemo, useState } from 'react'
import { Header } from './components/Header'
import { useAgentConnection } from './hooks/useAgentConnection'
import { useAgents } from './hooks/useAgents'
import { useAgentTelemetry } from './hooks/useAgentTelemetry'
import { useLogStore } from './hooks/useLogStore'
import { useStrategies } from './hooks/useStrategies'
import { DAEMON_URL, WS_URL } from './lib/api'
import { readInitialToken, storeToken } from './lib/token'
import { AgentsView } from './views/AgentsView'
import { ChatView } from './views/ChatView'
import { ConfigView } from './views/ConfigView'
import { DashboardView } from './views/DashboardView'
import { LogsView } from './views/LogsView'
import { ToolsView } from './views/ToolsView'

const TABS = ['agents', 'dashboard', 'tools', 'config', 'logs', 'chat'] as const
type Tab = (typeof TABS)[number]

const TAB_LABEL: Record<Tab, string> = {
  agents: 'Agents',
  dashboard: 'Dashboard',
  tools: 'Tools',
  config: 'Config',
  logs: 'Logs',
  chat: 'Chat',
}

export default function App() {
  const [token, setToken] = useState(readInitialToken)
  const [tab, setTab] = useState<Tab>('agents')
  const [openTool, setOpenTool] = useState<string | null>(null)
  const logs = useLogStore()
  const conn = useAgentConnection(WS_URL, token, logs.ingest)
  const agents = useAgents(token)
  const strategies = useStrategies(token)
  const telemetry = useAgentTelemetry(agents.agents, token, logs.ingest)
  const writeTools = useMemo(() => new Set(conn.catalog.filter((t) => t.isWrite).map((t) => t.name)), [conn.catalog])

  const changeToken = (next: string) => {
    storeToken(next)
    setToken(next)
  }

  return (
    <div className="app">
      <Header
        daemonUrl={DAEMON_URL}
        status={conn.status}
        lastError={conn.lastError}
        runningAgents={agents.agents.filter((a) => a.running).length}
        totalAgents={agents.agents.length}
        token={token}
        onTokenChange={changeToken}
      />
      <div className="tabs" role="tablist" aria-label="Console sections">
        {TABS.map((t) => (
          <button
            type="button"
            role="tab"
            key={t}
            id={`tab-${t}`}
            aria-selected={t === tab}
            aria-controls="tab-panel"
            className={t === tab ? 'tab is-active' : 'tab'}
            onClick={() => setTab(t)}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>
      <main id="tab-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'agents' ? (
          <AgentsView
            controller={agents}
            telemetry={telemetry}
            logs={logs.store}
            writeTools={writeTools}
            strategies={strategies.strategies}
            token={token}
            onCreateStrategy={() => {
              setOpenTool('add_strategy')
              setTab('tools')
            }}
          />
        ) : null}
        {tab === 'dashboard' ? <DashboardView snapshot={conn.snapshot} /> : null}
        {tab === 'tools' ? <ToolsView catalog={conn.catalog} token={token} initialToolName={openTool} /> : null}
        {tab === 'config' ? <ConfigView agents={agents.agents} token={token} /> : null}
        {tab === 'logs' ? <LogsView store={logs.store} /> : null}
        {tab === 'chat' ? <ChatView chat={conn.chat} onSend={conn.sendChat} /> : null}
      </main>
    </div>
  )
}
