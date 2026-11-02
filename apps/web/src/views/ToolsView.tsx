import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { fetchJson } from '../lib/api'
import type { JsonSchema, ToolDescriptor } from '../lib/ipc'

interface Props {
  catalog: ToolDescriptor[]
  token: string
  initialToolName?: string | null
}

function normalizeArgs(tool: ToolDescriptor, raw: Record<string, unknown>): Record<string, unknown> {
  const props = tool.parameters?.properties ?? {}
  const out: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(raw)) {
    const schema = props[name]
    if (value === undefined || value === null || value === '') continue
    const type = schema?.type ?? 'string'
    if (type === 'number' || type === 'integer') out[name] = Number(value)
    else if (type === 'array' && typeof value === 'string') {
      const parts = value
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p.length > 0)
      out[name] = schema?.items?.type === 'number' || schema?.items?.type === 'integer' ? parts.map(Number) : parts
    } else if (type === 'object' && typeof value === 'string') out[name] = JSON.parse(value)
    else out[name] = value
  }
  return out
}

export function ToolsView({ catalog, token, initialToolName }: Props) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState<string | null>(initialToolName ?? null)
  const [args, setArgs] = useState<Record<string, unknown>>({})
  const [confirm, setConfirm] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (initialToolName) setActive(initialToolName)
  }, [initialToolName])

  useEffect(() => {
    if (active) {
      setArgs({})
      setConfirm(false)
      setResult(null)
      setCopied(false)
    }
  }, [active])

  const tool = useMemo(() => catalog.find((t) => t.name === active) ?? null, [catalog, active])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return catalog
    return catalog.filter((t) => `${t.name} ${t.description}`.toLowerCase().includes(q))
  }, [catalog, query])

  const run = async () => {
    if (!tool) return
    setPending(true)
    setResult(null)
    setCopied(false)
    try {
      const body = { name: tool.name, args: normalizeArgs(tool, args), confirm }
      const res = await fetchJson<unknown>('/api/tool', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      setResult(JSON.stringify(res, null, 2))
    } catch (e) {
      setResult(e instanceof Error ? e.message : String(e))
    } finally {
      setPending(false)
    }
  }

  const handleCopy = async () => {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="tool-layout">
      <section className="card">
        <div className="section-head">
          <h2>Tool Catalog</h2>
          <span className="muted small">{catalog.length} registered</span>
        </div>
        <input
          value={query}
          placeholder="Search tools by name or description…"
          onChange={(e) => setQuery(e.target.value)}
          className="mt-1"
        />
        <div className="tool-list mt">
          {filtered.length === 0 ? (
            <p className="muted small">No matching tools found.</p>
          ) : (
            filtered.map((t) => (
              <button
                type="button"
                key={t.name}
                className={`tool-item${active === t.name ? ' active' : ''}`}
                onClick={() => setActive(t.name)}
              >
                <div className="name">
                  {t.name}{' '}
                  <span className={`badge ${t.isProtected ? 'badge-write' : 'badge-read'}`}>
                    {t.isProtected ? 'write' : 'read'}
                  </span>
                </div>
                <div className="desc">{t.description}</div>
              </button>
            ))
          )}
        </div>
      </section>

      <section className="card">
        {!tool ? (
          <div className="tool-placeholder">
            <h3>Select a Tool</h3>
            <p className="muted small mt-1">
              Select any tool from the catalog on the left to inspect its schema, provide parameters, and execute it.
            </p>
          </div>
        ) : (
          <>
            <div className="section-head">
              <div>
                <h2>{tool.name}</h2>
                <span className={`badge ${tool.isProtected ? 'badge-write' : 'badge-read'}`}>
                  {tool.isProtected ? 'State-Mutating (Write)' : 'Read-Only'}
                </span>
              </div>
            </div>
            <p className="muted small mt-1">{tool.description}</p>

            <form
              className="mt"
              onSubmit={(e) => {
                e.preventDefault()
                void run()
              }}
            >
              {Object.entries(tool.parameters?.properties ?? {}).map(([name, schema]) => (
                <ToolField
                  key={name}
                  name={name}
                  schema={schema}
                  required={(tool.parameters.required ?? []).includes(name)}
                  value={args[name]}
                  onChange={(v) => setArgs((prev) => ({ ...prev, [name]: v }))}
                />
              ))}

              {tool.isProtected ? (
                <label className="field confirmation-field">
                  <span className="warn">
                    <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> I confirm
                    and understand this action may execute real on-chain transactions or modify state
                  </span>
                </label>
              ) : null}

              <div className="row mt">
                <button type="submit" className="primary" disabled={pending}>
                  {pending ? 'Executing Tool…' : 'Execute Tool'}
                </button>
                {result ? (
                  <button type="button" className="ghost" onClick={() => setResult(null)}>
                    Clear Result
                  </button>
                ) : null}
              </div>
            </form>

            {result ? (
              <div className="result-container mt">
                <div className="result-header">
                  <span className="muted small font-medium">Output Response</span>
                  <button type="button" className="ghost small" onClick={() => void handleCopy()}>
                    {copied ? 'Copied ✓' : 'Copy Output'}
                  </button>
                </div>
                <pre className="result">{result}</pre>
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  )
}

function ToolField({
  name,
  schema,
  required,
  value,
  onChange,
}: {
  name: string
  schema: JsonSchema
  required: boolean
  value: unknown
  onChange: (v: unknown) => void
}) {
  const type = schema.type ?? 'string'
  const inputId = `tool-field-${name}`
  let input: ReactNode

  if (Array.isArray(schema.enum)) {
    input = (
      <select id={inputId} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select option…</option>
        {schema.enum.map((v) => (
          <option key={String(v)} value={String(v)}>
            {String(v)}
          </option>
        ))}
      </select>
    )
  } else if (type === 'boolean') {
    input = <input id={inputId} type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
  } else if (type === 'number' || type === 'integer') {
    input = (
      <input
        id={inputId}
        type="number"
        step="any"
        value={value == null ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      />
    )
  } else if (type === 'array') {
    input = (
      <input
        id={inputId}
        value={Array.isArray(value) ? value.join(', ') : String(value ?? '')}
        placeholder="comma-separated list"
        onChange={(e) => onChange(e.target.value)}
      />
    )
  } else if (type === 'object') {
    input = (
      <textarea
        id={inputId}
        value={typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value)}
        placeholder='JSON object, e.g. {"key": "value"}'
        onChange={(e) => onChange(e.target.value)}
      />
    )
  } else {
    input = <input id={inputId} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
  }

  return (
    <label className="field" htmlFor={inputId}>
      <span>
        {name}
        {required ? <span className="error"> *</span> : null}
      </span>
      {input}
      {schema.description ? <div className="hint">{schema.description}</div> : null}
    </label>
  )
}
