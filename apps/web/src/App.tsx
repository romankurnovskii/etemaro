import { useEffect, useState } from 'react'
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
const TOKEN_STORAGE_KEY = 'etemaro.token'

/** A legacy URL token is session-only unless the user explicitly saves it. */
export function readInitialToken(): string {
  const fromUrl = new URLSearchParams(location.search).get('token')
  if (fromUrl) return fromUrl
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

/** Display the endpoint without credentials, query parameters or fragments. */
export function endpointLabel(endpoint: string): string {
  try {
    const url = new URL(endpoint)
    return `${url.origin}${url.pathname === '/' ? '' : url.pathname}`
  } catch {
    return 'Daemon endpoint'
  }
}

export function TokenControls({ token, onApply }: { token: string; onApply: (token: string) => void }) {
  const [draft, setDraft] = useState(token)
  const [remember, setRemember] = useState(false)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    setDraft(token)
  }, [token])

  const apply = (next: string, save: boolean) => {
    let storageUpdated = true
    try {
      if (save && next) localStorage.setItem(TOKEN_STORAGE_KEY, next)
      else localStorage.removeItem(TOKEN_STORAGE_KEY)
    } catch {
      storageUpdated = false
    }
    onApply(next)
    setDraft(next)
    setRemember(false)
    setNotice(
      !storageUpdated
        ? 'Token updated for this tab, but browser storage could not be updated.'
        : save && next
          ? 'Token updated and saved in this browser.'
          : next
            ? 'Token updated for this tab only; no saved token remains.'
            : 'Token cleared from this tab and browser storage.',
    )
  }

  return (
    <details className="console-token">
      <summary>Access token · {token ? 'configured' : 'not set'}</summary>
      <form
        className="console-token-panel"
        onSubmit={(event) => {
          event.preventDefault()
          apply(draft.trim(), remember)
        }}
      >
        <label className="field" htmlFor="console-access-token">
          <span>Daemon access token</span>
          <input
            id="console-access-token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        <label className="console-token-remember">
          <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
          Remember in this browser
        </label>
        <p className="hint">
          Saving uses browser storage. Leave unchecked to remove any saved token and use this tab only.
        </p>
        <div className="console-token-actions">
          <button type="submit" className="primary">
            Use token
          </button>
          <button type="button" onClick={() => apply('', false)}>
            Clear token
          </button>
        </div>
        {notice ? (
          <p className="small" role="status">
            {notice}
          </p>
        ) : null}
      </form>
    </details>
  )
}

export default function App() {
  const [token, setToken] = useState(readInitialToken)
  const [urlWarning, setUrlWarning] = useState('')
  useEffect(() => {
    // Retain legacy deep links without leaving the credential in the address bar.
    const url = new URL(location.href)
    if (!url.searchParams.has('token')) return
    url.searchParams.delete('token')
    try {
      history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`)
    } catch {
      setUrlWarning('Remove the token parameter from the address bar before sharing this link.')
    }
  }, [])
  const [tab, setTab] = useState<Tab>('agents')
  const [openTool, setOpenTool] = useState<string | null>(null)
  const conn = useAgentConnection(WS_URL, token)
  const agents = useAgents(token)
  const strategies = useStrategies(token)

  return (
    <div className="app">
      <header className="topbar">
        <h1>Etemaro Agent Console</h1>
        <span>
          <span className={`status-dot status-${conn.status}`} />
          {conn.status}
        </span>
        <span className="spacer" />
        <span className="muted small">{endpointLabel(DAEMON_URL)}</span>
        <TokenControls token={token} onApply={setToken} />
      </header>
      {urlWarning ? (
        <p className="error small" role="alert">
          {urlWarning}
        </p>
      ) : null}
      <nav className="tabs">
        {TABS.map((t) => (
          <button type="button" key={t} className={t === tab ? 'active' : ''} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </nav>
      <main key={token}>
        {tab === 'agents' ? (
          <AgentsView
            token={token}
            agents={agents.agents}
            loading={agents.loading}
            loadError={agents.error}
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
        {tab === 'tools' ? (
          <ToolsView
            catalog={conn.catalog}
            token={token}
            initialToolName={openTool}
            onComplete={(name) => {
              if (name === 'add_strategy') void strategies.reload()
            }}
          />
        ) : null}
        {tab === 'config' ? <ConfigView agents={agents.agents} token={token} /> : null}
        {tab === 'logs' ? <LogsView logs={conn.logs} /> : null}
        {tab === 'chat' ? <ChatView chat={conn.chat} onSend={conn.sendChat} /> : null}
      </main>
    </div>
  )
}
