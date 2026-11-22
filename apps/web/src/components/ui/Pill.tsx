import type { ReactNode } from 'react'

export type PillTone = 'neutral' | 'success' | 'warning' | 'danger'

export interface PillProps {
  tone?: PillTone
  /** Render the leading status dot. */
  dot?: boolean
  children: ReactNode
  title?: string
}

/** Status pill used by the header connection badge and agent cards. */
export function Pill({ tone = 'neutral', dot = false, children, title }: PillProps) {
  return (
    <span className={`status-pill pill-${tone}`} title={title}>
      {dot ? <span className="dot" aria-hidden="true" /> : null}
      {children}
    </span>
  )
}
