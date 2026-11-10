import { useState } from 'react'
import { type ConnectionStatus, useAgentConnection } from './hooks/useAgentConnection'
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

const TOKEN_KEY = 'etemaro.token'

function persistToken(value: string): void {
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* storage unavailable — token stays in memory for this session */
  }
}

/** Reads `?token=` once, persists it, and strips it from the address bar. */
function initialToken(): string {
  const params = new URLSearchParams(location.search)
  const fromUrl = params.get('token')
  if (fromUrl) {
    persistToken(fromUrl)
    params.delete('token')
    const query = params.toString()
    history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`)
    return fromUrl
  }
  try {
    return localStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

export default function App() {
  const [token, setTokenState] = useState(initialToken)
  const setToken = (value: string) => {
    persistToken(value)
    setTokenState(value)
  }
  const [tab, setTab] = useState<Tab>('agents')
  const [openTool, setOpenTool] = useState<string | null>(null)
  const conn = useAgentConnection(WS_URL, token)
  const agents = useAgents(token)
  const strategies = useStrategies(token)

  return (
    <div className="app">
      <header className="topbar">
        <h1>Etemaro Agent Console</h1>
        <ConnectionBadge status={conn.status} />
        <span className="spacer" />
        <span className="muted small mono daemon-url" title="VITE_DAEMON_URL">
          {DAEMON_URL}
        </span>
        <TokenControl token={token} error={agents.error} onChange={setToken} />
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
            snapshot={conn.snapshot}
            catalog={conn.catalog}
            logs={conn.logs}
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

function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  return (
    <span className={`conn-badge conn-${status}`} role="status">
      <span className={`status-dot status-${status}`} />
      {status}
    </span>
  )
}

function maskToken(token: string): string {
  return token.length > 4 ? `••••${token.slice(-4)}` : '••••'
}

/**
 * Header bearer-token control. The token feeds every hook (`useAgents`,
 * `useStrategies`, `useAgentConnection`), so saving it re-authenticates the
 * REST calls (`Authorization: Bearer`) and reconnects the WebSocket.
 */
function TokenControl(props: { token: string; error: string | null; onChange: (token: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [reveal, setReveal] = useState(false)

  const close = () => {
    setEditing(false)
    setDraft('')
    setReveal(false)
  }
  const save = () => {
    props.onChange(draft.trim())
    close()
  }

  if (editing) {
    return (
      <form
        className="token-form"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <input
          type={reveal ? 'text' : 'password'}
          value={draft}
          placeholder="Bearer token"
          aria-label="Bearer token"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close()
          }}
        />
        <button type="button" className="ghost" onClick={() => setReveal((v) => !v)}>
          {reveal ? 'Hide' : 'Show'}
        </button>
        <button type="submit" className="primary" disabled={!draft.trim()}>
          Save
        </button>
        <button type="button" className="ghost" onClick={close}>
          Cancel
        </button>
      </form>
    )
  }

  const authFailed = Boolean(props.error && /401|403|unauthori[sz]ed|forbidden|token/i.test(props.error))
  const state = !props.token ? 'none' : authFailed ? 'rejected' : 'set'
  const label =
    state === 'none' ? 'No token' : state === 'rejected' ? 'Token rejected' : `Token ${maskToken(props.token)}`

  return (
    <span className="token-control">
      <span className={`token-badge token-${state}`} title={authFailed ? (props.error ?? undefined) : undefined}>
        {label}
      </span>
      <button type="button" className="ghost small" onClick={() => setEditing(true)}>
        {props.token ? 'Change' : 'Set token'}
      </button>
      {props.token ? (
        <button type="button" className="ghost small" onClick={() => props.onChange('')}>
          Clear
        </button>
      ) : null}
    </span>
  )
}
