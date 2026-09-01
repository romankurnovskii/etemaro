import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Redirect dataPath() to a temp directory for isolated test environment
vi.mock('../shared/constants.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared/constants.js')>()
  const nodeFs = await import('node:fs')
  const nodeOs = await import('node:os')
  const nodePath = await import('node:path')
  const dir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'lessons-test-'))
  return {
    ...actual,
    dataPath: (...segments: string[]) => nodePath.join(dir, ...segments),
    __testDataDir: dir,
  }
})

import { getPerformanceHistory, getPerformanceSummary, recordPerformance } from './lessons.js'

type MockedConstants = typeof import('../shared/constants.js') & { __testDataDir: string }
const constants = (await import('../shared/constants.js')) as MockedConstants
const tmpDir = constants.__testDataDir
const lessonsFile = path.join(tmpDir, 'lessons.json')

describe('lessons domain — Price PnL vs Net PnL disambiguation', () => {
  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true })
    fs.writeFileSync(lessonsFile, JSON.stringify({ lessons: [], performance: [] }))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('correctly calculates price_pnl_usd, price_pnl_pct, net_pnl_usd when Price Loss is offset by Fee Yield', async () => {
    // Initial value: $100
    // Final value: $90 (price dropped by $10)
    // Fees earned: $15 (yield)
    // Price PnL: -$10 (-10%)
    // Net PnL: -$10 + $15 = +$5 (+5%)
    await recordPerformance({
      position: 'pos123',
      pool: 'pool456',
      pool_name: 'TEST-SOL',
      strategy: 'classic',
      bin_range: 20,
      bin_step: 10,
      volatility: 0.2,
      fee_tvl_ratio: 0.05,
      organic_score: 85,
      amount_sol: 1.0,
      initial_value_usd: 100,
      final_value_usd: 90,
      fees_earned_usd: 15,
      minutes_in_range: 60,
      minutes_held: 60,
      close_reason: 'manual close',
    })

    const fileContent = JSON.parse(fs.readFileSync(lessonsFile, 'utf-8'))
    expect(fileContent.performance).toHaveLength(1)

    const record = fileContent.performance[0]
    expect(record.price_pnl_usd).toBe(-10)
    expect(record.price_pnl_pct).toBe(-10)
    expect(record.net_pnl_usd).toBe(5)
    expect(record.pnl_usd).toBe(5) // Backward-compatible net return
    expect(record.pnl_pct).toBe(5)
    expect(record.fees_earned_usd).toBe(15)
  })

  it('aggregates summary metrics including price_pnl_usd and total_fees_earned_usd in getPerformanceSummary', async () => {
    await recordPerformance({
      position: 'pos1',
      pool: 'pool1',
      pool_name: 'FOO-SOL',
      strategy: 'classic',
      bin_range: 20,
      bin_step: 10,
      volatility: 0.1,
      fee_tvl_ratio: 0.05,
      organic_score: 80,
      amount_sol: 1.0,
      initial_value_usd: 200,
      final_value_usd: 180, // Price PnL = -$20 (-10%)
      fees_earned_usd: 30, // Net PnL = +$10
      minutes_in_range: 30,
      minutes_held: 30,
      close_reason: 'take profit',
    })

    const summary = getPerformanceSummary()
    expect(summary).not.toBeNull()
    expect(summary?.total_positions_closed).toBe(1)
    expect(summary?.total_pnl_usd).toBe(10)
    expect(summary?.total_price_pnl_usd).toBe(-20)
    expect(summary?.total_fees_earned_usd).toBe(30)
    expect(summary?.avg_pnl_pct).toBe(5)
    expect(summary?.avg_price_pnl_pct).toBe(-10)
  })

  it('returns price_pnl_usd and net_pnl_usd in getPerformanceHistory', async () => {
    await recordPerformance({
      position: 'pos1',
      pool: 'pool1',
      pool_name: 'BAR-SOL',
      strategy: 'classic',
      bin_range: 20,
      bin_step: 10,
      volatility: 0.1,
      fee_tvl_ratio: 0.05,
      organic_score: 80,
      amount_sol: 1.0,
      initial_value_usd: 50,
      final_value_usd: 60, // Price PnL = +$10
      fees_earned_usd: 5, // Net PnL = +$15
      minutes_in_range: 30,
      minutes_held: 30,
      close_reason: 'manual',
    })

    const history = getPerformanceHistory({ hours: 24, limit: 10 })
    expect(history.count).toBe(1)
    expect(history.total_pnl_usd).toBe(15)
    expect(history.total_price_pnl_usd).toBe(10)
    expect(history.total_fees_earned_usd).toBe(5)

    const pos = (history.positions as Record<string, unknown>[])[0]!
    expect(pos.price_pnl_usd).toBe(10)
    expect(pos.net_pnl_usd).toBe(15)
    expect(pos.pnl_usd).toBe(15)
  })
})
