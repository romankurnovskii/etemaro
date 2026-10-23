import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DashboardView } from './DashboardView'

describe('USD display provenance', () => {
  it('does not display placeholder zeros as measured USD', () => {
    const html = renderToStaticMarkup(
      React.createElement(DashboardView, {
        snapshot: {
          totalPnlUsd: 0,
          totalPnlUsdKnown: false,
          busy: false,
          positions: [{ positionAddress: 'p', poolAddress: 'pool' }],
        },
      }),
    )
    expect(html).not.toContain('$0.00')
    expect(html.match(/Not reported/g)).toHaveLength(3)
  })
  it('retains actual observed zero values', () => {
    const html = renderToStaticMarkup(
      React.createElement(DashboardView, {
        snapshot: {
          totalPnlUsd: 0,
          totalPnlUsdKnown: true,
          busy: false,
          positions: [{ positionAddress: 'p', poolAddress: 'pool', pnlUsd: 0, valueUsd: 0 }],
        },
      }),
    )
    expect(html.match(/\$0\.00/g)).toHaveLength(3)
  })
})
