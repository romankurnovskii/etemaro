import { STAGES, type Stage } from '../lib/telemetry'

export function Pipeline({ stage, active }: { stage: Stage; active: boolean }) {
  const current = STAGES.findIndex((s) => s.id === stage)
  return (
    <ol className="pipeline" aria-label="Agent loop stage">
      {STAGES.map((s, i) => {
        const state = !active ? 'off' : i === current ? 'current' : i < current ? 'done' : 'todo'
        return (
          <li key={s.id} className={`pipe-step pipe-${state}`}>
            <span className="pipe-dot" />
            <span className="pipe-label">{s.label}</span>
          </li>
        )
      })}
    </ol>
  )
}
