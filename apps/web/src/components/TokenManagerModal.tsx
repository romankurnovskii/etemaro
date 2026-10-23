import { useState } from 'react'

interface Props {
  currentToken: string
  onSave: (newToken: string) => void
  onClose: () => void
}

export function TokenManagerModal({ currentToken, onSave, onClose }: Props) {
  const [tokenInput, setTokenInput] = useState(currentToken)
  const [savedFeedback, setSavedFeedback] = useState(false)

  const handleSave = () => {
    const trimmed = tokenInput.trim()
    try {
      if (trimmed) {
        localStorage.setItem('etemaro.token', trimmed)
      } else {
        localStorage.removeItem('etemaro.token')
      }
    } catch {
      /* ignore storage failure */
    }
    onSave(trimmed)
    setSavedFeedback(true)
    setTimeout(() => {
      setSavedFeedback(false)
      onClose()
    }, 600)
  }

  const handleClear = () => {
    setTokenInput('')
    try {
      localStorage.removeItem('etemaro.token')
    } catch {
      /* ignore */
    }
    onSave('')
    setSavedFeedback(true)
    setTimeout(() => {
      setSavedFeedback(false)
      onClose()
    }, 600)
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card">
        <div className="modal-header">
          <div>
            <h3>Daemon Token Management</h3>
            <p className="muted small">Configure Bearer token for CLI daemon authentication</p>
          </div>
          <button type="button" className="ghost" onClick={onClose} aria-label="Close dialog">
            ✕
          </button>
        </div>

        <div className="mt">
          <label className="field" htmlFor="daemon-token-input">
            <span>Bearer Auth Token</span>
            <input
              id="daemon-token-input"
              type="text"
              className="mono"
              placeholder="Paste daemon token here"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
            />
            <div className="hint">
              Stored locally in your browser. Sent with all HTTP and WebSocket requests to the daemon.
            </div>
          </label>
        </div>

        <div className="modal-footer mt">
          <button type="button" className="ghost danger-text" onClick={handleClear}>
            Clear Token
          </button>
          <div className="spacer" />
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={handleSave}>
            {savedFeedback ? 'Saved ✓' : 'Save Token'}
          </button>
        </div>
      </div>
    </div>
  )
}
