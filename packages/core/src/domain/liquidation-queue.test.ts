import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  enqueuePendingLiquidation,
  getPendingLiquidation,
  getPendingLiquidations,
  markLiquidationAttempt,
  markLiquidationDust,
  markLiquidationSuccess,
  pruneSettledLiquidations,
} from './liquidation-queue.js'
import { __setStateFilePath } from './state.js'

const TMP_STATE = path.join(os.tmpdir(), `etemaro-liquidation-test-${process.pid}.json`)

describe('Liquidation Queue Domain', () => {
  beforeAll(() => {
    __setStateFilePath(TMP_STATE)
  })

  afterAll(() => {
    if (fs.existsSync(TMP_STATE)) fs.unlinkSync(TMP_STATE)
  })

  beforeEach(() => {
    if (fs.existsSync(TMP_STATE)) fs.unlinkSync(TMP_STATE)
  })

  it('enqueues a new stranded token and retrieves it', async () => {
    const item = await enqueuePendingLiquidation({
      mint: 'MintA11111111111111111111111111111111111111',
      symbol: 'AKIRA',
      amount: 349517,
      usd: 12.5,
      pool_address: 'PoolXYZ111111111111111111111111111111111111',
      error: 'Jupiter 400: Failed to get quotes',
    })

    expect(item.mint).toBe('MintA11111111111111111111111111111111111111')
    expect(item.symbol).toBe('AKIRA')
    expect(item.amount).toBe(349517)
    expect(item.usd).toBe(12.5)
    expect(item.pool_address).toBe('PoolXYZ111111111111111111111111111111111111')
    expect(item.status).toBe('pending')
    expect(item.attempts).toBe(0)
    expect(item.last_error).toBe('Jupiter 400: Failed to get quotes')

    const fetched = getPendingLiquidation('MintA11111111111111111111111111111111111111')
    expect(fetched).not.toBeNull()
    expect(fetched?.symbol).toBe('AKIRA')

    const all = getPendingLiquidations('pending')
    expect(all.length).toBe(1)
  })

  it('does not overwrite a known usd with null on a failed re-enqueue', async () => {
    await enqueuePendingLiquidation({ mint: 'MintKeep', symbol: 'KEEP', amount: 100, usd: 12.5 })

    await enqueuePendingLiquidation({ mint: 'MintKeep', amount: 100, usd: null, error: 'swap failed' })
    expect(getPendingLiquidation('MintKeep')?.usd).toBe(12.5)

    // A real value (including 0) still overwrites.
    await enqueuePendingLiquidation({ mint: 'MintKeep', amount: 100, usd: 0 })
    expect(getPendingLiquidation('MintKeep')?.usd).toBe(0)
  })

  it('marks a dust-skipped entry with a terminal dust status', async () => {
    await enqueuePendingLiquidation({ mint: 'MintDust', symbol: 'DUST', amount: 1, usd: 0.001 })
    expect(getPendingLiquidation('MintDust')?.status).toBe('pending')

    const ok = await markLiquidationDust('MintDust', { reason: 'skipped dust (< $0.02)' })
    expect(ok).toBe(true)

    const item = getPendingLiquidation('MintDust')
    expect(item?.status).toBe('dust')
    expect(item?.last_error).toContain('dust')
  })

  it('re-enqueuing an existing token updates details and resets status to pending', async () => {
    await enqueuePendingLiquidation({
      mint: 'MintB',
      symbol: 'TOKENB',
      amount: 100,
      usd: 1.0,
      error: 'Initial timeout',
    })

    await markLiquidationSuccess('MintB', { tx: 'tx-old' })
    let item = getPendingLiquidation('MintB')
    expect(item?.status).toBe('liquidated')

    // New residual unswapped tokens discovered
    await enqueuePendingLiquidation({
      mint: 'MintB',
      amount: 50,
      usd: 0.5,
      error: 'Second close left dust',
    })

    item = getPendingLiquidation('MintB')
    expect(item?.status).toBe('pending')
    expect(item?.amount).toBe(50)
    expect(item?.last_error).toBe('Second close left dust')
  })

  it('records liquidation attempts and abandons after max attempts', async () => {
    await enqueuePendingLiquidation({
      mint: 'MintC',
      symbol: 'RUGGED',
      amount: 5000,
      usd: 0.25,
    })

    // 1st attempt
    let res = await markLiquidationAttempt('MintC', {
      error: 'No route found',
      maxAttempts: 3,
    })
    expect(res.status).toBe('pending')
    expect(res.attempts).toBe(1)

    // 2nd attempt
    res = await markLiquidationAttempt('MintC', {
      error: 'No route found',
      maxAttempts: 3,
    })
    expect(res.status).toBe('pending')
    expect(res.attempts).toBe(2)

    // 3rd attempt -> threshold reached
    res = await markLiquidationAttempt('MintC', {
      error: 'Zero pool liquidity',
      maxAttempts: 3,
    })
    expect(res.status).toBe('abandoned')
    expect(res.attempts).toBe(3)

    const item = getPendingLiquidation('MintC')
    expect(item?.status).toBe('abandoned')
    expect(item?.last_error).toBe('Zero pool liquidity')
  })

  it('persists settlement details and the swapped reason on success', async () => {
    await enqueuePendingLiquidation({ mint: 'MintSettle', symbol: 'SET', amount: 10, usd: 5 })
    await markLiquidationSuccess('MintSettle', { tx: 'tx-settle-1', amountOutSol: 0.25, reason: 'swapped' })

    const item = getPendingLiquidation('MintSettle')
    expect(item?.liquidated_at).toBeTruthy()
    expect(item?.tx).toBe('tx-settle-1')
    expect(item?.amount_out_sol).toBe(0.25)
    expect(item?.reason).toBe('swapped')
  })

  it('records wallet_empty as the reason when the token is already gone', async () => {
    await enqueuePendingLiquidation({ mint: 'MintGone', symbol: 'GONE', amount: 1, usd: 1 })
    await markLiquidationSuccess('MintGone', { reason: 'wallet_empty' })
    expect(getPendingLiquidation('MintGone')?.reason).toBe('wallet_empty')
  })

  it('marks liquidation as successful', async () => {
    await enqueuePendingLiquidation({
      mint: 'MintD',
      symbol: 'SUCCESS',
      amount: 1000,
      usd: 5.0,
    })

    const ok = await markLiquidationSuccess('MintD', { tx: 'tx_success_123', amountOutSol: 0.035 })
    expect(ok).toBe(true)

    const item = getPendingLiquidation('MintD')
    expect(item?.status).toBe('liquidated')
    expect(item?.last_error).toBeNull()

    const pendingOnly = getPendingLiquidations('pending')
    expect(pendingOnly.find((i) => i.mint === 'MintD')).toBeUndefined()

    const liquidatedOnly = getPendingLiquidations('liquidated')
    expect(liquidatedOnly.find((i) => i.mint === 'MintD')).toBeDefined()
  })

  it('prunes old settled liquidations', async () => {
    await enqueuePendingLiquidation({
      mint: 'MintE',
      symbol: 'OLD',
      amount: 10,
    })
    await markLiquidationSuccess('MintE')

    // Prune entries older than 0 hours (all settled items)
    const pruned = await pruneSettledLiquidations(0)
    expect(pruned).toBe(1)

    expect(getPendingLiquidation('MintE')).toBeNull()
  })

  it('preserves abandoned tombstones for mints still held in the wallet', async () => {
    await enqueuePendingLiquidation({ mint: 'MintH', symbol: 'HELD', amount: 1, usd: 1, status: 'abandoned' })
    await enqueuePendingLiquidation({ mint: 'MintI', symbol: 'GONE', amount: 1, usd: 1, status: 'abandoned' })

    const pruned = await pruneSettledLiquidations(0, { preserveAbandonedMints: new Set(['MintH']) })

    expect(pruned).toBe(1)
    expect(getPendingLiquidation('MintH')?.status).toBe('abandoned')
    expect(getPendingLiquidation('MintI')).toBeNull()
  })

  it('persists last_error_code and custom status in enqueuePendingLiquidation', async () => {
    const item = await enqueuePendingLiquidation({
      mint: 'MintF',
      symbol: 'DEAD',
      amount: 50,
      usd: 0.1,
      errorCode: 'TOKEN_NOT_TRADABLE',
      status: 'abandoned',
    })

    expect(item.status).toBe('abandoned')
    expect(item.last_error_code).toBe('TOKEN_NOT_TRADABLE')

    const fetched = getPendingLiquidation('MintF')
    expect(fetched?.status).toBe('abandoned')
    expect(fetched?.last_error_code).toBe('TOKEN_NOT_TRADABLE')
  })

  it('immediately abandons token when abandonImmediately is passed to markLiquidationAttempt', async () => {
    await enqueuePendingLiquidation({
      mint: 'MintG',
      symbol: 'RUG',
      amount: 100,
      usd: 1.0,
    })

    const outcome = await markLiquidationAttempt('MintG', {
      error: 'Unroutable token',
      errorCode: 'NO_ROUTES_FOUND',
      abandonImmediately: true,
      maxAttempts: 10,
    })

    expect(outcome.status).toBe('abandoned')
    expect(outcome.attempts).toBe(1)

    const item = getPendingLiquidation('MintG')
    expect(item?.status).toBe('abandoned')
    expect(item?.last_error_code).toBe('NO_ROUTES_FOUND')
    expect(item?.last_error).toBe('Unroutable token')
  })
})
