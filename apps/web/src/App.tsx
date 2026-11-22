import { useEffect, useMemo } from 'react'
import { Header } from './components/Header'
import { useAgentsQuery } from './hooks/useAgentsQuery'
import { useHealthQuery } from './hooks/useHealthQuery'
import { useStrategiesQuery } from './hooks/useStrategiesQuery'
import { DAEMON_URL, WS_URL } from './lib/api'
import type { ManagedAgent } from './lib/ipc'
import { useClockStore } from './stores/clockStore'
import { useConnectionStore } from './stores/connectionStore'
import { useTelemetryStore } from './stores/telemetryStore'
import { TAB_LABEL, TABS, type Tab, useUiStore } from './stores/uiStore'
import { AgentsView } from './views/AgentsView'
import { ChatView } from './views/ChatView'
import { ConfigView } from './views/ConfigView'
import { DashboardView } from './views/DashboardView'
import { LogsView } from './views/LogsView'
import { ToolsView } from './views/ToolsView'

/** Stable empty list: `?? []` would create a new array every render and re-run
 *  the telemetry sync effect on each pass while the first fetch is in flight. */
const NO_AGENTS: ManagedAgent[] = []

export default function App() {
  const token = useUiStore((s) => s.token)
  const tab = useUiStore((s) => s.tab)
  const setTab = useUiStore((s) => s.setTab)
  const openTool = useUiStore((s) => s.openTool)
  const setOpenTool = useUiStore((s) => s.setOpenTool)

  const status = useConnectionStore((s) => s.status)
  const lastError = useConnectionStore((s) => s.lastError)
  const authFailed = useConnectionStore((s) => s.authFailed)
  const snapshot = useConnectionStore((s) => s.snapshot)
  const catalog = useConnectionStore((s) => s.catalog)
  const chat = useConnectionStore((s) => s.chat)
  const connect = useConnectionStore((s) => s.connect)
  const sendChat = useConnectionStore((s) => s.sendChat)

  const healthQuery = useHealthQuery()
  const setZone = useClockStore((s) => s.setZone)
  const agentsQuery = useAgentsQuery(token)
  const agents = agentsQuery.data ?? NO_AGENTS
  const strategiesQuery = useStrategiesQuery(token)
  const syncTelemetry = useTelemetryStore((s) => s.sync)

  useEffect(() => {
    connect(WS_URL, token)
  }, [connect, token])

  // Render timestamps in the daemon's zone, not the browser's.
  useEffect(() => {
    if (!healthQuery.data) return
    setZone(healthQuery.data.timezone ?? null, healthQuery.data.utcOffsetMinutes ?? null)
  }, [healthQuery.data, setZone])

  useEffect(() => {
    syncTelemetry(agents, token)
  }, [syncTelemetry, agents, token])

  // Back/forward and hand-edited hashes keep the tab in sync.
  useEffect(() => {
    const onHash = () => setTab(readHashTab())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [setTab])

  const writeTools = useMemo(() => new Set(catalog.filter((t) => t.isWrite).map((t) => t.name)), [catalog])
  const runningAgents = agents.filter((a) => a.running).length

  return (
    <div className="app">
      <Header
        daemonUrl={DAEMON_URL}
        status={status}
        lastError={lastError}
        authFailed={authFailed}
        runningAgents={runningAgents}
        totalAgents={agents.length}
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
            writeTools={writeTools}
            strategies={strategiesQuery.data ?? []}
            onCreateStrategy={() => {
              setOpenTool('add_strategy')
              setTab('tools')
            }}
          />
        ) : null}
        {tab === 'dashboard' ? <DashboardView snapshot={snapshot} /> : null}
        {tab === 'tools' ? <ToolsView catalog={catalog} initialToolName={openTool} /> : null}
        {tab === 'config' ? <ConfigView agents={agents} /> : null}
        {tab === 'logs' ? <LogsView /> : null}
        {tab === 'chat' ? <ChatView chat={chat} onSend={sendChat} /> : null}
      </main>
    </div>
  )
}

function readHashTab(): Tab {
  const raw = location.hash.replace(/^#\/?/, '').trim()
  return (TABS as readonly string[]).includes(raw) ? (raw as Tab) : 'agents'
}
