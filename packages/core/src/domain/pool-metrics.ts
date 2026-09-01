/**
 * @file pool-metrics.ts
 * @description Domain manager for recording detailed pool metrics to JSON files in the data directory.
 *
 * @features
 * - Saves periodic pool metric snapshots to `data/pool_metrics/`
 * - Creates distinct JSON files per pool and position lifecycle (`metrics_<pool>_<position>.json`)
 * - Ensures closed & reopened positions in the same pool start clean new metric files (capturing time gaps)
 * - Safe file path sanitization and error resilience
 *
 * @sideEffects Writes JSON files to `data/pool_metrics/*.json`
 */

import fs from 'node:fs'
import path from 'node:path'
import { dataPath } from '../shared/constants.js'
import { log } from '../shared/logger.js'
import { loadJsonFile, saveJsonFile } from '../shared/utils.js'

let _poolMetricsDirOverride: string | null = null

export function __setPoolMetricsDir(dirPath: string | null): void {
  _poolMetricsDirOverride = dirPath
}

export interface PoolMetricSnapshotInput {
  position: string
  pair?: string
  pnl_pct?: number | null
  pnl_usd?: number | null
  unclaimed_fees_usd?: number | null
  unclaimed_fees_sol?: number | null
  current_value_usd?: number | null
  current_value_sol?: number | null
  in_range?: boolean | null
  minutes_out_of_range?: number | null
  age_minutes?: number | null
  fee_per_tvl_24h?: number | null
  bin_step?: number | null
  active_bin?: number | null
  base_fee?: number | null
  tvl_usd?: number | null
  volume_24h_usd?: number | null
  extra?: Record<string, unknown>
}

export interface PoolMetricSnapshot extends PoolMetricSnapshotInput {
  timestamp: string
  pool: string
}

function getPoolMetricsDirectory(): string {
  const targetDir = _poolMetricsDirOverride || dataPath('pool_metrics')
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true })
  }
  return targetDir
}

function sanitizeIdentifier(id: string): string {
  if (!id) return 'unknown'
  return id.replace(/[^a-zA-Z0-9_-]/g, '_')
}

/**
 * Returns the absolute filepath for a pool & position metric JSON file.
 */
export function getPoolMetricFile(poolAddress: string, positionAddress: string): string {
  const dir = getPoolMetricsDirectory()
  const cleanPool = sanitizeIdentifier(poolAddress)
  const cleanPosition = sanitizeIdentifier(positionAddress)
  return path.join(dir, `metrics_${cleanPool}_${cleanPosition}.json`)
}

/**
 * Record a pool metric snapshot to disk under data/pool_metrics/.
 */
export function recordPoolMetric(poolAddress: string, input: PoolMetricSnapshotInput): void {
  if (!poolAddress || !input?.position) return

  try {
    const filePath = getPoolMetricFile(poolAddress, input.position)
    const existing = loadJsonFile<PoolMetricSnapshot[]>(filePath, [])

    const snapshot: PoolMetricSnapshot = {
      timestamp: new Date().toISOString(),
      pool: poolAddress,
      ...input,
    }

    existing.push(snapshot)
    saveJsonFile(filePath, existing)
    log(
      'pool-metrics',
      `Saved pool metric snapshot for ${input.pair || poolAddress} (pos: ${input.position.slice(0, 8)}) [${existing.length} entries]`,
    )
  } catch (e: any) {
    log('pool-metrics_error', `Failed to record pool metric for ${poolAddress}: ${e.message}`)
  }
}

/**
 * Reads all recorded metric snapshots from disk for a pool & position.
 */
export function readPoolMetrics(poolAddress: string, positionAddress: string): PoolMetricSnapshot[] {
  const filePath = getPoolMetricFile(poolAddress, positionAddress)
  return loadJsonFile<PoolMetricSnapshot[]>(filePath, [])
}
