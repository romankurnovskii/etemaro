import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Redirect dataPath() to a temp directory for isolated test environment
vi.mock('../shared/constants.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared/constants.js')>()
  const nodeFs = await import('node:fs')
  const nodeOs = await import('node:os')
  const nodePath = await import('node:path')
  const dir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'lessons-pnl-test-'))
  return {
    ...actual,
    dataPath: (...segments: string[]) => nodePath.join(dir, ...segments),
    __testDataDir: dir,
  }
})

import {
  abandonTradeLiquidation,
  getPerformanceSummary,
  recordPerformance,
  settleTradeLiquidation,
  updatePendingTradesMarkToMarket,
} from './lessons.js'

type MockedConstants = typeof import('../shared/constants.js') & { __testDataDir: string }
const constants = (await import('../shared/constants.js')) as MockedConstants
const tmpDir = constants.__testDataDir
const lessonsFile = path.join(tmpDir, 'lessons.json')

describe('TASK-03: Realistic PnL Accounting & Mark-to-Market', () => {
  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true })
    fs.writeFileSync(lessonsFile, JSON.stringify({ lessons: [], performance: [] }))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('AC1: Position closed with unsold tokens is marked closed_pending_swap and excluded from winning trade counts', async () => {
    // Initial deposit: 1 SOL ($150)
    // LP closed: 0.2 SOL cash withdrawn ($30) + 1,000,000 AKIRA tokens with theoretical instant value $130
    // Theoretical total = $160 (+$10 / +6.67% paper win)
    await recordPerformance({
      position: 'pos-akira-1',
      pool: 'pool-akira',
      pool_name: 'AKIRA-SOL',
      base_mint: 'mint-akira',
      strategy: 'spot',
      bin_range: 20,
      bin_step: 10,
      volatility: 0.5,
      fee_tvl_ratio: 0.1,
      organic_score: 50,
      amount_sol: 1.0,
      initial_value_usd: 150,
      final_value_usd: 160, // Theoretical instant withdrawal
      fees_earned_usd: 0,
      minutes_in_range: 60,
      minutes_held: 60,
      close_reason: 'take profit (theoretical)',
      status: 'closed_pending_swap',
      cash_realized_sol: 0.2,
      cash_realized_usd: 30,
      unrealized_residual_usd: 130,
      unrealized_tokens_amount: 1_000_000,
      liquidation_mint: 'mint-akira',
    })

    const data = JSON.parse(fs.readFileSync(lessonsFile, 'utf-8'))
    expect(data.performance).toHaveLength(1)
    const rec = data.performance[0]
    expect(rec.status).toBe('closed_pending_swap')
    expect(rec.cash_realized_sol).toBe(0.2)
    expect(rec.cash_realized_usd).toBe(30)
    expect(rec.unrealized_residual_usd).toBe(130)

    // Critical: NO positive ("WORKED" / "PREFER") lesson should be derived for pending unliquidated trades
    expect(data.lessons).toHaveLength(0)

    // Summary metrics:
    const summary = getPerformanceSummary() as any
    expect(summary).not.toBeNull()
    expect(summary.total_positions_closed).toBe(1)
    expect(summary.pending_swaps_count).toBe(1)
    // Realized win rate must be 0 because 0 trades are fully realized as wins
    expect(summary.win_rate_pct).toBe(0)
    expect(summary.unrealized_residual_usd).toBe(130)
    // Cash realized PnL = $30 (cash) - $150 (initial) = -$120
    expect(summary.cash_realized_pnl_usd).toBe(-120)
  })

  it('AC2: Realized PnL is booked only upon conversion to SOL, tracking actual cash returned to wallet', async () => {
    // Record pending trade
    await recordPerformance({
      position: 'pos-token-2',
      pool: 'pool-token',
      pool_name: 'TOKEN-SOL',
      base_mint: 'mint-token-2',
      strategy: 'spot',
      bin_range: 20,
      bin_step: 10,
      volatility: 0.2,
      fee_tvl_ratio: 0.1,
      organic_score: 80,
      amount_sol: 1.0,
      initial_value_usd: 150,
      final_value_usd: 160,
      fees_earned_usd: 0,
      minutes_in_range: 60,
      minutes_held: 60,
      close_reason: 'take profit',
      status: 'closed_pending_swap',
      cash_realized_sol: 0.2,
      cash_realized_usd: 30,
      unrealized_residual_usd: 130,
      unrealized_tokens_amount: 500_000,
      liquidation_mint: 'mint-token-2',
    })

    // Now liquidation succeeds: 500,000 tokens swapped for 0.88 SOL at SOL price $150 = $132 USD
    const settled = await settleTradeLiquidation('mint-token-2', {
      amountOutSol: 0.88,
      solPrice: 150,
      tx: 'tx-swap-success-1',
      position: 'pos-token-2',
    })
    expect(settled).toBe(true)

    const data = JSON.parse(fs.readFileSync(lessonsFile, 'utf-8'))
    const rec = data.performance[0]
    expect(rec.status).toBe('realized')
    // Total cash realized SOL = 0.2 (from close) + 0.88 (from swap) = 1.08 SOL
    expect(rec.cash_realized_sol).toBeCloseTo(1.08, 4)
    // Total cash realized USD = 1.08 * 150 = $162
    expect(rec.cash_realized_usd).toBeCloseTo(162, 2)
    expect(rec.unrealized_residual_usd).toBe(0)
    expect(rec.final_value_usd).toBeCloseTo(162, 2)
    // Net PnL = $162 - $150 = +$12 (+8%)
    expect(rec.net_pnl_usd).toBeCloseTo(12, 2)
    expect(rec.pnl_usd).toBeCloseTo(12, 2)
    expect(rec.pnl_pct).toBeCloseTo(8, 2)
    expect(rec.liquidation_tx).toBe('tx-swap-success-1')

    // Lesson should now be derived as a confirmed WORKED trade!
    expect(data.lessons.length).toBeGreaterThanOrEqual(1)
    expect(data.lessons[0].outcome).toBe('good')

    // Summary now counts 100% win rate
    const summary = getPerformanceSummary() as any
    expect(summary.win_rate_pct).toBe(100)
    expect(summary.pending_swaps_count).toBe(0)
    expect(summary.cash_realized_pnl_usd).toBeCloseTo(12, 2)
  })

  it('AC3: Abandoned/unsellable inventory is formally recognized as abandoned_loss, converting paper wins into capital losses', async () => {
    // Record pending trade that appeared profitable on paper
    await recordPerformance({
      position: 'pos-rug-3',
      pool: 'pool-rug',
      pool_name: 'RUG-SOL',
      base_mint: 'mint-rug-3',
      strategy: 'bid_ask',
      bin_range: 20,
      bin_step: 10,
      volatility: 0.8,
      fee_tvl_ratio: 0.1,
      organic_score: 30,
      amount_sol: 1.0,
      initial_value_usd: 150,
      final_value_usd: 170, // Paper value was +$20
      fees_earned_usd: 5,
      minutes_in_range: 10,
      minutes_held: 20,
      close_reason: 'stop loss',
      status: 'closed_pending_swap',
      cash_realized_sol: 0.1, // Only 0.1 SOL recovered
      cash_realized_usd: 15,
      unrealized_residual_usd: 155,
      unrealized_tokens_amount: 10_000_000,
      liquidation_mint: 'mint-rug-3',
    })

    // Token dump / zero liquidity -> sweeper abandons token
    const abandoned = await abandonTradeLiquidation('mint-rug-3', {
      reason: 'No route found / zero liquidity after 10 attempts',
      position: 'pos-rug-3',
    })
    expect(abandoned).toBe(true)

    const data = JSON.parse(fs.readFileSync(lessonsFile, 'utf-8'))
    const rec = data.performance[0]
    expect(rec.status).toBe('abandoned_loss')
    expect(rec.unrealized_residual_usd).toBe(0)
    // Final value is only the actual cash recovered: $15
    expect(rec.final_value_usd).toBe(15)
    // Net PnL = $15 (final) - $150 (initial) + $5 (fees) = -$130 (-86.67%)
    expect(rec.net_pnl_usd).toBe(-130)
    expect(rec.pnl_usd).toBe(-130)
    expect(rec.pnl_pct).toBeCloseTo(-86.67, 1)

    // Lesson must be derived as EXECUTION FAILURE / CAPITAL LOSS
    expect(data.lessons.length).toBeGreaterThanOrEqual(1)
    const failureLesson = data.lessons.find(
      (l: any) => l.rule.includes('EXECUTION FAILURE') || l.tags.includes('capital_loss'),
    )
    expect(failureLesson).toBeDefined()
    expect(failureLesson.outcome).toBe('bad')

    // Summary must count this as a loss
    const summary = getPerformanceSummary() as any
    expect(summary.win_rate_pct).toBe(0)
    expect(summary.total_pnl_usd).toBe(-130)
  })

  it('AC4: Mark-to-market updates residual valuation of unliquidated inventory', async () => {
    await recordPerformance({
      position: 'pos-mark-4',
      pool: 'pool-mark',
      pool_name: 'MEME-SOL',
      base_mint: 'mint-meme-4',
      strategy: 'spot',
      bin_range: 20,
      bin_step: 10,
      volatility: 0.4,
      fee_tvl_ratio: 0.1,
      organic_score: 60,
      amount_sol: 1.0,
      initial_value_usd: 100,
      final_value_usd: 110,
      fees_earned_usd: 0,
      minutes_in_range: 30,
      minutes_held: 30,
      close_reason: 'take profit',
      status: 'closed_pending_swap',
      cash_realized_sol: 0.1,
      cash_realized_usd: 15,
      unrealized_residual_usd: 95,
      unrealized_tokens_amount: 1000, // $0.095 per token originally
      liquidation_mint: 'mint-meme-4',
    })

    // Token drops 50% to $0.0475
    const updatedCount = updatePendingTradesMarkToMarket({
      'mint-meme-4': 0.0475,
    })
    expect(updatedCount).toBe(1)

    const data = JSON.parse(fs.readFileSync(lessonsFile, 'utf-8'))
    const rec = data.performance[0]
    expect(rec.unrealized_residual_usd).toBeCloseTo(47.5, 2)
    // finalValue = $15 (cash) + $47.5 (residual) = $62.5
    expect(rec.final_value_usd).toBeCloseTo(62.5, 2)
    // Net PnL = $62.5 - $100 = -$37.5 (-37.5%)
    expect(rec.net_pnl_usd).toBeCloseTo(-37.5, 2)
    expect(rec.pnl_pct).toBeCloseTo(-37.5, 2)
  })

  it('AC5: liquidation-queue markLiquidationSuccess automatically settles trade in lessons.json', async () => {
    const { enqueuePendingLiquidation, markLiquidationSuccess } = await import('./liquidation-queue.js')

    await recordPerformance({
      position: 'pos-queue-5',
      pool: 'pool-queue',
      pool_name: 'QUEUE-SOL',
      base_mint: 'mint-queue-5',
      strategy: 'spot',
      bin_range: 20,
      bin_step: 10,
      volatility: 0.3,
      fee_tvl_ratio: 0.1,
      organic_score: 75,
      amount_sol: 1.0,
      initial_value_usd: 150,
      final_value_usd: 150,
      fees_earned_usd: 0,
      minutes_in_range: 30,
      minutes_held: 30,
      close_reason: 'take profit',
      status: 'closed_pending_swap',
      cash_realized_sol: 0.2,
      cash_realized_usd: 30,
      unrealized_residual_usd: 120,
      unrealized_tokens_amount: 1000,
      liquidation_mint: 'mint-queue-5',
    })

    await enqueuePendingLiquidation({
      mint: 'mint-queue-5',
      symbol: 'QUEUE',
      amount: 1000,
      usd: 120,
      position: 'pos-queue-5',
    })

    // Now sweeper succeeds in swapping
    await markLiquidationSuccess('mint-queue-5', {
      amountOutSol: 0.9,
      tx: 'tx-queue-success',
    })

    const data = JSON.parse(fs.readFileSync(lessonsFile, 'utf-8'))
    const rec = data.performance[0]
    expect(rec.status).toBe('realized')
    // 0.2 + 0.9 = 1.1 SOL
    expect(rec.cash_realized_sol).toBeCloseTo(1.1, 4)
    expect(rec.unrealized_residual_usd).toBe(0)
    expect(rec.liquidation_tx).toBe('tx-queue-success')
  })

  it('AC6: liquidation-queue markLiquidationAttempt abandonment automatically records abandoned_loss in lessons.json', async () => {
    const { enqueuePendingLiquidation, markLiquidationAttempt } = await import('./liquidation-queue.js')

    await recordPerformance({
      position: 'pos-queue-6',
      pool: 'pool-queue-6',
      pool_name: 'DEAD-SOL',
      base_mint: 'mint-dead-6',
      strategy: 'bid_ask',
      bin_range: 20,
      bin_step: 10,
      volatility: 0.9,
      fee_tvl_ratio: 0.1,
      organic_score: 20,
      amount_sol: 1.0,
      initial_value_usd: 150,
      final_value_usd: 160,
      fees_earned_usd: 0,
      minutes_in_range: 10,
      minutes_held: 15,
      close_reason: 'stop loss',
      status: 'closed_pending_swap',
      cash_realized_sol: 0.05,
      cash_realized_usd: 7.5,
      unrealized_residual_usd: 152.5,
      unrealized_tokens_amount: 5000,
      liquidation_mint: 'mint-dead-6',
    })

    await enqueuePendingLiquidation({
      mint: 'mint-dead-6',
      symbol: 'DEAD',
      amount: 5000,
      usd: 152.5,
      position: 'pos-queue-6',
    })

    // Attempt fails and hits maxAttempts (1)
    await markLiquidationAttempt('mint-dead-6', {
      error: 'zero liquidity pool drained',
      maxAttempts: 1,
    })

    const data = JSON.parse(fs.readFileSync(lessonsFile, 'utf-8'))
    const rec = data.performance[0]
    expect(rec.status).toBe('abandoned_loss')
    expect(rec.final_value_usd).toBe(7.5)
    // Loss = 7.5 - 150 = -$142.5
    expect(rec.net_pnl_usd).toBe(-142.5)

    // Lesson should reflect failure
    expect(data.lessons.some((l: any) => l.rule.includes('EXECUTION FAILURE') && l.outcome === 'bad')).toBe(true)
  })
})
