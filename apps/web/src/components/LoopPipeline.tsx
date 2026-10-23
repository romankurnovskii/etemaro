import { LOOP_STAGES, type LoopStage } from '../lib/ipc'

interface Props {
  stage: LoopStage
  active: boolean
}

/**
 * Interactive 4-stage lifecycle pipeline:
 * Idle → Evaluating → Rebalancing → Settled
 */
export function LoopPipeline({ stage, active }: Props) {
  const activeIndex = LOOP_STAGES.indexOf(stage)

  return (
    <div className="pipeline-wrapper">
      <div className="pipeline-caption">
        <span className="muted small">Agent Lifecycle Loop</span>
        <span className={`pipeline-badge ${active ? 'pipeline-badge-live' : 'pipeline-badge-idle'}`}>
          <span className="pipeline-pulse-dot" />
          {active ? 'Iterating' : 'Standby'}
        </span>
      </div>
      <ol className={`pipeline${active ? ' pipeline-live' : ''}`} aria-label="Agent loop stage">
        {LOOP_STAGES.map((name, index) => {
          const state = index < activeIndex ? 'done' : index === activeIndex ? 'current' : 'pending'
          return (
            <li key={name} className={`pipeline-step pipeline-${state}`} aria-current={state === 'current'}>
              <div className="pipeline-node">
                <span className="pipeline-index">{state === 'done' ? '✓' : index + 1}</span>
              </div>
              <div className="pipeline-details">
                <span className="pipeline-name">{name}</span>
                <span className="pipeline-desc">
                  {name === 'Idle'
                    ? 'Awaiting trigger'
                    : name === 'Evaluating'
                      ? 'Signals & screening'
                      : name === 'Rebalancing'
                        ? 'Executing orders'
                        : 'Cycle complete'}
                </span>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
