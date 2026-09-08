import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  enqueuePendingLiquidation,
  getPendingLiquidation,
  getPendingLiquidations,
  markLiquidationAttempt,
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
})
