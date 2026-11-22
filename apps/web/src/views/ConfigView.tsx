import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Button, Field } from '../components/ui'
import { useConfigQuery, useSaveConfig } from '../hooks/useConfigQuery'
import { parseJsonField } from '../lib/configJson'
import type { ManagedAgent } from '../lib/ipc'
import { useUiStore } from '../stores/uiStore'

/**
 * JSON object editor. Keeps the raw text in local state so a half-typed value
 * (`{`, a trailing comma) does not snap back to the last valid object; valid
 * parses are propagated immediately so Save always sees the latest value.
 */
function JsonField({ id, value, onChange }: { id: string; value: unknown; onChange: (v: unknown) => void }) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2))
  const [error, setError] = useState<string | null>(null)
  const focused = useRef(false)

  // Adopt external changes (refetch, Reset) only while the user is not editing.
  useEffect(() => {
    if (!focused.current) setText(JSON.stringify(value, null, 2))
  }, [value])

  return (
    <>
      <textarea
        id={id}
        value={text}
        onFocus={() => {
          focused.current = true
        }}
        onBlur={() => {
          focused.current = false
        }}
        onChange={(e) => {
          const next = e.target.value
          setText(next)
          const parsed = parseJsonField(next)
          if (parsed.ok) {
            onChange(parsed.value)
            setError(null)
          } else {
            setError('Invalid JSON — not saved until it parses')
          }
        }}
      />
      {error ? (
        <div className="hint text-danger" role="alert">
          {error}
        </div>
      ) : null}
    </>
  )
}

function ConfigField({ name, value, onChange }: { name: string; value: unknown; onChange: (v: unknown) => void }) {
  const type = typeof value
  const inputId = `config-field-${name}`
  let input: ReactNode
  if (type === 'boolean') {
    input = <input id={inputId} type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
  } else if (type === 'number') {
    input = (
      <input
        id={inputId}
        type="number"
        value={value as number}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      />
    )
  } else if (type === 'object' && value !== null) {
    input = <JsonField id={inputId} value={value} onChange={onChange} />
  } else {
    input = <input id={inputId} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
  }
  return (
    <Field label={name} htmlFor={inputId}>
      {input}
    </Field>
  )
}

export function ConfigView({ agents }: { agents: ManagedAgent[] }) {
  const token = useUiStore((s) => s.token)
  const [selectedAgent, setSelectedAgent] = useState<ManagedAgent | null>(null)
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null)
  const [dirty, setDirty] = useState(false)
  const savedTimer = useRef<number | undefined>(undefined)

  const configQuery = useConfigQuery(selectedAgent?.configPath ?? null, token)
  const save = useSaveConfig(token)

  useEffect(() => () => window.clearTimeout(savedTimer.current), [])

  // Seed the editable draft when a fresh config arrives, but never clobber
  // unsaved edits: a background refetch (window focus, 30 s stale time) must
  // not silently discard what the user is typing.
  useEffect(() => {
    if (configQuery.data && !dirty) setDraft(configQuery.data)
  }, [configQuery.data, dirty])

  const handleChange = (key: string, value: unknown) => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev))
    setDirty(true)
  }

  const handleSave = () => {
    if (!selectedAgent || !draft) return
    save.mutate(
      { path: selectedAgent.configPath, config: draft },
      {
        onSuccess: () => {
          setDirty(false)
          window.clearTimeout(savedTimer.current)
          savedTimer.current = window.setTimeout(() => save.reset(), 2000)
        },
      },
    )
  }

  if (!selectedAgent) {
    return (
      <div className="card">
        <h2>Configuration</h2>
        <p className="muted">Select an agent from the list to view and edit its configuration.</p>
        <div className="mt">
          {agents.map((agent) => (
            <button key={agent.id} type="button" className="tool-item" onClick={() => setSelectedAgent(agent)}>
              <div className="name">
                {agent.name} <span className="small muted">({agent.id})</span>
              </div>
              <div className="desc">{agent.configPath}</div>
            </button>
          ))}
        </div>
      </div>
    )
  }

  const error = configQuery.error?.message ?? save.error?.message ?? null

  return (
    <div className="card">
      <div className="row between">
        <div>
          <h2>{selectedAgent.name}</h2>
          <p className="muted small">{selectedAgent.configPath}</p>
        </div>
        <Button variant="quiet" onClick={() => setSelectedAgent(null)}>
          Back to list
        </Button>
      </div>

      {error ? (
        <div className="msg msg-error mt" role="alert">
          {error}
        </div>
      ) : null}

      {configQuery.isPending ? <p className="muted mt">Loading configuration…</p> : null}

      {draft ? (
        <div className="mt">
          {Object.entries(draft).map(([k, v]) => (
            <ConfigField key={k} name={k} value={v} onChange={(val) => handleChange(k, val)} />
          ))}
          <div className="row mt">
            <Button variant="primary" onClick={handleSave} disabled={save.isPending || !dirty}>
              {save.isPending ? 'Saving…' : save.isSuccess ? 'Saved ✓' : 'Save changes'}
            </Button>
            <Button
              variant="quiet"
              onClick={() => {
                setDraft(configQuery.data ?? null)
                setDirty(false)
              }}
              disabled={!dirty}
            >
              Reset
            </Button>
            {dirty ? <span className="muted small">Unsaved changes</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
