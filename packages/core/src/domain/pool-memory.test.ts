import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  __setPoolMemoryFilePath,
  getPoolMemory,
  isBaseMintOnCooldown,
  isPoolOnCooldown,
  recallForPool,
  recordPoolDeploy,
  recordPositionSnapshot,
} from '../domain/pool-memory.js'

const TMP_POOL_MEMORY = path.join(os.tmpdir(), `etemaro-pool-memory-test-${process.pid}.json`)

describe('pool-memory — stop-loss cooldown', () => {
  beforeEach(() => {
    if (fs.existsSync(TMP_POOL_MEMORY)) fs.unlinkSync(TMP_POOL_MEMORY)
    __setPoolMemoryFilePath(TMP_POOL_MEMORY)
  })

  afterAll(() => {
    __setPoolMemoryFilePath(null)
    if (fs.existsSync(TMP_POOL_MEMORY)) fs.unlinkSync(TMP_POOL_MEMORY)
  })

  it('backs up corrupt pool-memory state instead of silently resetting it', () => {
    fs.writeFileSync(TMP_POOL_MEMORY, '{ corrupt pool memory')
    expect(recallForPool('PoolCorrupt')).toBeNull()
    expect(fs.existsSync(TMP_POOL_MEMORY)).toBe(false)
    const backups = fs
      .readdirSync(path.dirname(TMP_POOL_MEMORY))
      .filter((f) => f.startsWith(`${path.basename(TMP_POOL_MEMORY)}.corrupt-`))
    expect(backups.length).toBeGreaterThanOrEqual(1)
  })

  it('stores the deploy time (not the close time) in last_deployed_at', () => {
    recordPoolDeploy('PoolD', {
      pool_name: 'D/SOL',
      base_mint: 'DMint',
      pnl_pct: 1,
      deployed_at: '2026-10-01T00:00:00.000Z',
      closed_at: '2026-10-02T00:00:00.000Z',
      close_reason: 'agent decision',
    })

    const memory = getPoolMemory({ pool_address: 'PoolD' }) as any
    expect(memory.last_deployed_at).toBe('2026-10-01T00:00:00.000Z')
  })

  it('excludes unknown in_range snapshots from the OOR share', () => {
    recordPositionSnapshot('PoolOOR', { position: 'p1', pnl_pct: 1, in_range: true })
    recordPositionSnapshot('PoolOOR', { position: 'p1', pnl_pct: 2, in_range: false })
    recordPositionSnapshot('PoolOOR', { position: 'p1', pnl_pct: 3, in_range: null })

    const recall = recallForPool('PoolOOR')
    expect(recall).toContain('OOR in 1/2 known cycles')
    expect(recall).toContain('(1 unknown)')
  })

  it('skips all-nullish deploy-marker snapshots', () => {
    recordPositionSnapshot('PoolNull', { position: 'p1', pair: 'NULL/SOL' })
    recordPositionSnapshot('PoolNull2', { position: 'p1', pnl_pct: 1, in_range: true })
    recordPositionSnapshot('PoolNull2', { position: 'p1', pnl_pct: 2, in_range: true })

    expect(recallForPool('PoolNull')).toBeNull()
    expect(recallForPool('PoolNull2')).toContain('RECENT TREND')
  })

  it('computes PnL drift from non-null endpoints (R1)', () => {
    recordPositionSnapshot('PoolR1', { position: 'p1', pnl_pct: null, in_range: true })
    recordPositionSnapshot('PoolR1', { position: 'p1', pnl_pct: 2, in_range: true })
    recordPositionSnapshot('PoolR1', { position: 'p1', pnl_pct: 5, in_range: true })

    expect(recallForPool('PoolR1')).toContain('PnL drift +3.00%')
  })

  it('scopes the recent trend to the most recent position (R2)', () => {
    recordPositionSnapshot('PoolR2', { position: 'p-old', pnl_pct: 100, in_range: true })
    recordPositionSnapshot('PoolR2', { position: 'p-old', pnl_pct: 200, in_range: true })
    recordPositionSnapshot('PoolR2', { position: 'p-new', pnl_pct: 1, in_range: true })
    recordPositionSnapshot('PoolR2', { position: 'p-new', pnl_pct: 3, in_range: true })

    const recall = recallForPool('PoolR2')
    expect(recall).toContain('PnL drift +2.00%')
    expect(recall).toContain('over last 2 cycles')
  })

  it('cools the pool and base mint after repeated fee-generating deploys (S5)', () => {
    for (let i = 0; i < 3; i++) {
      recordPoolDeploy('PoolRepeat', {
        pool_name: 'REPEAT/SOL',
        base_mint: 'RepeatMint',
        pnl_pct: 1,
        fees_earned_usd: 1,
        fee_earned_pct: 1,
        close_reason: 'take profit',
      })
    }

    expect(isPoolOnCooldown('PoolRepeat')).toBe(true)
    expect(isBaseMintOnCooldown('RepeatMint')).toBe(true)
  })

  it('derives deployed_at from closed_at and minutes_held when absent (R4)', () => {
    recordPoolDeploy('PoolR4', {
      pool_name: 'R4/SOL',
      base_mint: 'R4Mint',
      pnl_pct: 1,
      closed_at: '2026-10-02T00:30:00.000Z',
      minutes_held: 10,
      close_reason: 'agent decision',
    })

    const memory = getPoolMemory({ pool_address: 'PoolR4' }) as any
    expect(memory.history[0].deployed_at).toBe('2026-10-02T00:20:00.000Z')
  })

  it('sets pool + base-mint cooldown on stop-loss close', () => {
    recordPoolDeploy('PoolA', {
      pool_name: 'GOBLIN-SOL',
      base_mint: 'TokenMintXYZ',
      pnl_pct: -6.35,
      close_reason: 'stop loss',
    })

    expect(isPoolOnCooldown('PoolA')).toBe(true)
    expect(isBaseMintOnCooldown('TokenMintXYZ')).toBe(true)
  })

  it('does not set stop-loss cooldown on non-stop-loss negative close', () => {
    recordPoolDeploy('PoolB', {
      pool_name: 'OTHER/SOL',
      base_mint: 'OtherMintABC',
      pnl_pct: -3.2,
      close_reason: 'agent decision',
    })

    expect(isPoolOnCooldown('PoolB')).toBe(false)
    expect(isBaseMintOnCooldown('OtherMintABC')).toBe(false)
  })

  it('still sets low-yield cooldown as before', () => {
    recordPoolDeploy('PoolC', {
      pool_name: 'LOWYIELD/SOL',
      base_mint: 'LowYieldMint',
      pnl_pct: 1.2,
      close_reason: 'low yield (fee/tvl_24h=2.95% threshold=7%)',
    })

    expect(isPoolOnCooldown('PoolC')).toBe(true)
  })

  it('reports win rate as percent (1 win + 1 loss = 50%) in recall and getPoolMemory', () => {
    recordPoolDeploy('PoolW', { pool_name: 'W/SOL', base_mint: 'WMint', pnl_pct: 5, close_reason: 'agent decision' })
    recordPoolDeploy('PoolW', { pool_name: 'W/SOL', base_mint: 'WMint', pnl_pct: -5, close_reason: 'agent decision' })

    expect(recallForPool('PoolW')).toContain('win rate 50%')
    expect((getPoolMemory({ pool_address: 'PoolW' }) as any).win_rate_pct).toBe(50)
  })
})
