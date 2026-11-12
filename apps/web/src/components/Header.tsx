import { useState } from 'react'
import type { ConnectionStatus } from '../hooks/useAgentConnection'

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: 'Connected',
  connecting: 'Connecting',
  disconnected: 'Disconnected',
}

interface Props {
  daemonUrl: string
  status: ConnectionStatus
  lastError: string | null
  runningAgents: number
  totalAgents: number
  token: string
  onTokenChange: (token: string) => void
}

export function Header({ daemonUrl, status, lastError, runningAgents, totalAgents, token, onTokenChange }: Props) {
  const [draft, setDraft] = useState(token)
  const dirty = draft !== token

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <div>
          <h1>Etemaro</h1>
          <p className="mono small muted">{daemonUrl}</p>
        </div>
      </div>

      <div className="topbar-status" aria-live="polite">
        <span className={`conn-badge conn-${status}`}>
          <span className="dot" aria-hidden="true" />
          Daemon {STATUS_LABEL[status].toLowerCase()}
        </span>
        <span className="muted small">
          {runningAgents}/{totalAgents} agents running
        </span>
        {lastError ? <span className="small text-danger">{lastError}</span> : null}
      </div>

      <form
        className="token-form"
        onSubmit={(e) => {
          e.preventDefault()
          onTokenChange(draft.trim())
        }}
      >
        <label htmlFor="daemon-token" className="field-label">
          Bearer token
        </label>
        <div className="row nowrap">
          <input
            id="daemon-token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={draft}
            placeholder={token ? 'Token set' : 'Not set'}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className="btn btn-sm" disabled={!dirty}>
            Save
          </button>
          {token ? (
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              onClick={() => {
                setDraft('')
                onTokenChange('')
              }}
            >
              Clear
            </button>
          ) : null}
        </div>
      </form>
    </header>
  )
}
