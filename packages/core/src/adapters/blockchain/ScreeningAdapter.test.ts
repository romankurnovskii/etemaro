import { describe, expect, it } from 'vitest'
import { candidateScanTotals, windowedFeeTvlRejectReason } from './ScreeningAdapter.js'

describe('candidateScanTotals', () => {
  it('counts filtered discovery pools as scanned even when none are shortlisted', () => {
    expect(candidateScanTotals({ pools: [], filtered_examples: [{}, {}, {}, {}, {}] }, 0)).toEqual({
      total_screened: 5,
      total_eligible: 0,
    })
  })

  it('adds surviving discovery pools to filtered examples (issue #168: 6 scanned / 1 shortlisted)', () => {
    expect(candidateScanTotals({ pools: [{}], filtered_examples: [{}, {}, {}, {}, {}] }, 1)).toEqual({
      total_screened: 6,
      total_eligible: 1,
    })
  })
})

describe('windowedFeeTvlRejectReason', () => {
  it('labels the screening-time metric as windowed fee/TVL with the timeframe', () => {
    expect(windowedFeeTvlRejectReason(0.0129, 0.05, '24h')).toBe('windowed fee/TVL (24h) 0.0129 < min 0.05')
  })

  it('uses unknown when the ratio is missing', () => {
    expect(windowedFeeTvlRejectReason(Number.NaN, 0.05, '5m')).toBe('windowed fee/TVL (5m) unknown < min 0.05')
  })
})
