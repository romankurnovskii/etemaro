import { decisionLabel, formatMetrics, relativeTime, shortenAddress } from '../lib/agentViz'
import type { Decision } from '../lib/ipc'

interface Props {
  decisions: Decision[]
  loading: boolean
  error: string | null
}

const TONE: Record<Decision['type'], string> = {
  deploy: 'tone-active',
  close: 'tone-neutral',
  skip: 'tone-warn',
  no_deploy: 'tone-warn',
  note: 'tone-neutral',
}

/**
 * Execution summary: Structured decision feed directly reflecting
 * what the agent decided, why, and which metrics drove it.
 */
export function DecisionFeed({ decisions, loading, error }: Props) {
  if (error) {
    return <p className="muted small">Decision log unavailable: {error}</p>
  }

  if (loading && decisions.length === 0) {
    return <p className="muted small">Loading decision feed…</p>
  }

  if (decisions.length === 0) {
    return <p className="muted small">No structured decisions recorded yet.</p>
  }

  return (
    <ul className="decision-feed">
      {decisions.map((decision) => {
        const metrics = formatMetrics(decision.metrics)
        return (
          <li key={decision.id} className={`decision ${TONE[decision.type] ?? 'tone-neutral'}`}>
            <div className="decision-head">
              <span className={`badge badge-${decision.type}`}>{decision.type.replace('_', ' ')}</span>
              <span className="decision-title">{decisionLabel(decision)}</span>
              <span className="muted small decision-time">{relativeTime(decision.ts)}</span>
            </div>

            {decision.summary ? <p className="decision-summary">{decision.summary}</p> : null}

            {decision.reason ? (
              <p className="decision-reason">
                <span className="muted">Rationale:</span> {decision.reason}
              </p>
            ) : null}

            {metrics.length > 0 ? (
              <div className="decision-metrics mono">
                {metrics.map((metric) => (
                  <span key={metric} className="metric-chip">
                    {metric}
                  </span>
                ))}
              </div>
            ) : null}

            {decision.risks && decision.risks.length > 0 ? (
              <p className="decision-risks">
                <span className="muted">Flagged risks:</span> {decision.risks.join(' · ')}
              </p>
            ) : null}

            {decision.rejected && decision.rejected.length > 0 ? (
              <details className="decision-rejected">
                <summary>{decision.rejected.length} rejected candidate(s)</summary>
                <ul>
                  {decision.rejected.map((candidate) => (
                    <li key={candidate} className="mono small">
                      {candidate}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}

            {decision.position ? (
              <div className="muted small mono mt-1">Position ID: {shortenAddress(decision.position, 6, 6)}</div>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
