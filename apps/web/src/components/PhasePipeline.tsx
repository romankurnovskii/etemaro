import type { ReactNode } from 'react'
import { PHASES, type Phase } from '../lib/agentActivity'

const LABELS: Record<Phase, string> = {
  idle: 'Idle',
  evaluating: 'Evaluating',
  rebalancing: 'Rebalancing',
  settled: 'Settled',
}

export function PhasePipeline({ phase, note }: { phase: Phase | null; note: ReactNode }) {
  return (
    <div className="pipeline-wrap">
      <ol className="pipeline" aria-label="Agent loop phase">
        {PHASES.map((p) => (
          <li
            key={p}
            className={`pipeline-step${p === phase ? ' is-current' : ''}`}
            aria-current={p === phase ? 'step' : undefined}
          >
            {LABELS[p]}
          </li>
        ))}
      </ol>
      <p className="pipeline-note">{note}</p>
    </div>
  )
}
