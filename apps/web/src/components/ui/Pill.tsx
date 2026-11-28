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
import React from 'react';
import clsx from 'clsx';

export type PillTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';

export interface PillProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Visual tone of the pill */
  tone?: PillTone;
}

/**
 * Simple Pill component used for tags/badges.
 * Renders a <span> with appropriate styling and forwards any additional props.
 */
export const Pill = React.forwardRef<HTMLSpanElement, PillProps>(
  ({ tone = 'neutral', className, children, ...rest }, ref) => {
    const toneClasses: Record<PillTone, string> = {
      neutral: 'bg-gray-200 text-gray-800',
      primary: 'bg-[#556B2F] text-white',
      success: 'bg-green-600 text-white',
      warning: 'bg-yellow-500 text-black',
      danger: 'bg-red-600 text-white',
    };

    return (
      <span
        ref={ref}
        className={clsx(
          'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
          toneClasses[tone],
          className
        )}
        {...rest}
      >
        {children}
      </span>
    );
  }
);

Pill.displayName = 'Pill';

export default Pill;
