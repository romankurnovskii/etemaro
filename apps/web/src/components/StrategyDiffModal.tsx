import { useEffect, useState } from 'react'
import { computeStrategyDiff, type StrategyDiffEntry } from '../lib/agentViz'
import { DAEMON_URL } from '../lib/api'
import { fetchStrategyDetails } from '../lib/tools'

interface Props {
  agentName: string
  currentStrategyId: string | null
  targetStrategyId: string
  token: string
  onConfirm: () => Promise<void>
  onClose: () => void
}

function renderVal(v: unknown): string {
  if (v === undefined || v === null) return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/**
 * Preview diff modal before switching strategies on an agent.
 */
export function StrategyDiffModal({
  agentName,
  currentStrategyId,
  targetStrategyId,
  token,
  onConfirm,
  onClose,
}: Props) {
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [diffs, setDiffs] = useState<StrategyDiffEntry[]>([])

  useEffect(() => {
    let active = true
    setLoading(true)

    const endpoint = `${DAEMON_URL}/api/tool`
    Promise.all([
      currentStrategyId ? fetchStrategyDetails(endpoint, token, currentStrategyId) : Promise.resolve(null),
      fetchStrategyDetails(endpoint, token, targetStrategyId),
    ])
      .then(([currentData, targetData]) => {
        if (!active) return
        const computed = computeStrategyDiff(currentData, targetData)
        setDiffs(computed)
      })
      .catch(() => {
        if (!active) return
        setDiffs([])
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [currentStrategyId, targetStrategyId, token])

  const handleConfirm = async () => {
    setSubmitting(true)
    try {
      await onConfirm()
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card">
        <div className="modal-header">
          <div>
            <h3>Confirm Strategy Switch</h3>
            <p className="muted small">Review parameter diffs for {agentName}</p>
          </div>
          <button type="button" className="ghost" onClick={onClose} aria-label="Close dialog">
            ✕
          </button>
        </div>

        <div className="diff-banner mt">
          <div className="diff-source">
            <span className="muted tiny">CURRENT</span>
            <div className="mono small">{currentStrategyId ?? 'None (Unassigned)'}</div>
          </div>
          <div className="diff-arrow">→</div>
          <div className="diff-target">
            <span className="muted tiny">TARGET</span>
            <div className="mono small font-bold">{targetStrategyId}</div>
          </div>
        </div>

        <div className="diff-content mt">
          {loading ? (
            <p className="muted small">Analyzing strategy parameters…</p>
          ) : diffs.length === 0 ? (
            <p className="muted small">No specific parameter differences found. Default configuration will apply.</p>
          ) : (
            <div className="diff-table-container">
              <table className="diff-table">
                <thead>
                  <tr>
                    <th>Parameter</th>
                    <th>Current Value</th>
                    <th>Target Value</th>
                    <th>Change</th>
                  </tr>
                </thead>
                <tbody>
                  {diffs.map((d) => (
                    <tr key={d.key} className={`diff-row-${d.status}`}>
                      <td className="mono small font-medium">{d.key}</td>
                      <td className="mono small text-removed">{renderVal(d.from)}</td>
                      <td className="mono small text-added">{renderVal(d.to)}</td>
                      <td>
                        <span className={`diff-badge diff-badge-${d.status}`}>
                          {d.status === 'added'
                            ? '+ Added'
                            : d.status === 'removed'
                              ? '- Removed'
                              : d.status === 'changed'
                                ? '~ Changed'
                                : '= Unchanged'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="modal-footer mt">
          <button type="button" className="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={() => void handleConfirm()} disabled={submitting}>
            {submitting ? 'Applying…' : 'Confirm & Switch Strategy'}
          </button>
        </div>
      </div>
    </div>
  )
}
