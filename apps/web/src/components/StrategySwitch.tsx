import { useEffect, useRef, useState } from 'react'
import { callTool } from '../lib/api'
import type { ManagedAgent, StrategySummary } from '../lib/ipc'
import { type DiffRow, diffStrategies, formatDiffValue } from '../lib/strategyDiff'

interface Props {
  agent: ManagedAgent
  strategies: StrategySummary[]
  token: string
  onApply: (agentId: string, strategyId: string) => Promise<void>
}

interface Preview {
  /** Agent strategy the diff was computed against — must still match to confirm. */
  from: string | null
  to: string
  rows: DiffRow[]
  /** The current strategy could not be loaded (e.g. deleted from the library). */
  fromMissing: boolean
}

type ToolResult = Record<string, unknown>

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Strategy selector with a mandatory diff preview. Render it with
 * `key={agent.id + agent.strategyId}` so any change of the agent's strategy
 * (from a poll or another tab) remounts it and drops a stale preview.
 */
export function StrategySwitch({ agent, strategies, token, onApply }: Props) {
  const current = agent.strategyId
  const [target, setTarget] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestRef = useRef(0)
  const dialogRef = useRef<HTMLDialogElement>(null)

  // Late get_strategy responses after unmount are ignored.
  useEffect(
    () => () => {
      requestRef.current += 1
    },
    [],
  )

  useEffect(() => {
    const dialog = dialogRef.current
    if (preview && dialog && !dialog.open) dialog.showModal()
  }, [preview])

  const reset = () => {
    requestRef.current += 1
    setTarget('')
    setPreview(null)
    setLoading(false)
    setError(null)
  }

  const requestPreview = async (to: string) => {
    const request = ++requestRef.current
    setTarget(to)
    setPreview(null)
    setError(null)
    if (!to || to === current) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [fromRes, toRes] = await Promise.all([
        current ? callTool<ToolResult>('get_strategy', { id: current }, token) : Promise.resolve(null),
        callTool<ToolResult>('get_strategy', { id: to }, token),
      ])
      if (request !== requestRef.current) return
      if (typeof toRes.error === 'string') throw new Error(toRes.error)
      const fromMissing = Boolean(current) && (!fromRes || typeof fromRes.error === 'string')
      setPreview({ from: current, to, rows: diffStrategies(fromMissing ? null : fromRes, toRes), fromMissing })
    } catch (e: unknown) {
      if (request === requestRef.current) setError(`Could not load strategy diff: ${errorMessage(e)}`)
    } finally {
      if (request === requestRef.current) setLoading(false)
    }
  }

  const confirm = async () => {
    if (!preview) return
    if (preview.from !== agent.strategyId) {
      setError('The agent strategy changed since this preview was built. Pick the target again.')
      return
    }
    setApplying(true)
    setError(null)
    try {
      await onApply(agent.id, preview.to)
      dialogRef.current?.close()
    } catch (e: unknown) {
      setError(`Switch failed: ${errorMessage(e)}`)
    } finally {
      setApplying(false)
    }
  }

  const selectId = `strategy-${agent.id}`

  return (
    <div className="strategy-switch">
      <label htmlFor={selectId} className="field-label">
        Switch strategy
      </label>
      <div className="row">
        <select
          id={selectId}
          value={target}
          disabled={strategies.length === 0 || applying}
          onChange={(e) => void requestPreview(e.target.value)}
        >
          <option value="">{strategies.length === 0 ? 'No strategies in library' : 'Choose a strategy…'}</option>
          {strategies.map((s) => (
            <option key={s.id} value={s.id} disabled={s.id === current}>
              {s.name && s.name !== s.id ? `${s.name} (${s.id})` : s.id}
              {s.id === current ? ' — current' : ''}
            </option>
          ))}
        </select>
        {loading ? <span className="muted small">Loading diff…</span> : null}
      </div>
      {error && !preview ? (
        <p className="msg msg-error" role="alert">
          {error}
        </p>
      ) : null}

      <dialog ref={dialogRef} className="dialog" aria-labelledby={`${selectId}-title`} onClose={reset}>
        {preview ? (
          <form
            method="dialog"
            onSubmit={(e) => {
              e.preventDefault()
              void confirm()
            }}
          >
            <h3 id={`${selectId}-title`}>Switch {agent.name}'s strategy?</h3>
            <p className="mono small">
              {preview.from ?? 'none'} → {preview.to}
            </p>
            {agent.running ? (
              <p className="msg msg-warn">
                <strong>Restart required.</strong> This agent is running. The switch only rewrites its config file; the
                running process keeps using <span className="mono">{preview.from ?? 'its current strategy'}</span> until
                you restart the agent (Stop, then Start).
              </p>
            ) : (
              <p className="muted small">The agent is stopped; it will use the new strategy on its next start.</p>
            )}
            {preview.fromMissing ? (
              <p className="msg msg-warn">
                Current strategy <span className="mono">{preview.from}</span> was not found in the library; all
                parameters of the new strategy are shown as added.
              </p>
            ) : null}
            <DiffTable rows={preview.rows} />
            {error ? (
              <p className="msg msg-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="row dialog-actions">
              <button type="button" className="btn" onClick={() => dialogRef.current?.close()} disabled={applying}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={applying}>
                {applying ? 'Switching…' : 'Confirm switch'}
              </button>
            </div>
          </form>
        ) : null}
      </dialog>
    </div>
  )
}

const KIND_LABEL: Record<DiffRow['kind'], string> = { added: 'added', removed: 'removed', changed: 'changed' }

function DiffTable({ rows }: { rows: DiffRow[] }) {
  if (rows.length === 0) return <p className="muted">No parameter differences between the two strategies.</p>
  return (
    <div className="table-scroll diff-scroll">
      <table className="diff-table">
        <caption className="sr-only">Strategy parameter differences</caption>
        <thead>
          <tr>
            <th scope="col">Parameter</th>
            <th scope="col">Current</th>
            <th scope="col">New</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className={`diff-${row.kind}`}>
              <th scope="row" className="mono">
                {row.key} <span className={`tag tag-${row.kind}`}>{KIND_LABEL[row.kind]}</span>
              </th>
              <td className="mono">{formatDiffValue(row.before)}</td>
              <td className="mono">{formatDiffValue(row.after)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
