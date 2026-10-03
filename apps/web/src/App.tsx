import { useEffect, useState } from 'react'
import { useAgentConnection } from './hooks/useAgentConnection'
import { useAgents } from './hooks/useAgents'
import { useFleetTelemetry } from './hooks/useFleetTelemetry'
import { useStrategies } from './hooks/useStrategies'
import { DAEMON_URL } from './lib/api'
import { VALID_HASHES, parseHash } from './lib/hashRoute'
import type { Tab } from './lib/hashRoute'
import { AgentsView } from './views/AgentsView'
import { ChatView } from './views/ChatView'
import { ConfigView } from './views/ConfigView'
import { DashboardView } from './views/DashboardView'
import { LogsView } from './views/LogsView'
import { ToolsView } from './views/ToolsView'

// ─── Hash routing (~20 lines, no router lib) ──────────────────────────────────
function readHash(): Tab {
  return parseHash(location.hash)
}

function useHashRoute(): [Tab, (t: Tab) => void] {
  const [tab, setTab] = useState<Tab>(readHash)
  useEffect(() => {
    const handler = () => setTab(readHash())
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])
  const navigate = (t: Tab) => {
    history.pushState(null, '', `#${t}`)
    setTab(t)
  }
  return [tab, navigate]
}

// ─── Token helpers ────────────────────────────────────────────────────────────
function loadToken(): string {
  const fromUrl = new URLSearchParams(location.search).get('token')
  if (fromUrl) {
    try {
      localStorage.setItem('etemaro.token', fromUrl)
    } catch {
      /* ignore */
    }
    // Strip ?token= from URL without full-page reload
    const next = new URL(location.href)
    next.searchParams.delete('token')
    history.replaceState(null, '', next.toString())
    return fromUrl
  }
  try {
    return localStorage.getItem('etemaro.token') ?? ''
  } catch {
    return ''
  }
}

function saveToken(t: string) {
  try {
    localStorage.setItem('etemaro.token', t)
  } catch {
    /* ignore */
  }
}
function clearToken() {
  try {
    localStorage.removeItem('etemaro.token')
  } catch {
    /* ignore */
  }
}

// ─── ConnectionBadge ──────────────────────────────────────────────────────────
interface BadgeProps {
  status: 'connecting' | 'connected' | 'disconnected' | 'auth-failed'
  retryIn: number | null
}
function ConnectionBadge({ status, retryIn }: BadgeProps) {
  const label =
    status === 'connected'
      ? 'Connected'
      : status === 'auth-failed'
        ? 'Token rejected'
        : status === 'connecting'
          ? 'Connecting…'
          : retryIn != null
            ? `Retry in ${retryIn}s`
            : 'Disconnected'

  return (
    <span className={`conn-badge ${status}`} role="status" aria-label={`Daemon ${label}`}>
      <span className="dot" />
      {label}
    </span>
  )
}

// ─── TokenControl ─────────────────────────────────────────────────────────────
interface TokenProps {
  token: string
  onSet: (t: string) => void
  onClear: () => void
}
function TokenControl({ token, onSet, onClear }: TokenProps) {
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)

  if (!editing) {
    return (
      <span className="token-ctrl">
        {token ? (
          <>
            <span className="muted small" style={{ fontFamily: 'var(--mono)' }}>
              token: {token.slice(0, 4)}…
            </span>
            <button type="button" className="ghost small" onClick={() => setEditing(true)}>
              Replace
            </button>
            <button
              type="button"
              className="ghost small"
              onClick={() => {
                clearToken()
                onClear()
              }}
            >
              Clear
            </button>
          </>
        ) : (
          <button type="button" className="ghost small" onClick={() => setEditing(true)}>
            Set token
          </button>
        )}
      </span>
    )
  }

  return (
    <span className="token-ctrl">
      <input
        id="token-input"
        type="password"
        value={draft}
        placeholder="Paste token…"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && draft.trim()) {
            const t = draft.trim()
            saveToken(t)
            onSet(t)
            setDraft('')
            setEditing(false)
          } else if (e.key === 'Escape') {
            setDraft('')
            setEditing(false)
          }
        }}
      />
      <button
        type="button"
        className="primary"
        onClick={() => {
          if (draft.trim()) {
            saveToken(draft.trim())
            onSet(draft.trim())
            setDraft('')
            setEditing(false)
          }
        }}
      >
        Save
      </button>
      <button
        type="button"
        className="ghost"
        onClick={() => {
          setDraft('')
          setEditing(false)
        }}
      >
        Cancel
      </button>
    </span>
  )
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [token, setToken] = useState<string>(loadToken)
  const [tab, navigate] = useHashRoute()
  const [openTool, setOpenTool] = useState<string | null>(null)

  // Console-daemon connection — for Dashboard, Tools, Config, Logs (global), Chat
  const conn = useAgentConnection(DAEMON_URL, token)
  const agents = useAgents(token)
  const strategies = useStrategies(token)

  // Per-agent telemetry store — opens one WS per running agent on its ipcPort
  const telemetry = useFleetTelemetry(agents.agents, token, DAEMON_URL)

  return (
    <div className="app">
      <header className="topbar">
        <h1>Etemaro</h1>
        <ConnectionBadge status={conn.status} retryIn={conn.retryIn} />
        <span className="muted small" style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
          {DAEMON_URL}
        </span>
        <span className="spacer" />
        <TokenControl token={token} onSet={setToken} onClear={() => setToken('')} />
      </header>

      {conn.apiError && (
        <div className="banner banner-error" role="alert">
          {conn.apiError}
        </div>
      )}

      <div className="tabs" role="tablist" aria-label="Main navigation">
        {VALID_HASHES.map((t) => (
          <button
            type="button"
            key={t}
            id={`tab-${t}`}
            role="tab"
            aria-selected={t === tab}
            className={t === tab ? 'active' : ''}
            onClick={() => navigate(t)}
          >
            {t === 'agents' ? 'Agents' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <main role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'agents' ? (
          <AgentsView
            agents={agents.agents}
            busy={agents.busy}
            agentsError={agents.error}
            strategies={strategies.strategies}
            telemetry={telemetry}
            token={token}
            onCreate={agents.create}
            onStart={agents.start}
            onStop={agents.stop}
            onSetStrategy={agents.setStrategy}
            onReload={agents.reload}
            onCreateStrategy={() => {
              setOpenTool('add_strategy')
              navigate('tools')
            }}
          />
        ) : null}
        {tab === 'dashboard' ? <DashboardView snapshot={conn.snapshot} /> : null}
        {tab === 'tools' ? <ToolsView catalog={conn.catalog} token={token} initialToolName={openTool} /> : null}
        {tab === 'config' ? <ConfigView agents={agents.agents} token={token} /> : null}
        {tab === 'logs' ? <LogsView logs={conn.logs} agents={agents.agents} /> : null}
        {tab === 'chat' ? <ChatView chat={conn.chat} onSend={conn.sendChat} /> : null}
      </main>
    </div>
  )
}
