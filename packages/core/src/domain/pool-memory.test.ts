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
