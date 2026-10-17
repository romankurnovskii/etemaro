import { useState } from 'react'

interface Props {
  token: string
  onSave: (token: string) => void
}

export function TokenControl({ token, onSave }: Props) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')

  const save = (value: string) => {
    onSave(value.trim())
    setDraft('')
    setOpen(false)
  }

  return (
    <div className="token-control">
      <button type="button" className="ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {token ? 'Token set' : 'Set token'}
      </button>
      {open ? (
        <form
          className="token-pop card"
          onSubmit={(e) => {
            e.preventDefault()
            save(draft)
          }}
        >
          <label className="field">
            <span>Bearer token</span>
            <input
              type="password"
              autoComplete="off"
              value={draft}
              placeholder={token ? '•••••••• (enter to replace)' : 'etemaro.token'}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="hint">Stored in this browser only (localStorage).</div>
          </label>
          <div className="row">
            <button type="submit" className="primary" disabled={!draft.trim()}>
              Save
            </button>
            {token ? (
              <button type="button" className="danger" onClick={() => save('')}>
                Clear
              </button>
            ) : null}
          </div>
        </form>
      ) : null}
    </div>
  )
}
