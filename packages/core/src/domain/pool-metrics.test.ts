/**
 * @file pool-metrics.test.ts
 * @description Unit tests for pool metrics recording and file storage.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __setPoolMetricsDir, getPoolMetricFile, readPoolMetrics, recordPoolMetric } from './pool-metrics.js'

describe('pool-metrics domain', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'etemaro-pool-metrics-test-'))
    __setPoolMetricsDir(tempDir)
  })

  afterEach(() => {
    __setPoolMetricsDir(null)
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('backs up corrupt pool-metrics state instead of silently resetting it', () => {
    const file = getPoolMetricFile('pool_corrupt', 'pos_corrupt')
    fs.writeFileSync(file, '{ corrupt metrics')
    expect(readPoolMetrics('pool_corrupt', 'pos_corrupt')).toEqual([])
    expect(fs.existsSync(file)).toBe(false)
    const backups = fs.readdirSync(path.dirname(file)).filter((f) => f.startsWith(`${path.basename(file)}.corrupt-`))
    expect(backups.length).toBeGreaterThanOrEqual(1)
  })

  it('creates the pool_metrics directory automatically on first write', () => {
    expect(fs.existsSync(tempDir)).toBe(true)
    recordPoolMetric('pool_A', {
      position: 'pos_1',
      pair: 'TEST/SOL',
      pnl_pct: 5.2,
      in_range: true,
    })
    const filePath = getPoolMetricFile('pool_A', 'pos_1')
    expect(fs.existsSync(filePath)).toBe(true)
  })

  it('appends metric snapshots sequentially to the JSON file', () => {
    recordPoolMetric('pool_A', {
      position: 'pos_1',
      pair: 'TEST/SOL',
      pnl_pct: 1.0,
      unclaimed_fees_usd: 0.05,
    })

    recordPoolMetric('pool_A', {
      position: 'pos_1',
      pair: 'TEST/SOL',
      pnl_pct: 2.5,
      unclaimed_fees_usd: 0.12,
    })

    const metrics = readPoolMetrics('pool_A', 'pos_1')
    expect(metrics).toHaveLength(2)
    expect(metrics[0]?.pnl_pct).toBe(1.0)
    expect(metrics[1]?.pnl_pct).toBe(2.5)
    expect(metrics[0]?.timestamp).toBeDefined()
    expect(metrics[1]?.timestamp).toBeDefined()
  })

  it('creates separate files for distinct positions in the same pool (capturing gaps / session reopen)', () => {
    // First position session
    recordPoolMetric('pool_B', {
      position: 'pos_100',
      pair: 'CATE/SOL',
      pnl_pct: 10.0,
    })

    // Second position session in the same pool after reopening
    recordPoolMetric('pool_B', {
      position: 'pos_200',
      pair: 'CATE/SOL',
      pnl_pct: -2.0,
    })

    const file1 = getPoolMetricFile('pool_B', 'pos_100')
    const file2 = getPoolMetricFile('pool_B', 'pos_200')

    expect(file1).not.toBe(file2)
    expect(readPoolMetrics('pool_B', 'pos_100')).toHaveLength(1)
    expect(readPoolMetrics('pool_B', 'pos_200')).toHaveLength(1)
    expect(readPoolMetrics('pool_B', 'pos_100')[0]?.pnl_pct).toBe(10.0)
    expect(readPoolMetrics('pool_B', 'pos_200')[0]?.pnl_pct).toBe(-2.0)
  })

  it('gracefully handles missing optional fields and sanitizes filenames', () => {
    recordPoolMetric('pool/with/slashes', {
      position: 'pos:special#chars',
      pair: 'FOO/SOL',
    })

    const filePath = getPoolMetricFile('pool/with/slashes', 'pos:special#chars')
    expect(fs.existsSync(filePath)).toBe(true)

    const metrics = readPoolMetrics('pool/with/slashes', 'pos:special#chars')
    expect(metrics).toHaveLength(1)
    expect(metrics[0]?.pair).toBe('FOO/SOL')
  })

  it('caps metric rows at 288 to prevent unbounded growth', () => {
    for (let i = 0; i < 300; i++) {
      recordPoolMetric('pool_limit', {
        position: 'pos_limit',
        pair: 'LIMIT/SOL',
        pnl_pct: i,
      })
    }

    const metrics = readPoolMetrics('pool_limit', 'pos_limit')
    expect(metrics).toHaveLength(288)
    // The oldest 12 should be removed (0 to 11). The first one left should be 12.
    expect(metrics[0]?.pnl_pct).toBe(12)
    // The last one should be 299.
    expect(metrics[metrics.length - 1]?.pnl_pct).toBe(299)
  })
})
