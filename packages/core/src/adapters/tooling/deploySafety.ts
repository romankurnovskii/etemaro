/**
 * @file deploySafety.ts
 * @description Pre-deploy pool-detail resolution and threshold validation, extracted verbatim from ToolExecutor.
 */
import { config } from '../../config/Config.js'
import { checkSmartWalletsOnPool as check_smart_wallets_on_pool } from '../../domain/smart-wallets.js'
import { getConsecutiveSwapFailures, isHalted } from '../../domain/state.js'
import { getMinSafeBinsBelow } from '../../shared/constants.js'
import { logStructured } from '../../shared/logger.js'
import { getMyPositions } from '../blockchain/MeteoraAdapter.js'
import { getWalletBalances } from '../blockchain/WalletAdapter.js'

const POOL_DISCOVERY_BASE = 'https://pool-discovery-api.datapi.meteora.ag'
const MIN_VOLATILITY_TIMEFRAME = '30m'
const TIMEFRAME_MINUTES: Record<string, number> = {
  '5m': 5,
  '30m': 30,
  '1h': 60,
  '2h': 120,
  '4h': 240,
  '12h': 720,
  '24h': 1440,
}

// ─── Helper functions ──────────────────────────────────────────

function numberOrNull(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function getVolatilityTimeframe(sourceTimeframe: string | undefined): string {
  const source = String(sourceTimeframe || '').trim()
  const sourceMinutes = TIMEFRAME_MINUTES[source]
  const minMinutes = TIMEFRAME_MINUTES[MIN_VOLATILITY_TIMEFRAME]!
  return sourceMinutes != null && sourceMinutes >= minMinutes ? source : MIN_VOLATILITY_TIMEFRAME
}

function poolDetailTvl(pool: Record<string, unknown>): number | null {
  return numberOrNull((pool as any)?.tvl ?? (pool as any)?.active_tvl ?? (pool as any)?.liquidity)
}

function poolDetailBinStep(pool: Record<string, unknown>): number | null {
  return numberOrNull((pool as any)?.dlmm_params?.bin_step ?? (pool as any)?.pool_config?.bin_step)
}

const DLMM_BASE = 'https://dlmm.datapi.meteora.ag'
const DLMM_TIMEFRAME_BUCKETS = ['30m', '1h', '2h', '4h', '12h', '24h'] as const

type PoolDetailSource = 'discovery' | 'dlmm' | 'missing'

interface PoolDetailFetchResult {
  pool: Record<string, unknown> | null
  source: PoolDetailSource
  discoveryError?: string
  dlmmError?: string
}

function dlmmTimeframeBucket(timeframe: string): string {
  const sourceMinutes = TIMEFRAME_MINUTES[timeframe]
  if (sourceMinutes == null) return '24h'
  for (const bucket of DLMM_TIMEFRAME_BUCKETS) {
    if ((TIMEFRAME_MINUTES[bucket] ?? Infinity) >= sourceMinutes) return bucket
  }
  return '24h'
}

function poolDetailTimeframeMetric(
  pool: Record<string, unknown> | null | undefined,
  key: string,
  timeframe: string,
): number | null {
  const raw = (pool as any)?.[key]
  if (raw == null) return null
  if (typeof raw === 'number') return numberOrNull(raw)
  if (typeof raw === 'object') {
    const bucket = dlmmTimeframeBucket(timeframe)
    const value =
      (raw as Record<string, unknown>)[bucket] ??
      (raw as Record<string, unknown>)['24h'] ??
      Object.values(raw as Record<string, unknown>)[0]
    return numberOrNull(value)
  }
  return numberOrNull(raw)
}

function poolDetailFeeActiveTvlRatio(pool: Record<string, unknown>): number | null {
  const timeframe = String(config.screening.timeframe || '5m')
  const direct = poolDetailTimeframeMetric(pool, 'fee_active_tvl_ratio', timeframe)
  if (direct != null) return direct
  return poolDetailTimeframeMetric(pool, 'fee_tvl_ratio', timeframe)
}

function poolDetailVolume(pool: Record<string, unknown>): number | null {
  const timeframe = String(config.screening.timeframe || '5m')
  return poolDetailTimeframeMetric(pool, 'volume', timeframe)
}

function poolDetailVolatility(pool: Record<string, unknown> | null | undefined): number | null {
  return numberOrNull((pool as any)?.volatility)
}

async function fetchDiscoveryPoolDetail(
  poolAddress: string,
  timeframe: string,
): Promise<Record<string, unknown> | null> {
  const encodedTimeframe = encodeURIComponent(timeframe)
  const filter = encodeURIComponent(`pool_address=${poolAddress}`)
  const url = `${POOL_DISCOVERY_BASE}/pools?page_size=1&filter_by=${filter}&timeframe=${encodedTimeframe}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Pool Discovery API error: ${res.status} ${res.statusText}`)
  const data = (await res.json()) as { data?: Record<string, unknown>[] }
  return (data?.data || [])[0] ?? null
}

async function fetchDlmmPoolDetail(poolAddress: string): Promise<Record<string, unknown> | null> {
  const url = `${DLMM_BASE}/pools/${encodeURIComponent(poolAddress)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`DLMM Pool API error: ${res.status} ${res.statusText}`)
  const data = (await res.json()) as Record<string, unknown>
  return data && typeof data === 'object' && (data as any)?.address ? data : null
}

async function fetchFreshPoolDetail(
  poolAddress: string,
  timeframe: string = config.screening.timeframe || '5m',
): Promise<PoolDetailFetchResult> {
  let discoveryError: string | undefined
  try {
    const discoveryPool = await fetchDiscoveryPoolDetail(poolAddress, timeframe)
    if (discoveryPool) return { pool: discoveryPool, source: 'discovery' }
  } catch (error: any) {
    discoveryError = error.message
  }

  try {
    const dlmmPool = await fetchDlmmPoolDetail(poolAddress)
    if (dlmmPool) {
      logStructured({
        category: 'screening_warn',
        message: 'Pool found only via DLMM API (not indexed in Pool Discovery API); using DLMM fallback pair data',
        metadata: { pool: poolAddress, source: 'dlmm' },
      })
      return { pool: dlmmPool, source: 'dlmm' }
    }
  } catch (error: any) {
    const dlmmError = error.message || 'unknown error'
    return { pool: null, source: 'missing', discoveryError, dlmmError }
  }

  return { pool: null, source: 'missing', discoveryError }
}

export async function validateDeployPoolThresholds(args: Record<string, unknown>): Promise<{
  pass: boolean
  reason?: string
  warnings?: string[]
  source?: PoolDetailSource
  entryMarketData?: Record<string, unknown>
}> {
  const warnings: string[] = []
  const poolAddress = args.pool_address as string

  const { pool: detail, source } = await fetchFreshPoolDetail(poolAddress)
  if (!detail) {
    return {
      pass: false,
      reason:
        `Could not verify pool screening thresholds before deploy: Pool ${poolAddress} invalid or does not exist on Solana ` +
        '(not found in Pool Discovery API or DLMM API). Verify the pool address before deploying.',
    }
  }

  const usingDlmmFallback = source === 'dlmm'

  const tvl = poolDetailTvl(detail)
  const minTvl = numberOrNull(config.screening.minTvl)
  const maxTvl = numberOrNull(config.screening.maxTvl)
  if (tvl == null) {
    return {
      pass: false,
      reason: 'Could not verify pool TVL before deploy.',
    }
  }
  if (minTvl != null && minTvl > 0 && tvl < minTvl) {
    return {
      pass: false,
      reason: `Pool TVL $${tvl} is below configured minTvl $${minTvl}.`,
    }
  }
  if (maxTvl != null && maxTvl > 0 && tvl > maxTvl) {
    return {
      pass: false,
      reason: `Pool TVL $${tvl} is above configured maxTvl $${maxTvl}.`,
    }
  }

  const feeActiveTvlRatio = poolDetailFeeActiveTvlRatio(detail)
  const minFeeActiveTvlRatio = numberOrNull(config.screening.minFeeActiveTvlRatio)
  if (minFeeActiveTvlRatio != null && minFeeActiveTvlRatio > 0) {
    if (feeActiveTvlRatio == null) {
      if (!usingDlmmFallback) {
        return {
          pass: false,
          reason: 'Could not verify pool real-time active-bin fee/TVL before deploy.',
        }
      }
      warnings.push(
        'Pool real-time active-bin fee/TVL ratio unavailable (Pool Discovery API indexing lag); using DLMM fallback pair data — skipped strict ratio filter.',
      )
    } else if (feeActiveTvlRatio < minFeeActiveTvlRatio) {
      return {
        pass: false,
        reason: `Real-time active-bin fee/TVL ${feeActiveTvlRatio}% is below configured minFeeActiveTvlRatio ${minFeeActiveTvlRatio}%.`,
      }
    }
  }

  const screeningTimeframe = String(config.screening.timeframe || '5m')
  const volatilityTimeframe = getVolatilityTimeframe(screeningTimeframe)
  let volatilityResult: PoolDetailFetchResult = { pool: detail, source }
  if (screeningTimeframe !== volatilityTimeframe) {
    volatilityResult = await fetchFreshPoolDetail(poolAddress, volatilityTimeframe)
  }

  const volatility = poolDetailVolatility(volatilityResult.pool)
  if (volatility == null || volatility <= 0) {
    if (volatilityResult.source === 'discovery') {
      return {
        pass: false,
        reason: `Pool ${volatilityTimeframe} volatility ${volatility ?? 'unknown'} is unusable. Refusing deploy.`,
      }
    }
    warnings.push(
      `Pool ${volatilityTimeframe} volatility unavailable (Pool Discovery API indexing lag); using DLMM fallback pair data without a volatility reference.`,
    )
  }

  const actualBinStep = poolDetailBinStep(detail)
  const minStep = numberOrNull(config.screening.minBinStep)
  const maxStep = numberOrNull(config.screening.maxBinStep)
  if (actualBinStep != null && minStep != null && actualBinStep < minStep) {
    return {
      pass: false,
      reason: `Pool bin_step ${actualBinStep} is below configured minBinStep ${minStep}.`,
    }
  }
  if (actualBinStep != null && maxStep != null && actualBinStep > maxStep) {
    return {
      pass: false,
      reason: `Pool bin_step ${actualBinStep} is above configured maxBinStep ${maxStep}.`,
    }
  }

  const entryMarketData: Record<string, unknown> = {
    entry_mcap: numberOrNull((detail as any)?.token_x?.market_cap ?? (detail as any)?.base_token_market_cap),
    entry_tvl: tvl,
    entry_volume: poolDetailVolume(detail),
    entry_holders: numberOrNull((detail as any)?.base_token_holders ?? (detail as any)?.token_x?.holders),
  }

  const result: {
    pass: boolean
    entryMarketData: Record<string, unknown>
    source?: PoolDetailSource
    warnings?: string[]
  } = { pass: true, entryMarketData, source }
  if (warnings.length > 0) result.warnings = warnings
  return result
}

export interface SafetyCheckDeps {
  getActiveSmartWalletListId: () => string
}

export async function runSafetyChecks(
  name: string,
  args: Record<string, unknown>,
  deps: SafetyCheckDeps,
): Promise<{
  pass: boolean
  reason?: string
  warnings?: string[]
  source?: 'discovery' | 'dlmm' | 'missing'
  entryMarketData?: Record<string, unknown>
}> {
  switch (name) {
    case 'deploy_position': {
      // Circuit-breaker: if recent swap failures have crossed the threshold,
      // refuse to open new positions until the operator resets the counter.
      const haltOpts = {
        maxFailedSwapsBeforeHalt: config.management.maxFailedSwapsBeforeHalt ?? 5,
        haltOnSwapFailure: config.management.haltOnSwapFailure ?? true,
      }
      if (isHalted(haltOpts)) {
        const count = getConsecutiveSwapFailures()
        return {
          pass: false,
          reason:
            `Circuit-breaker: ${count} consecutive swap failures (threshold ${haltOpts.maxFailedSwapsBeforeHalt}). ` +
            'New deploys are blocked. Manual review required. Reset the counter to resume.',
        }
      }

      const poolThresholds = await validateDeployPoolThresholds(args)
      if (!poolThresholds.pass) return poolThresholds
      if (poolThresholds.entryMarketData) Object.assign(args, poolThresholds.entryMarketData)
      if (poolThresholds.warnings?.length) {
        logStructured({
          category: 'screening',
          message: 'Pool screening passed using DLMM fallback (Pool Discovery API indexing lag)',
          metadata: {
            tool: 'deploy_position',
            pool: args.pool_address,
            source: poolThresholds.source,
            warnings: poolThresholds.warnings,
          },
        })
      }

      // Reject pools with bin_step out of configured range
      const minStep = config.screening.minBinStep
      const maxStep = config.screening.maxBinStep
      if (args.bin_step != null && ((args.bin_step as number) < minStep || (args.bin_step as number) > maxStep)) {
        return {
          pass: false,
          reason: `bin_step ${args.bin_step} is outside the allowed range of [${minStep}-${maxStep}].`,
        }
      }

      const deployAmountY = Number(args.amount_y ?? args.amount_sol ?? 0)
      const deployAmountX = Number(args.amount_x ?? 0)
      if (Number.isFinite(deployAmountX) && deployAmountX > 0) {
        return {
          pass: false,
          reason: 'This agent only supports single-side SOL deploys. Use amount_y/amount_sol and keep amount_x=0.',
        }
      }
      const requestedBinsBelow = Number(
        args.bins_below ?? config.strategy.defaultBinsBelow ?? config.strategy.minBinsBelow,
      )
      const requestedBinsAbove = Number(args.bins_above ?? 0)
      const minBinsBelow = Math.max(
        getMinSafeBinsBelow(),
        Number(config.strategy.minBinsBelow ?? getMinSafeBinsBelow()),
      )
      const isSingleSidedSol = deployAmountY > 0 && deployAmountX <= 0
      const requestedTotalBins = requestedBinsBelow + requestedBinsAbove
      const requestedVolatility = args.volatility == null ? null : Number(args.volatility)
      if (args.volatility != null && (!Number.isFinite(requestedVolatility!) || requestedVolatility! <= 0)) {
        return {
          pass: false,
          reason: `volatility ${args.volatility} is invalid. Refusing deploy because the volatility feed is unusable.`,
        }
      }
      if (
        args.downside_pct == null &&
        args.upside_pct == null &&
        (!Number.isFinite(requestedBinsBelow) ||
          !Number.isFinite(requestedBinsAbove) ||
          !Number.isInteger(requestedBinsBelow) ||
          !Number.isInteger(requestedBinsAbove) ||
          requestedBinsBelow < 0 ||
          requestedBinsAbove < 0 ||
          requestedTotalBins < minBinsBelow)
      ) {
        return {
          pass: false,
          reason: `deploy range ${requestedTotalBins} total bins is below minimum ${minBinsBelow}. Refusing 1-bin/tiny-range deploy.`,
        }
      }
      if (
        isSingleSidedSol &&
        args.downside_pct == null &&
        (!Number.isFinite(requestedBinsBelow) ||
          !Number.isInteger(requestedBinsBelow) ||
          requestedBinsBelow < minBinsBelow)
      ) {
        return {
          pass: false,
          reason: `bins_below ${args.bins_below ?? 'missing'} is below minimum ${minBinsBelow}. Refusing 1-bin/tiny-range deploy.`,
        }
      }
      if (
        isSingleSidedSol &&
        args.upside_pct == null &&
        (!Number.isFinite(requestedBinsAbove) || !Number.isInteger(requestedBinsAbove) || requestedBinsAbove !== 0)
      ) {
        return {
          pass: false,
          reason: 'Single-side SOL deploy must use bins_above=0.',
        }
      }

      // Check position count limit + duplicate pool guard — force fresh scan to avoid stale cache
      const positions = await getMyPositions({ force: true })
      if ((positions as any).total_positions >= config.risk.maxPositions) {
        return {
          pass: false,
          reason: `Max positions (${config.risk.maxPositions}) reached. Close a position first.`,
        }
      }
      const alreadyInPool = (positions as any).positions.some((p: any) => p.pool === args.pool_address)
      if (alreadyInPool) {
        return {
          pass: false,
          reason: `Already have an open position in pool ${args.pool_address}. Cannot open duplicate.`,
        }
      }

      // Block same base token across different pools
      if (args.base_mint) {
        const alreadyHasMint = (positions as any).positions.some((p: any) => p.base_mint === args.base_mint)
        if (alreadyHasMint) {
          return {
            pass: false,
            reason: `Already holding base token ${args.base_mint} in another pool. One position per token only.`,
          }
        }
      }

      // Check smart wallets and inject trigger_source for logging
      try {
        const smartRes = await check_smart_wallets_on_pool({
          listId: deps.getActiveSmartWalletListId(),
          pool_address: args.pool_address as string,
        })
        if (smartRes?.in_pool && smartRes.in_pool.length > 0) {
          const names = smartRes.in_pool.map((w: any) => w.name || w.address.slice(0, 4)).join(', ')
          args.trigger_source = names
        }
      } catch (_e) {
        // Silently ignore if it fails, it's just for logging
      }

      // Check amount limits
      const amountY = deployAmountY
      if (!Number.isFinite(amountY) || amountY <= 0) {
        return {
          pass: false,
          reason: 'Must provide a positive SOL amount (amount_y).',
        }
      }

      const minDeploy = Math.max(0.1, config.management.deployAmountSol)
      if (amountY < minDeploy) {
        return {
          pass: false,
          reason: `Amount ${amountY} SOL is below the minimum deploy amount (${minDeploy} SOL). Use at least ${minDeploy} SOL.`,
        }
      }
      if (amountY > config.risk.maxDeployAmount) {
        return {
          pass: false,
          reason: `SOL amount ${amountY} exceeds maximum allowed per position (${config.risk.maxDeployAmount}).`,
        }
      }

      // Check SOL balance
      if (!config.connection.dryRun) {
        const balance = await getWalletBalances()
        const gasReserve = config.management.gasReserve
        const minRequired = amountY + gasReserve
        if (balance.sol < minRequired) {
          return {
            pass: false,
            reason: `Insufficient SOL: have ${balance.sol} SOL, need ${minRequired} SOL (${amountY} deploy + ${gasReserve} gas reserve).`,
          }
        }
      }

      return { pass: true }
    }

    case 'swap_token': {
      // Basic validation: check that input_mint and output_mint are non-empty strings and amount is positive
      if (!args.input_mint || typeof args.input_mint !== 'string' || args.input_mint.trim() === '') {
        return { pass: false, reason: 'input_mint is required' }
      }
      if (!args.output_mint || typeof args.output_mint !== 'string' || args.output_mint.trim() === '') {
        return { pass: false, reason: 'output_mint is required' }
      }
      if (typeof args.amount !== 'number' || args.amount <= 0) {
        return { pass: false, reason: 'amount must be a positive number' }
      }
      return { pass: true }
    }

    case 'self_update': {
      if (!config.connection?.allowSelfUpdate) {
        return {
          pass: false,
          reason:
            'self_update is disabled by default. Set connection.allowSelfUpdate: true in your config to enable it.',
        }
      }
      if (!process.stdin.isTTY) {
        return {
          pass: false,
          reason:
            'self_update is only allowed from a local interactive TTY session, not from Telegram or background automation.',
        }
      }
      return { pass: true }
    }

    case 'claim_fees': {
      if (!args.position_address || typeof args.position_address !== 'string' || args.position_address.trim() === '') {
        return { pass: false, reason: 'position_address is required' }
      }
      return { pass: true }
    }

    case 'close_position': {
      if (!args.position_address || typeof args.position_address !== 'string' || args.position_address.trim() === '') {
        return { pass: false, reason: 'position_address is required' }
      }
      return { pass: true }
    }

    default:
      return { pass: true }
  }
}
