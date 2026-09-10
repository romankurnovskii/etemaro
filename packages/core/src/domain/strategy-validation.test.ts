import { describe, expect, it } from 'vitest'
import { collectStrategyEntries, validateStrategyDocument } from './strategy-validation.js'

const canonical = {
  id: 'copy_trade_lag',
  name: 'Copy Trade Lag',
  author: 'custom',
  smartWalletListId: 'copy_trade_lag',
  lpStrategy: 'bid_ask',
  tokenCriteria: { notes: 'x' },
  entry: { condition: 'c', singleSide: 'sol', notes: 'n' },
  range: { type: 'custom', binsBelowPct: 100, notes: 'n' },
  exit: { takeProfitPct: 1, notes: 'n' },
  bestFor: 'b',
  addedAt: '2026-08-17T00:00:00.000Z',
  updatedAt: '2026-08-17T00:00:00.000Z',
}

describe('strategy-validation', () => {
  it('accepts a canonical strategy library', () => {
    const report = validateStrategyDocument({ strategies: { copy_trade_lag: canonical } })
    expect(report.ok).toBe(true)
    expect(report.entries[0]?.status).toBe('VALID')
    expect(report.totals).toEqual({ checked: 1, valid: 1, invalid: 0 })
  })

  it('accepts a single strategy object', () => {
    const report = validateStrategyDocument(canonical)
    expect(report.ok).toBe(true)
    expect(report.entries[0]?.id).toBe('copy_trade_lag')
  })

  it('reports legacy snake_case keys with their canonical replacement', () => {
    const report = validateStrategyDocument({
      strategies: {
        x: {
          id: 'x',
          name: 'X',
          lp_strategy: 'bid_ask',
          best_for: 'b',
          entry: { single_side: 'token' },
          range: { bins_below_pct: 10 },
          exit: { take_profit_pct: 1 },
        },
      },
    })
    expect(report.ok).toBe(false)
    const errors = report.entries[0]?.errors.join('\n') ?? ''
    expect(errors).toMatch(/lp_strategy.*lpStrategy/)
    expect(errors).toMatch(/best_for.*bestFor/)
    expect(errors).toMatch(/entry\.single_side.*entry\.singleSide/)
    expect(errors).toMatch(/range\.bins_below_pct.*range\.binsBelowPct/)
    expect(errors).toMatch(/exit\.take_profit_pct.*exit\.takeProfitPct/)
  })

  it('reports unknown top-level fields as unused, without invalidating by default', () => {
    const report = validateStrategyDocument({ strategies: { x: { id: 'x', name: 'X', made_up: 1 } } })
    expect(report.entries[0]?.status).toBe('VALID')
    expect(report.entries[0]?.unknownFields).toEqual(['made_up'])
    expect(report.entries[0]?.warnings[0]).toMatch(/will be ignored/)
  })

  it('promotes unknown fields to errors under strict', () => {
    const report = validateStrategyDocument({ strategies: { x: { id: 'x', name: 'X', made_up: 1 } } }, { strict: true })
    expect(report.ok).toBe(false)
    expect(report.entries[0]?.errors.join('\n')).toMatch(/strict/)
  })

  it('requires smartWalletListId for the active strategy when the config needs it', () => {
    const report = validateStrategyDocument(
      { strategies: { copy_trade_lag: { id: 'copy_trade_lag', name: 'Copy Trade Lag' } } },
      { activeStrategyId: 'copy_trade_lag', requireSmartWalletListId: true },
    )
    expect(report.ok).toBe(false)
    expect(report.entries[0]?.errors.join('\n')).toMatch(/smartWalletListId/)
  })

  it('errors when smartWalletListId is absent from the known lists', () => {
    const report = validateStrategyDocument(
      { strategies: { copy_trade_lag: canonical } },
      { knownSmartWalletListIds: ['some_other_list'] },
    )
    expect(report.ok).toBe(false)
    expect(report.entries[0]?.errors.join('\n')).toMatch(/not found in smart-wallets\.json/)
  })

  it('warns when a library key does not match strategy.id', () => {
    const report = validateStrategyDocument({ strategies: { alias: { ...canonical, id: 'copy_trade_lag' } } })
    expect(report.entries[0]?.warnings.join('\n')).toMatch(/does not match strategy\.id/)
  })

  it('reports missing required fields and wrong types', () => {
    const report = validateStrategyDocument({ strategies: { x: { name: 42, author: 'a' } } })
    expect(report.ok).toBe(false)
    const errors = report.entries[0]?.errors.join('\n') ?? ''
    expect(errors).toMatch(/required string field "id"/)
    expect(errors).toMatch(/field "name" should be string but is number/)
  })

  it('collects entries from both document shapes', () => {
    expect(collectStrategyEntries({ strategies: { a: { id: 'a' } } })[0]?.key).toBe('a')
    const single = collectStrategyEntries({ id: 'b', name: 'B' })[0]
    expect(single?.key).toBeNull()
    expect(single?.id).toBe('b')
  })
})
