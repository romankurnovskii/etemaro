import type { IpcStateSnapshot } from '@etemaro/core'
import { renderToString } from 'ink'
import { describe, expect, it } from 'vitest'
import { StatusPane } from './StatusPane.js'

describe('StatusPane', () => {
  const baseState: IpcStateSnapshot = {
    positions: [],
    totalPnlUsd: 12.34,
    busy: false,
    walletAddress: 'Fdno111111111111111111111111111111111111QEpL',
    activeStrategyId: 'single_sided_reseed',
    configPath: '/Users/r/dev/github/etemaro/config/instances/agent-default.json',
  }

  it('renders [DRY-RUN MODE] when dryRun is true in state', () => {
    const state = { ...baseState, dryRun: true }
    const output = renderToString(
      <StatusPane connected={true} connecting={false} reconnectAttempts={0} state={state} agentId="agent-default" />,
    )
    expect(output).toContain('[DRY-RUN MODE]')
    expect(output).not.toContain('[LIVE MODE]')
  })

  it('renders [LIVE MODE] when dryRun is false in state', () => {
    const state = { ...baseState, dryRun: false }
    const output = renderToString(
      <StatusPane connected={true} connecting={false} reconnectAttempts={0} state={state} agentId="agent-default" />,
    )
    expect(output).toContain('[LIVE MODE]')
    expect(output).not.toContain('[DRY-RUN MODE]')
  })

  it('defaults to [LIVE MODE] when state.dryRun is undefined', () => {
    const output = renderToString(
      <StatusPane
        connected={true}
        connecting={false}
        reconnectAttempts={0}
        state={baseState}
        agentId="agent-default"
      />,
    )
    expect(output).toContain('[LIVE MODE]')
    expect(output).not.toContain('[DRY-RUN MODE]')
  })

  it('truncates configPath when longer than 40 characters to prevent terminal line wrap', () => {
    const output = renderToString(
      <StatusPane
        connected={true}
        connecting={false}
        reconnectAttempts={0}
        state={baseState}
        agentId="agent-default"
      />,
    )
    expect(output).toContain('…')
    expect(output).toContain('agent-default.json')
    expect(output).not.toContain('/Users/r/dev/github/etemaro/config/instances/agent-default.json')
  })

  it('renders Total PnL, Session PnL, and Open PnL properly', () => {
    const state: IpcStateSnapshot = {
      ...baseState,
      totalRealizedPnlUsd: 4.52,
      sessionPnlUsd: 1.25,
      totalPnlUsd: -0.15,
      unclaimedFeesUsd: 0.08,
      positions: [
        {
          positionAddress: 'Pos11111111111',
          poolAddress: 'Pool111111111',
          tokenSymbol: 'FLAME-SOL',
          pnlUsd: -0.15,
          pnlPct: -0.21,
          valueUsd: 70.5,
          unclaimedFeesUsd: 0.08,
        },
      ],
    }
    const output = renderToString(
      <StatusPane connected={true} connecting={false} reconnectAttempts={0} state={state} agentId="agent-default" />,
    )
    expect(output).toContain('+$4.52')
    expect(output).toContain('+$1.25')
    expect(output).toContain('-$0.15')
    expect(output).toContain('+$0.08')
    expect(output).toContain('+fees $0.08')
  })

  it.each([undefined, null, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'does not display unobserved or nonfinite USD and percentages as measured values (%s)',
    (value) => {
      const state = {
        ...baseState,
        totalRealizedPnlUsd: value,
        sessionPnlUsd: value,
        totalPnlUsd: 0,
        totalPnlUsdKnown: false,
        unclaimedFeesUsd: value,
        positions: [
          {
            positionAddress: 'unobserved',
            poolAddress: 'pool',
            tokenSymbol: 'UNOBSERVED',
            pnlUsd: value,
            pnlPct: value,
            valueUsd: value,
            unclaimedFeesUsd: value,
          },
        ],
      } as unknown as IpcStateSnapshot
      const output = renderToString(
        <StatusPane connected={true} connecting={false} reconnectAttempts={0} state={state} />,
        { columns: 240 },
      )
      expect(output).toContain('Total PnL: Not reported')
      expect(output).toContain('Session: Not reported')
      expect(output).toContain('Open PnL: Not reported')
      expect(output).toContain('UNOBSERVED [Not reported] (Not reported / Not reported)')
      expect(output).not.toContain('$0.00')
      expect(output).not.toContain('0%')
      expect(output).not.toContain('NaN')
      expect(output).not.toContain('Infinity')
    },
  )

  it.each([0, 99])('respects unknown aggregate provenance even when its wire placeholder is %s', (totalPnlUsd) => {
    const output = renderToString(
      <StatusPane
        connected={true}
        connecting={false}
        reconnectAttempts={0}
        state={{
          ...baseState,
          totalPnlUsd,
          totalPnlUsdKnown: false,
          positions: [{ positionAddress: 'unobserved', poolAddress: 'pool' }],
        }}
      />,
      { columns: 240 },
    )
    expect(output).toContain('Open PnL: Not reported')
    expect(output).not.toContain(`+$${totalPnlUsd.toFixed(2)}`)
  })

  it('preserves measured zero USD, percentages and position value', () => {
    const state: IpcStateSnapshot = {
      ...baseState,
      totalRealizedPnlUsd: 0,
      sessionPnlUsd: 0,
      totalPnlUsd: 0,
      totalPnlUsdKnown: true,
      positions: [
        { positionAddress: 'zero', poolAddress: 'pool', tokenSymbol: 'ZERO', pnlUsd: 0, pnlPct: 0, valueUsd: 0 },
      ],
    }
    const output = renderToString(
      <StatusPane connected={true} connecting={false} reconnectAttempts={0} state={state} />,
      { columns: 240 },
    )
    expect(output).toContain('Total PnL: +$0.00')
    expect(output).toContain('Session: +$0.00')
    expect(output).toContain('Open PnL: +$0.00')
    expect(output).toContain('ZERO [$0.00] (+$0.00 / 0%)')
    expect(output).not.toContain('Not reported')
  })
})
