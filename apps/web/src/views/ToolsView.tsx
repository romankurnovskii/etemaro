import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { fetchJson } from '../lib/api'
import type { JsonSchema, ToolDescriptor } from '../lib/ipc'

interface Props {
  catalog: ToolDescriptor[]
  token: string
  initialToolName?: string | null
  onComplete?: (toolName: string) => void
}

export function normalizeArgs(tool: ToolDescriptor, raw: Record<string, unknown>): Record<string, unknown> {
  const props = tool.parameters?.properties ?? {}
  const out: Record<string, unknown> = {}
  const required = tool.parameters?.required ?? []
  const numberValue = (value: unknown, integer: boolean, name: string): number => {
    const n = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(n) || (integer && !Number.isSafeInteger(n))) {
      throw new Error(`${name} must be a finite ${integer ? 'safe integer' : 'number'}.`)
    }
    return n
  }
  for (const [name, schema] of Object.entries(props)) {
    const value = raw[name]
    const type = schema.type ?? 'string'
    if (value === undefined || value === null || value === '') {
      // An untouched boolean checkbox has the actual value false.
      if (required.includes(name) && type === 'boolean' && !schema.enum) out[name] = false
      else if (required.includes(name)) throw new Error(`${name} is required.`)
      continue
    }
    if (schema.enum) {
      const option = schema.enum.find((candidate) => String(candidate) === String(value))
      if (option === undefined) throw new Error(`${name} must be one of the available options.`)
      out[name] = option
    } else if (type === 'number' || type === 'integer') out[name] = numberValue(value, type === 'integer', name)
    else if (type === 'array' && typeof value === 'string') {
      const parts = value
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p.length > 0)
      out[name] =
        schema.items?.type === 'number' || schema.items?.type === 'integer'
          ? parts.map((part) => numberValue(part, schema.items?.type === 'integer', name))
          : parts
    } else if (type === 'object') {
      let parsed: unknown
      try {
        parsed = typeof value === 'string' ? JSON.parse(value) : value
      } catch {
        throw new Error(`${name} must contain valid JSON.`)
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error(`${name} must be a JSON object.`)
      out[name] = parsed
    } else out[name] = value
  }
  return out
}

export function ToolsView({ catalog, token, initialToolName, onComplete }: Props) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState<string | null>(initialToolName ?? null)
  const [args, setArgs] = useState<Record<string, unknown>>({})
  const [confirm, setConfirm] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [copyStatus, setCopyStatus] = useState('')
  const requestVersion = useRef(0)
  const inFlight = useRef(false)
  const controller = useRef<AbortController | null>(null)
  const identity = useRef({ active, token })
  const tool = useMemo(() => catalog.find((t) => t.name === active) ?? null, [catalog, active])

  useEffect(() => {
    if (initialToolName) setActive(initialToolName)
  }, [initialToolName])

  useEffect(() => {
    identity.current = { active: tool?.name ?? active, token }
    requestVersion.current += 1
    controller.current?.abort()
    inFlight.current = false
    setPending(false)
    setArgs({})
    setConfirm(false)
    setResult(null)
    setError(null)
    setCopyStatus('')
    return () => {
      requestVersion.current += 1
      controller.current?.abort()
      inFlight.current = false
    }
  }, [active, token, tool?.name])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return catalog
    return catalog.filter((t) => `${t.name} ${t.description}`.toLowerCase().includes(q))
  }, [catalog, query])

  const run = async () => {
    if (!tool || inFlight.current) return
    const version = ++requestVersion.current
    setResult(null)
    setError(null)
    setCopyStatus('')
    if (tool.isProtected && !confirm) {
      setError('Confirm this protected action before running the tool.')
      return
    }
    let normalized: Record<string, unknown>
    try {
      normalized = normalizeArgs(tool, args)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Check the tool parameters.')
      return
    }
    inFlight.current = true
    const abort = new AbortController()
    controller.current = abort
    setPending(true)
    try {
      const body = { name: tool.name, args: normalized, confirm }
      const res = await fetchJson<unknown>('/api/tool', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abort.signal,
      })
      if (
        version === requestVersion.current &&
        identity.current.token === token &&
        identity.current.active === tool.name
      ) {
        setResult(JSON.stringify(res, null, 2) ?? String(res))
        onComplete?.(tool.name)
      }
    } catch (e) {
      if (version === requestVersion.current && !abort.signal.aborted) {
        setError(e instanceof Error ? e.message : 'The tool request failed.')
      }
    } finally {
      if (version === requestVersion.current) {
        inFlight.current = false
        controller.current = null
        setPending(false)
      }
    }
  }

  const copyResult = async () => {
    if (result === null) return
    const version = requestVersion.current
    setCopyStatus('Copying…')
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(result)
      if (version === requestVersion.current) setCopyStatus('Copied output.')
    } catch {
      if (version === requestVersion.current) setCopyStatus('Could not copy. Select the output and copy it manually.')
    }
  }

  return (
    <div className="tool-layout">
      <section className="card">
        <h2>Tools ({catalog.length})</h2>
        <label className="field" htmlFor="console-tool-search">
          <span>Search tools</span>
          <input
            id="console-tool-search"
            value={query}
            placeholder="Search tools"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="tool-list mt">
          {filtered.length === 0 ? (
            <p className="muted small">
              {catalog.length === 0 ? 'No tool catalog available.' : 'No tools match this search.'}
            </p>
          ) : null}
          {filtered.map((t) => (
            <button
              type="button"
              key={t.name}
              className={`tool-item${active === t.name ? ' active' : ''}`}
              aria-label={`Select tool ${t.name}`}
              aria-pressed={active === t.name}
              disabled={pending}
              onClick={() => setActive(t.name)}
            >
              <div className="name">
                {t.name}{' '}
                <span className={`badge ${t.isWrite ? 'badge-write' : 'badge-read'}`}>
                  {t.isWrite ? 'write' : 'read'}
                </span>
              </div>
              <div className="desc">{t.description}</div>
            </button>
          ))}
        </div>
      </section>
      <section className="card">
        {!tool ? (
          <p className="muted">Select a tool on the left to see its parameters and run it.</p>
        ) : (
          <>
            <h2>{tool.name}</h2>
            <p className="muted small">{tool.description}</p>
            <form
              aria-busy={pending}
              onSubmit={(e) => {
                e.preventDefault()
                void run()
              }}
            >
              <fieldset className="console-tool-fields" disabled={pending}>
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
                  <label className="field">
                    <span className="warn">
                      <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> I
                      understand and want to run it
                    </span>
                  </label>
                ) : null}
                <button type="submit" className="primary" disabled={pending || (tool.isProtected && !confirm)}>
                  {pending ? 'Running…' : 'Run tool'}
                </button>
              </fieldset>
            </form>
            {error ? (
              <p className="error" role="alert">
                {error}
              </p>
            ) : null}
            {result !== null ? (
              <div className="console-tool-output mt">
                <div className="console-tool-output-actions">
                  <strong>Output</strong>
                  <button type="button" onClick={() => void copyResult()}>
                    Copy output
                  </button>
                </div>
                <textarea
                  className="result console-tool-result"
                  aria-label="Tool output"
                  readOnly
                  rows={10}
                  value={result}
                />
                {copyStatus ? (
                  <p className="small" role="status">
                    {copyStatus}
                  </p>
                ) : null}
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
      <select id={inputId} required={required} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select…</option>
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
        step={type === 'integer' ? 1 : 'any'}
        required={required}
        value={value == null ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      />
    )
  } else if (type === 'array') {
    input = (
      <input
        id={inputId}
        required={required}
        value={Array.isArray(value) ? value.join(', ') : String(value ?? '')}
        placeholder="comma-separated"
        onChange={(e) => onChange(e.target.value)}
      />
    )
  } else if (type === 'object') {
    input = (
      <textarea
        id={inputId}
        required={required}
        value={typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value)}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  } else {
    input = (
      <input id={inputId} required={required} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
    )
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
