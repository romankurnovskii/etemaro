import { useEffect, useRef, useState } from 'react'
import type { ConnectionStatus } from '../stores/connectionStore'
import { useThemeStore } from '../stores/themeStore'
import { useUiStore } from '../stores/uiStore'
import { Logo } from './Logo'
import { Button, Pill, type PillTone } from './ui'

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: 'Connected',
  connecting: 'Connecting',
  disconnected: 'Disconnected',
}

const STATUS_TONE: Record<ConnectionStatus, PillTone> = {
  connected: 'success',
  connecting: 'warning',
  disconnected: 'danger',
}

const THEME_LABEL = { system: 'Auto', light: 'Light', dark: 'Dark' } as const

interface Props {
  daemonUrl: string
  status: ConnectionStatus
  lastError: string | null
  authFailed: boolean
  runningAgents: number
  totalAgents: number
}

export function Header({ daemonUrl, status, lastError, authFailed, runningAgents, totalAgents }: Props) {
  const token = useUiStore((s) => s.token)
  const setToken = useUiStore((s) => s.setToken)
  const open = useUiStore((s) => s.connectionOpen)
  const setOpen = useUiStore((s) => s.setConnectionOpen)
  const themeMode = useThemeStore((s) => s.mode)
  const cycleTheme = useThemeStore((s) => s.cycle)
  const [draft, setDraft] = useState(token)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const dirty = draft !== token

  // A rejected token is the only reason this panel matters — surface it.
  useEffect(() => {
    if (authFailed) setOpen(true)
  }, [authFailed, setOpen])

  useEffect(() => {
    setDraft(token)
  }, [token])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [open, setOpen])

  return (
    <header className="topbar">
      <div className="brand">
        <Logo size={30} />
        <div>
          <h1>Etemaro</h1>
          <p className="mono small muted">{daemonUrl}</p>
        </div>
      </div>

      <div className="topbar-status" aria-live="polite">
        <Pill tone={STATUS_TONE[status]} dot>
          Daemon {STATUS_LABEL[status].toLowerCase()}
        </Pill>
        <span className="muted small">
          {runningAgents}/{totalAgents} agents running
        </span>
        {lastError && !authFailed ? <span className="small text-danger">{lastError}</span> : null}
      </div>

      <div className="topbar-actions">
        <Button
          size="sm"
          variant="quiet"
          onClick={cycleTheme}
          title={`Theme: ${THEME_LABEL[themeMode]} — click to change`}
          aria-label={`Theme: ${THEME_LABEL[themeMode]}. Click to change.`}
        >
          {THEME_LABEL[themeMode]}
        </Button>

        <div className="conn-menu" ref={panelRef}>
          <Button
            size="sm"
            variant={authFailed ? 'danger' : 'secondary'}
            aria-expanded={open}
            aria-controls="connection-panel"
            onClick={() => setOpen(!open)}
          >
            {authFailed ? 'Token rejected' : token ? 'Token set' : 'Connection'}
          </Button>

          {open ? (
            <div className="conn-panel" id="connection-panel" role="dialog" aria-label="Daemon connection">
              <h2>Daemon connection</h2>
              <p className="muted small">
                The console talks to the daemon over its local IPC port. A bearer token is only required when the daemon
                config sets <code>connection.ipcToken</code> — the default localhost setup has none.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  setToken(draft.trim())
                  setOpen(false)
                }}
              >
                <label htmlFor="daemon-token" className="field-label">
                  Bearer token
                </label>
                <input
                  id="daemon-token"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={draft}
                  placeholder={token ? 'Token set' : 'Not set — leave empty for localhost'}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <p className="hint">
                  Stored in this browser only (<code>localStorage</code>). Per-agent tokens are never stored.
                </p>
                <div className="row dialog-actions">
                  {token ? (
                    <Button
                      size="sm"
                      variant="quiet"
                      onClick={() => {
                        setDraft('')
                        setToken('')
                      }}
                    >
                      Clear
                    </Button>
                  ) : null}
                  <Button type="submit" size="sm" variant="primary" disabled={!dirty}>
                    Save
                  </Button>
                </div>
              </form>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  )
}
