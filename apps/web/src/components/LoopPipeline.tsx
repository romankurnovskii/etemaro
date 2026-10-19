import { LOOP_STAGES, type LoopStage } from '../lib/ipc'

interface Props {
  stage: LoopStage
  active: boolean
}

/**
 * Renders the agent loop as a four-stage pipeline
 * (Idle → Evaluating → Rebalancing → Settled).
 *
 * The active stage is highlighted; a live iteration also pulses so an
 * operator can tell "working" from "waiting" at a glance.
 */
export function LoopPipeline({ stage, active }: Props) {
  const activeIndex = LOOP_STAGES.indexOf(stage)

  return (
    <ol className={`pipeline${active ? ' pipeline-live' : ''}`} aria-label="Agent loop stage">
      {LOOP_STAGES.map((name, index) => {
        const state = index < activeIndex ? 'done' : index === activeIndex ? 'current' : 'pending'
        return (
          <li key={name} className={`pipeline-step pipeline-${state}`} aria-current={state === 'current'}>
            <span className="pipeline-index">{index + 1}</span>
            <span className="pipeline-name">{name}</span>
          </li>
        )
      })}
    </ol>
  )
}
