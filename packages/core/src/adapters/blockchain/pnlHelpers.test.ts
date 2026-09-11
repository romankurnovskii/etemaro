import { describe, expect, it } from 'vitest'
import { isSolMint, resolveCloseAccounting, resolveNonSolMint } from './pnlHelpers.js'

const WSOL = 'So11111111111111111111111111111111111111112'
const NATIVE_SOL = 'So11111111111111111111111111111111111111111'
const MEME = '8iYPW781jBDu8zkC6PFY8WpvtbHxSVMgBX8aPnNmRY3z'

describe('resolveNonSolMint', () => {
  it('identifies the meme mint on either side of the pool', () => {
    expect(resolveNonSolMint({ tokenXMint: WSOL, tokenYMint: MEME })).toBe(MEME)
    expect(resolveNonSolMint({ tokenXMint: MEME, tokenYMint: WSOL })).toBe(MEME)
  })

  it('prefers the tracked base mint', () => {
    expect(resolveNonSolMint({ trackedBaseMint: MEME, tokenXMint: WSOL, tokenYMint: 'other' })).toBe(MEME)
  })

  it('recognises native and wrapped SOL', () => {
    expect(isSolMint(WSOL)).toBe(true)
    expect(isSolMint(NATIVE_SOL)).toBe(true)
    expect(isSolMint(MEME)).toBe(false)
  })
})

describe('resolveCloseAccounting', () => {
  it('marks a 100%-SOL close as realized with full cash (no phantom pending swap)', () => {
    const a = resolveCloseAccounting({ finalValueUsd: 10.16, unsoldTokensAmount: 0, unsoldTokensUsd: 0 })
    expect(a.status).toBe('realized')
    expect(a.cashRealizedUsd).toBe(10.16)
    expect(a.unrealizedResidualUsd).toBe(0)
    expect(a.hasUnsoldInventory).toBe(false)
  })

  it('treats sub-dust balances as realized', () => {
    const a = resolveCloseAccounting({
      finalValueUsd: 10.16,
      unsoldTokensAmount: 1000,
      unsoldTokensUsd: 0.01,
      sweeperMinUsd: 0.02,
    })
    expect(a.status).toBe('realized')
    expect(a.cashRealizedUsd).toBe(10.16)
  })

  it('splits cash and residual when real inventory remains', () => {
    const a = resolveCloseAccounting({
      finalValueUsd: 10.16,
      unsoldTokensAmount: 100_000,
      unsoldTokensUsd: 6,
      sweeperMinUsd: 0.02,
    })
    expect(a.status).toBe('closed_pending_swap')
    expect(a.cashRealizedUsd).toBeCloseTo(4.16, 2)
    expect(a.unrealizedResidualUsd).toBeCloseTo(6, 2)
    expect(a.unrealizedTokensAmount).toBe(100_000)
  })

  it('never books more residual than the withdrawn total', () => {
    const a = resolveCloseAccounting({ finalValueUsd: 5, unsoldTokensAmount: 1000, unsoldTokensUsd: 9 })
    expect(a.unrealizedResidualUsd).toBe(5)
    expect(a.cashRealizedUsd).toBe(0)
  })
})
