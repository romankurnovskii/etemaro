/**
 * @file ToolExecutor.ts
 * @description Central router that executes LLM tool calls with safety checks, post-execution notifications, config persistence, and lesson logging.
 *
 * @features
 * - Maps tool names to adapter functions and normalizes OpenAI-style arguments
 * - Safety-checks deploy_position (thresholds, balances, duplicate pool/token, amount limits)
 * - Auto-swaps base token back to SOL after close/claim with retry
 * - Persists update_config changes to user-config.json and restarts cron jobs when intervals change
 * - Logs every execution to the audit JSONL trail
 *
 * @dependencies node-cron
 * @sideEffects On-chain transactions via deploy/claim/close/swap; writes user-config.json; sends Telegram notifications; starts child processes on self-update
 */

import { execSync, spawn } from 'node:child_process'

// ─── Shared imports ────────────────────────────────────────────
import { getRecentDecisions } from '../domain/decision-log.js'
import { blockDev, listBlockedDevs, unblockDev } from '../domain/dev-blocklist.js'
// ─── JS module imports (no type declarations) ─────────────────
import {
  addLesson,
  clearAllLessons,
  clearPerformance,
  getPerformanceHistory,
  listLessons,
  pinLesson,
  removeLessonsByKeyword,
  unpinLesson,
} from '../domain/lessons.js'
import {
  enqueuePendingLiquidation,
  getPendingLiquidation,
  getPendingLiquidations,
  markLiquidationAttempt,
  markLiquidationSuccess,
  pruneSettledLiquidations,
} from '../domain/liquidation-queue.js'
import { addPoolNote, getPoolMemory } from '../domain/pool-memory.js'
import {
  addSmartWallet,
  checkSmartWalletsOnPool as check_smart_wallets_on_pool,
  listSmartWallets,
  removeSmartWallet,
} from '../domain/smart-wallets.js'
import { recordSwapFailure, recordSwapSuccess, setPositionInstruction } from '../domain/state.js'
import {
  addStrategy,
  getActiveStrategy,
  getStrategy,
  listStrategies,
  removeStrategy,
  setActiveStrategy,
} from '../domain/strategy-library.js'
import { addToBlacklist, listBlacklist, removeFromBlacklist } from '../domain/token-blacklist.js'
import { getMinSafeBinsBelow, REPO_ROOT, USER_CONFIG_PATH } from '../shared/constants.js'
import { log, logAction, logStructured } from '../shared/logger.js'
import { Mutex } from '../shared/mutex.js'
import type { AgentRole, PortfolioSummaryResult, SwapErrorCategory } from '../shared/types.js'
import { loadJsonFile, normalizeTimeframe, saveJsonFile, scaleScreeningToTimeframe } from '../shared/utils.js'
import { ToolRegistry } from '../tools/ToolRegistry.js'
import { sleep } from '../utils/time.js'
// ─── Adapter imports ───────────────────────────────────────────
import { getNotificationPort } from './notifications/notificationPort.js'
import { tools as toolDefinitions } from './ToolDefinitions.js'
import { runSafetyChecks, validateDeployPoolThresholds } from './tooling/deploySafety.js'
import { getToolConfig } from './tooling/toolConfig.js'
import { getToolPorts } from './tooling/toolPorts.js'

// ─── Cron restarter (registered by index.js) ───────────────────

let _cronRestarter: (() => void) | null = null

export {
  __setStateFilePath,
  getConsecutiveSwapFailures,
  recordSwapFailure,
  resetConsecutiveSwapFailures,
} from '../domain/state.js'
export { runSafetyChecks, validateDeployPoolThresholds as _validateDeployPoolThresholds }

export function registerCronRestarter(fn: () => void): void {
  _cronRestarter = fn
}

// ─── Config coercion helpers ───────────────────────────────────

function coerceBoolean(value: unknown, key: string): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }
  throw new Error(`${key} must be true or false`)
}

function coerceFiniteNumber(value: unknown, key: string): number {
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error(`${key} must be a finite number`)
  return n
}

function coerceString(value: unknown, key: string): string {
  if (typeof value !== 'string') throw new Error(`${key} must be a string`)
  return value.trim()
}

function coerceStringArray(value: unknown, key: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${key} must be an array of strings`)
  return value.map((entry: unknown) => coerceString(entry, key)).filter(Boolean)
}

function normalizeConfigValue(key: string, value: unknown): unknown {
  const booleanKeys = new Set([
    'excludeHighSupplyConcentration',
    'avoidPvpSymbols',
    'blockPvpSymbols',
    'autoSwapAfterClaim',
    'trailingTakeProfit',
    'solMode',
    'darwinEnabled',
    'lpAgentRelayEnabled',
    'haltOnSwapFailure',
  ])
  const arrayKeys = new Set(['allowedLaunchpads', 'blockedLaunchpads'])
  const stringKeys = new Set([
    'timeframe',
    'category',
    'strategy',
    'managementModel',
    'screeningModel',
    'generalModel',
    'hiveMindUrl',
    'hiveMindApiKey',
    'agentId',
    'hiveMindPullMode',
    'publicApiKey',
    'agentMeridianApiUrl',
    'pnlSource',
    'pnlRpcUrl',
    'gmgnFeeSource',
    'gmgnApiKey',
  ])
  if (value === null) return null
  if (booleanKeys.has(key)) return coerceBoolean(value, key)
  if (arrayKeys.has(key)) return coerceStringArray(value, key)
  if (stringKeys.has(key)) return coerceString(value, key)
  return coerceFiniteNumber(value, key)
}

/**
 * Unified portfolio summary combining spot wallet token holdings (SOL, SPL, Token-2022)
 * and active Meteora DLMM LP positions.
 */
export async function getPortfolioSummary(options?: { force?: boolean }): Promise<PortfolioSummaryResult> {
  const [walletBalances, myPositions] = await Promise.all([
    getToolPorts().wallet.getWalletBalances(options),
    getToolPorts().chain.getMyPositions(options ? { force: options.force, silent: true } : { silent: true }),
  ])

  let lpPositionsUsd = 0
  let lpUnclaimedFeesUsd = 0
  for (const pos of myPositions.positions || []) {
    const val = pos.total_value_usd ?? pos.value_usd ?? 0
    lpPositionsUsd += val
    lpUnclaimedFeesUsd += pos.unclaimed_fees_usd ?? 0
  }
  lpPositionsUsd = Math.round(lpPositionsUsd * 100) / 100
  lpUnclaimedFeesUsd = Math.round(lpUnclaimedFeesUsd * 100) / 100

  let spotTokensUsd = 0
  for (const t of walletBalances.tokens || []) {
    spotTokensUsd += t.usd ?? 0
  }
  spotTokensUsd = Math.round(spotTokensUsd * 100) / 100

  const totalNetWorthUsd = Math.round((walletBalances.total_usd + lpPositionsUsd + lpUnclaimedFeesUsd) * 100) / 100

  return {
    wallet: walletBalances.wallet,
    sol: walletBalances.sol,
    sol_price: walletBalances.sol_price,
    sol_usd: walletBalances.sol_usd,
    spot_tokens_usd: spotTokensUsd,
    spot_tokens: walletBalances.tokens,
    lp_positions_count: myPositions.total_positions ?? myPositions.positions?.length ?? 0,
    lp_positions_usd: lpPositionsUsd,
    lp_unclaimed_fees_usd: lpUnclaimedFeesUsd,
    lp_positions: myPositions.positions || [],
    total_net_worth_usd: totalNetWorthUsd,
    error: walletBalances.error || myPositions.error,
  }
}

// ─── Tool map ──────────────────────────────────────────────────

type ToolFn = (args: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>

function getActiveSmartWalletListId(): string {
  const listId = getActiveStrategy()?.smartWalletListId
  if (!listId) throw new Error('Active strategy does not define smartWalletListId')
  return listId
}

/** Optional variant for enrichment tools that must degrade in market mode. */
function getActiveSmartWalletListIdOptional(): string | undefined {
  return getActiveStrategy()?.smartWalletListId ?? undefined
}

const toolMap: Record<string, ToolFn> = {
  discover_pools: getToolPorts().market.discoverPools as unknown as ToolFn,
  get_top_candidates: getToolPorts().market.getTopCandidates as unknown as ToolFn,
  get_pool_detail: getToolPorts().market.getPoolDetail as unknown as ToolFn,
  get_position_pnl: getToolPorts().chain.getPositionPnl as unknown as ToolFn,
  get_active_bin: getToolPorts().chain.getActiveBin as unknown as ToolFn,
  deploy_position: getToolPorts().chain.deployPosition as unknown as ToolFn,
  get_my_positions: getToolPorts().chain.getMyPositions as unknown as ToolFn,
  get_meteora_positions: getToolPorts().chain.getMyPositions as unknown as ToolFn,
  get_wallet_positions: getToolPorts().chain.getWalletPositions as unknown as ToolFn,
  search_pools: getToolPorts().chain.searchPools as unknown as ToolFn,
  get_token_info: getToolPorts().market.getTokenInfo as unknown as ToolFn,
  get_token_holders: ((args: Record<string, unknown>) =>
    getToolPorts().market.getTokenHolders({
      ...args,
      smartWalletListId: getActiveSmartWalletListIdOptional(),
    } as any)) as unknown as ToolFn,
  get_token_narrative: getToolPorts().market.getTokenNarrative as unknown as ToolFn,
  add_smart_wallet: (args) => addSmartWallet({ ...args, listId: getActiveSmartWalletListId() } as any),
  remove_smart_wallet: (args) => removeSmartWallet({ ...args, listId: getActiveSmartWalletListId() } as any),
  list_smart_wallets: () => listSmartWallets({ listId: getActiveSmartWalletListId() }),
  check_smart_wallets_on_pool: (args) => {
    const listId = getActiveSmartWalletListIdOptional()
    if (!listId) {
      return {
        in_pool: [],
        note: 'Active strategy defines no smartWalletListId; smart-wallet signal skipped (optional in market mode).',
      }
    }
    return check_smart_wallets_on_pool({ ...args, listId } as any)
  },
  claim_fees: getToolPorts().chain.claimFees as unknown as ToolFn,
  close_position: getToolPorts().chain.closePosition as unknown as ToolFn,
  close_all_positions: ((args: Record<string, unknown> = {}) => {
    const skipSwap = Boolean(args.skipSwap || args.skip_swap)
    return closeAllPositionsUnlocked(skipSwap)
  }) as ToolFn,
  get_wallet_balance: getToolPorts().wallet.getWalletBalances as unknown as ToolFn,
  get_portfolio_summary: getPortfolioSummary as unknown as ToolFn,
  swap_all_tokens_to_sol: ((args: Record<string, unknown> = {}) => {
    const skipMints = (args.skipMints as string[]) || (args.skip_mints as string[]) || []
    return swapAllTokensToSolUnlocked(Array.isArray(skipMints) ? skipMints : [])
  }) as ToolFn,
  sweep_unsold_tokens: ((args: Record<string, unknown> = {}) => {
    const skipMints = (args.skipMints as string[]) || (args.skip_mints as string[]) || []
    return sweepUnsoldTokensUnlocked({ skipMints: Array.isArray(skipMints) ? skipMints : [] })
  }) as ToolFn,
  get_pending_liquidations: ((args: Record<string, unknown> = {}) => {
    const status = args.status as any
    return { liquidations: getPendingLiquidations(status) }
  }) as ToolFn,
  swap_token: getToolPorts().wallet.swapToken as unknown as ToolFn,
  get_top_lpers: getToolPorts().market.studyTopLPers as unknown as ToolFn,
  study_top_lpers: getToolPorts().market.studyTopLPers as unknown as ToolFn,
  set_position_note: ({ position_address, instruction }: Record<string, unknown>) => {
    const ok = setPositionInstruction(position_address as string, (instruction as string) || null)
    if (!ok) return { error: `Position ${position_address} not found in state` }
    return { saved: true, position: position_address, instruction: (instruction as string) || null }
  },
  self_update: async () => {
    try {
      const result = execSync('git pull', { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
      if (result.includes('Already up to date')) {
        return { success: true, updated: false, message: 'Already up to date — no restart needed.' }
      }
      setTimeout(() => {
        if (!process.env.pm_id) {
          const child = spawn(process.execPath, process.argv.slice(1), {
            detached: true,
            stdio: 'inherit',
            cwd: REPO_ROOT,
          })
          child.unref()
        }
        process.exit(0)
      }, 3000)
      const restartMode = process.env.pm_id
        ? 'PM2 detected — exiting in 3s so PM2 can restart the managed process.'
        : 'Restarting in 3s...'
      return { success: true, updated: true, message: `Updated! ${restartMode}\n${result}` }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  },
  get_performance_history: getPerformanceHistory as ToolFn,
  get_recent_decisions: ({ limit } = {}) => ({ decisions: getRecentDecisions((limit as number) || 6) }),
  add_strategy: addStrategy as unknown as ToolFn,
  list_strategies: listStrategies as unknown as ToolFn,
  get_strategy: getStrategy as unknown as ToolFn,
  set_active_strategy: setActiveStrategy as unknown as ToolFn,
  remove_strategy: removeStrategy as unknown as ToolFn,
  get_pool_memory: getPoolMemory as unknown as ToolFn,
  add_pool_note: addPoolNote as unknown as ToolFn,
  add_to_blacklist: addToBlacklist as ToolFn,
  remove_from_blacklist: removeFromBlacklist as ToolFn,
  list_blacklist: listBlacklist as ToolFn,
  block_deployer: blockDev as ToolFn,
  unblock_deployer: unblockDev as ToolFn,
  list_blocked_deployers: listBlockedDevs as ToolFn,
  get_user_config: () => ({
    configPath: USER_CONFIG_PATH,
    preset: (getToolConfig() as any).preset ?? 'custom',
    risk: getToolConfig().risk,
    screening: getToolConfig().screening,
    management: getToolConfig().management,
    strategy: getToolConfig().strategy,
    opportunity: getToolConfig().opportunity,
    schedule: getToolConfig().schedule,
    llm: {
      temperature: getToolConfig().llm.temperature,
      maxTokens: getToolConfig().llm.maxTokens,
      maxSteps: getToolConfig().llm.maxSteps,
    },
  }),
  add_lesson: ({ rule, tags, pinned, role }: Record<string, unknown>) => {
    addLesson(rule as string, (tags as string[]) || [], { pinned: !!pinned, role: (role as AgentRole) || null })
    return { saved: true, rule, pinned: !!pinned, role: (role as string) || 'all' }
  },
  pin_lesson: ({ id }: Record<string, unknown>) => pinLesson(Number(id)),
  unpin_lesson: ({ id }: Record<string, unknown>) => unpinLesson(Number(id)),
  list_lessons: ({ role, pinned, tag, limit }: Record<string, unknown> = {}) =>
    listLessons({
      role: role as string | null,
      pinned: pinned as boolean | null,
      tag: tag as string | null,
      limit: limit as number,
    }),
  clear_lessons: ({ mode, keyword }: Record<string, unknown>) => {
    if (mode === 'all') {
      const n = clearAllLessons()
      log('lessons', `Cleared all ${n} lessons`)
      return { cleared: n, mode: 'all' }
    }
    if (mode === 'performance') {
      const n = clearPerformance()
      log('lessons', `Cleared ${n} performance records`)
      return { cleared: n, mode: 'performance' }
    }
    if (mode === 'keyword') {
      if (!keyword) return { error: 'keyword required for mode=keyword' }
      const n = removeLessonsByKeyword(keyword as string)
      log('lessons', `Cleared ${n} lessons matching "${keyword}"`)
      return { cleared: n, mode: 'keyword', keyword }
    }
    return { error: 'invalid mode' }
  },
  update_config: ({ changes, reason = '' }: Record<string, unknown>) => {
    // Flat key → config section mapping (covers everything in config.js)
    const CONFIG_MAP: Record<string, any> = {
      // screening
      minFeeActiveTvlRatio: ['screening', 'minFeeActiveTvlRatio'],
      excludeHighSupplyConcentration: ['screening', 'excludeHighSupplyConcentration'],
      minTvl: ['screening', 'minTvl'],
      maxTvl: ['screening', 'maxTvl'],
      minVolume: ['screening', 'minVolume'],
      minOrganic: ['screening', 'minOrganic'],
      minQuoteOrganic: ['screening', 'minQuoteOrganic'],
      minHolders: ['screening', 'minHolders'],
      minMcap: ['screening', 'minMcap'],
      maxMcap: ['screening', 'maxMcap'],
      minBinStep: ['screening', 'minBinStep'],
      maxBinStep: ['screening', 'maxBinStep'],
      timeframe: ['screening', 'timeframe'],
      category: ['screening', 'category'],
      minTokenFeesSol: ['screening', 'minTokenFeesSol'],
      avoidPvpSymbols: ['screening', 'avoidPvpSymbols'],
      blockPvpSymbols: ['screening', 'blockPvpSymbols'],
      maxBotHoldersPct: ['screening', 'maxBotHoldersPct'],
      maxTop10Pct: ['screening', 'maxTop10Pct'],
      allowedLaunchpads: ['screening', 'allowedLaunchpads'],
      blockedLaunchpads: ['screening', 'blockedLaunchpads'],
      minTokenAgeHours: ['screening', 'minTokenAgeHours'],
      maxTokenAgeHours: ['screening', 'maxTokenAgeHours'],
      minFeePerTvl24h: ['management', 'minFeePerTvl24h'],
      loneCandidateMinDegen: ['screening', 'loneCandidateMinDegen'],
      // management
      minClaimAmount: ['management', 'minClaimAmount'],
      autoSwapAfterClaim: ['management', 'autoSwapAfterClaim'],
      autoSwapRetryAttempts: ['management', 'autoSwapRetryAttempts'],
      autoSwapRetryDelayMs: ['management', 'autoSwapRetryDelayMs'],
      haltOnSwapFailure: ['management', 'haltOnSwapFailure'],
      maxFailedSwapsBeforeHalt: ['management', 'maxFailedSwapsBeforeHalt'],
      outOfRangeBinsToClose: ['management', 'outOfRangeBinsToClose'],
      outOfRangeWaitMinutes: ['management', 'outOfRangeWaitMinutes'],
      oorCooldownTriggerCount: ['management', 'oorCooldownTriggerCount'],
      oorCooldownHours: ['management', 'oorCooldownHours'],
      repeatDeployCooldownEnabled: ['management', 'repeatDeployCooldownEnabled'],
      repeatDeployCooldownTriggerCount: ['management', 'repeatDeployCooldownTriggerCount'],
      repeatDeployCooldownHours: ['management', 'repeatDeployCooldownHours'],
      repeatDeployCooldownScope: ['management', 'repeatDeployCooldownScope'],
      repeatDeployCooldownMinFeeEarnedPct: ['management', 'repeatDeployCooldownMinFeeEarnedPct'],
      minVolumeToRebalance: ['management', 'minVolumeToRebalance'],
      stopLossPct: ['management', 'stopLossPct'],
      takeProfitPct: ['management', 'takeProfitPct'],
      takeProfitFeePct: ['management', 'takeProfitPct'],
      trailingTakeProfit: ['management', 'trailingTakeProfit'],
      trailingTriggerPct: ['management', 'trailingTriggerPct'],
      trailingDropPct: ['management', 'trailingDropPct'],
      pnlSanityMaxDiffPct: ['management', 'pnlSanityMaxDiffPct'],
      // pnl poller
      pnlConfirmTicks: ['pnl', 'confirmTicks'],
      // opportunity poller (interval/enabled changes apply on next restart)
      opportunityPollEnabled: ['opportunity', 'enabled'],
      opportunityPollIntervalSec: ['opportunity', 'pollIntervalSec'],
      opportunityPollLimit: ['opportunity', 'limit'],
      opportunityMinScore: ['opportunity', 'minScore'],
      opportunitySmartWalletBonus: ['opportunity', 'smartWalletScoreBonus'],
      degenTargetVolRatio: ['opportunity', 'targetVolRatio'],
      degenTargetLpCount: ['opportunity', 'targetLpCount'],
      degenTargetFeeRatio: ['opportunity', 'targetFeeRatio'],
      degenTargetLiquidity: ['opportunity', 'targetLiquidity'],
      solMode: ['management', 'solMode'],
      minSolToOpen: ['management', 'minSolToOpen'],
      deployAmountSol: ['management', 'deployAmountSol'],
      gasReserve: ['management', 'gasReserve'],
      positionSizePct: ['management', 'positionSizePct'],
      minAgeBeforeYieldCheck: ['management', 'minAgeBeforeYieldCheck'],
      // risk
      maxPositions: ['risk', 'maxPositions'],
      maxDeployAmount: ['risk', 'maxDeployAmount'],
      // schedule
      managementIntervalMin: ['schedule', 'managementIntervalMin'],
      screeningIntervalMin: ['schedule', 'screeningIntervalMin'],
      healthCheckIntervalMin: ['schedule', 'healthCheckIntervalMin'],
      // models
      managementModel: ['llm', 'managementModel'],
      screeningModel: ['llm', 'screeningModel'],
      generalModel: ['llm', 'generalModel'],
      temperature: ['llm', 'temperature'],
      maxTokens: ['llm', 'maxTokens'],
      maxSteps: ['llm', 'maxSteps'],
      // strategy
      strategy: ['strategy', 'strategy'],
      binsBelow: ['strategy', 'maxBinsBelow', ['maxBinsBelow']],
      minBinsBelow: ['strategy', 'minBinsBelow'],
      maxBinsBelow: ['strategy', 'maxBinsBelow'],
      defaultBinsBelow: ['strategy', 'defaultBinsBelow'],
      // hivemind
      hiveMindUrl: ['api', 'hiveMind', 'url'],
      hiveMindApiKey: ['api', 'hiveMind', 'apiKey'],
      hiveMindAgentId: ['api', 'hiveMind', 'agentId'],
      hiveMindPullMode: ['api', 'hiveMind', 'pullMode'],
      // Etemaro API / relay
      publicApiKey: ['api', 'meridian', 'publicApiKey', ['api', 'meridian', 'publicApiKey']],
      agentMeridianApiUrl: ['api', 'meridian', 'url', ['api', 'meridian', 'url']],
      lpAgentRelayEnabled: ['api', 'meridian', 'lpAgentRelayEnabled', ['api', 'meridian', 'lpAgentRelayEnabled']],
      // pnl fetcher / poller
      pnlSource: ['pnl', 'source', ['pnlSource']],
      pnlRpcUrl: ['pnl', 'rpcUrl', ['pnlRpcUrl']],
      pnlPollIntervalSec: ['pnl', 'pollIntervalSec', ['pnlPollIntervalSec']],
      pnlDepositCacheTtlSec: ['pnl', 'depositCacheTtlSec', ['pnlDepositCacheTtlSec']],
      // gmgn fee source
      gmgnFeeSource: ['gmgn', 'feeSource', ['gmgnFeeSource']],
      gmgnApiKey: ['gmgn', 'apiKey', ['gmgnApiKey']],
      // chart indicators
      chartIndicatorsEnabled: ['indicators', 'enabled', ['chartIndicators', 'enabled']],
      indicatorEntryPreset: ['indicators', 'entryPreset', ['chartIndicators', 'entryPreset']],
      indicatorExitPreset: ['indicators', 'exitPreset', ['chartIndicators', 'exitPreset']],
      rsiLength: ['indicators', 'rsiLength', ['chartIndicators', 'rsiLength']],
      indicatorIntervals: ['indicators', 'intervals', ['chartIndicators', 'intervals']],
      indicatorCandles: ['indicators', 'candles', ['chartIndicators', 'candles']],
      rsiOversold: ['indicators', 'rsiOversold', ['chartIndicators', 'rsiOversold']],
      rsiOverbought: ['indicators', 'rsiOverbought', ['chartIndicators', 'rsiOverbought']],
      requireAllIntervals: ['indicators', 'requireAllIntervals', ['chartIndicators', 'requireAllIntervals']],
    }

    const applied: Record<string, unknown> = {}
    const unknown: string[] = []

    // Build case-insensitive lookup
    const CONFIG_MAP_LOWER = Object.fromEntries(Object.entries(CONFIG_MAP).map(([k, v]) => [k.toLowerCase(), [k, v]]))

    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
      return { success: false, error: 'changes must be an object', reason }
    }

    const STRATEGY_BIN_KEYS = new Set(['binsBelow', 'minBinsBelow', 'maxBinsBelow', 'defaultBinsBelow'])
    for (const [key, val] of Object.entries(changes as Record<string, unknown>)) {
      const raw = CONFIG_MAP[key] ? [key, CONFIG_MAP[key]] : CONFIG_MAP_LOWER[key.toLowerCase()]
      if (!raw) {
        unknown.push(key)
        continue
      }
      const match = raw as [string, any]
      try {
        let normalizedVal = val
        if (STRATEGY_BIN_KEYS.has(match[0])) {
          const numericVal = Number(val)
          if (!Number.isFinite(numericVal)) {
            throw new Error(`${match[0]} must be a finite number`)
          }
          normalizedVal = Math.max(getMinSafeBinsBelow(), Math.round(numericVal))
        } else {
          normalizedVal = normalizeConfigValue(match[0], val)
        }
        applied[match[0]] = normalizedVal
      } catch (error: any) {
        return { success: false, error: error.message, key: match[0], reason }
      }
    }

    if (Object.keys(applied).length === 0) {
      log(
        'config',
        `update_config failed — unknown keys: ${JSON.stringify(unknown)}, raw changes: ${JSON.stringify(changes)}`,
      )
      return { success: false, unknown, reason }
    }

    const userConfig = loadJsonFile<Record<string, unknown>>(USER_CONFIG_PATH, {}, { critical: true })

    // Auto-scale fee/volume when timeframe changes (unless user set them explicitly in same call).
    if (applied.timeframe != null && applied.minFeeActiveTvlRatio == null && applied.minVolume == null) {
      const tf = normalizeTimeframe(applied.timeframe as string)
      applied.timeframe = tf
      const scaled = scaleScreeningToTimeframe(tf)
      applied.minFeeActiveTvlRatio = scaled.minFeeActiveTvlRatio
      applied.minVolume = scaled.minVolume
      applied._timeframeScaled = true
      log(
        'config',
        `timeframe ${tf} → auto-scaled minFeeActiveTvlRatio=${scaled.minFeeActiveTvlRatio}, minVolume=${scaled.minVolume}`,
      )
    }

    // Apply to live config immediately after the persisted config is known-good.
    for (const [key, val] of Object.entries(applied)) {
      if (key.startsWith('_')) continue
      const mapping = CONFIG_MAP[key]
      if (!mapping) continue
      const livePath = mapping.slice(1).filter((part: unknown) => typeof part === 'string')
      let target = getToolConfig() as any
      for (const part of livePath.slice(0, -1)) target = target[part]
      const field = livePath.at(-1)!
      const before = target[field]
      target[field] = val
      log('config', `update_config: config.${livePath.join('.')} ${before} → ${val} (verify: ${target[field]})`)
    }
    if (
      applied.binsBelow != null ||
      applied.minBinsBelow != null ||
      applied.maxBinsBelow != null ||
      applied.defaultBinsBelow != null
    ) {
      getToolConfig().strategy.minBinsBelow = Math.max(
        getMinSafeBinsBelow(),
        Math.round(Number(getToolConfig().strategy.minBinsBelow ?? getMinSafeBinsBelow())),
      )
      getToolConfig().strategy.maxBinsBelow = Math.max(
        getToolConfig().strategy.minBinsBelow,
        Math.round(Number(getToolConfig().strategy.maxBinsBelow ?? getToolConfig().strategy.minBinsBelow)),
      )
      getToolConfig().strategy.defaultBinsBelow = Math.max(
        getToolConfig().strategy.minBinsBelow,
        Math.min(
          getToolConfig().strategy.maxBinsBelow,
          Math.round(Number(getToolConfig().strategy.defaultBinsBelow ?? getToolConfig().strategy.maxBinsBelow)),
        ),
      )
    }

    for (const [key, val] of Object.entries(applied)) {
      if (key.startsWith('_')) continue
      const mapping = CONFIG_MAP[key]
      const persistPath = mapping?.find((part: unknown) => Array.isArray(part))
      if (Array.isArray(persistPath) && persistPath.length > 0) {
        let target = userConfig
        for (const part of persistPath.slice(0, -1)) {
          if (!target[part] || typeof target[part] !== 'object' || Array.isArray(target[part])) {
            target[part] = {}
          }
          target = target[part] as Record<string, unknown>
        }
        target[persistPath.at(-1)!] = val
      } else {
        userConfig[key] = val
      }
    }
    userConfig._lastAgentTune = new Date().toISOString()
    saveJsonFile(USER_CONFIG_PATH, userConfig)

    // Restart cron jobs if intervals changed
    const intervalChanged =
      applied.managementIntervalMin != null ||
      applied.screeningIntervalMin != null ||
      applied.pnlPollIntervalSec != null
    if (intervalChanged && _cronRestarter) {
      _cronRestarter()
      log(
        'config',
        `Cron restarted — management: ${getToolConfig().schedule.managementIntervalMin}m, screening: ${getToolConfig().schedule.screeningIntervalMin}m, pnlPoll: ${getToolConfig().pnl.pollIntervalSec}s`,
      )
    }

    // Skip repeated volatility-driven interval changes; they are operational tuning, not reusable lessons.
    const lessonsKeys = Object.keys(applied).filter(
      (k) => !k.startsWith('_') && k !== 'managementIntervalMin' && k !== 'screeningIntervalMin',
    )
    if (lessonsKeys.length > 0) {
      const summary = lessonsKeys.map((k) => `${k}=${applied[k]}`).join(', ')
      addLesson(`[SELF-TUNED] Changed ${summary} — ${reason}`, ['self_tune', 'config_change'])
    }

    log('config', `Agent self-tuned: ${JSON.stringify(applied)} — ${reason}`)
    return { success: true, applied, unknown, reason }
  },
}

// ─── Tool registry ─────────────────────────────────────────────
// Single source of truth joining LLM schemas, handlers, and permission classes.
// Adding a tool means adding a definition + a handler; the registry validates the pair
// at load time and derives the write/protected sets from one declaration.

const WRITE_TOOL_NAMES = [
  'deploy_position',
  'claim_fees',
  'close_position',
  'close_all_positions',
  'swap_token',
  'swap_all_tokens_to_sol',
  'sweep_unsold_tokens',
] as const

const PROTECTED_TOOL_NAMES = [...WRITE_TOOL_NAMES, 'self_update'] as const

export const toolRegistry = new ToolRegistry({
  definitions: toolDefinitions,
  handlers: toolMap,
  writeTools: WRITE_TOOL_NAMES,
  protectedTools: PROTECTED_TOOL_NAMES,
})

/** @deprecated Prefer toolRegistry.isWrite(); kept for existing consumers. */
export const WRITE_TOOLS = toolRegistry.writeTools
/** @deprecated Prefer toolRegistry.isProtected(); kept for existing consumers. */
export const PROTECTED_TOOLS = toolRegistry.protectedTools

export const writeToolsMutex = new Mutex()

export async function withWriteToolsLock<T>(operation: () => Promise<T>): Promise<T> {
  return writeToolsMutex.runExclusive(operation)
}

/**
 * Swap a base token back to SOL with retry. Jupiter can transiently fail (no route,
 * quote error) and a single attempt silently leaves the token unsold — this retries
 * with a delay, re-fetching the balance each attempt (amounts can shift on partial
 * fills). Treats both a throw AND result.success===false / missing tx as failure.
 * Returns { swapped, result, token } — swapped=false if nothing to do or all attempts failed.
 */
export async function swapBaseToSolWithRetry(
  baseMint: string,
  label: string,
  minUsd: number = 0.05,
  poolAddress?: string | null,
  position?: string | null,
  opts: { affectsCircuit?: boolean } = {},
): Promise<{
  swapped: boolean
  result: Record<string, unknown> | null
  token: Record<string, unknown> | null
  errorCode?: string | null
  errorCategory?: SwapErrorCategory | null
  abandonImmediately?: boolean
}> {
  const attempts = Math.max(1, Number(getToolConfig().management.autoSwapRetryAttempts ?? 3))
  const delayMs = Math.max(0, Number(getToolConfig().management.autoSwapRetryDelayMs ?? 3000))
  const haltOnSwapFailure = getToolConfig().management.haltOnSwapFailure ?? true
  const maxFailedSwapsBeforeHalt = getToolConfig().management.maxFailedSwapsBeforeHalt ?? 5
  let lastErr: string | null = null
  let lastErrorCode: string | null = null
  let lastErrorCategory: SwapErrorCategory | null = null
  let lastToken: any = null
  let amountMultiplier = 1.0
  let currentSlippageBps: number | undefined
  let abandonImmediately = false
  // Best-effort cleanup swaps (sweeper, batch cleanup) must not trip the deploy
  // circuit breaker: dead/dust tokens legitimately have no route and would
  // otherwise block new deploys.
  const affectsCircuit = opts.affectsCircuit !== false

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const balances = await getToolPorts().wallet.getWalletBalances()
      const token = balances.tokens?.find((t: any) => t.mint === baseMint)
      if (!token || token.balance <= 0) {
        return { swapped: attempt > 1, result: null, token: null }
      }
      // If USD value is known and strictly below dust threshold (< minUsd), skip swap
      if (typeof token.usd === 'number' && token.usd >= 0 && token.usd < minUsd) {
        return { swapped: attempt > 1, result: null, token: null }
      }
      lastToken = token
      const amountToSwap = Math.max(0, token.balance * amountMultiplier)
      const usdDisplay = typeof token.usd === 'number' ? ` ($${token.usd.toFixed(2)})` : ''
      const attemptDetails = `${amountMultiplier < 1 ? `, amount: ${amountToSwap}` : ''}${currentSlippageBps ? `, slippage: ${currentSlippageBps}bps` : ''}`
      log(
        'executor',
        `Auto-swapping ${label} ${token.symbol || baseMint.slice(0, 8)}${usdDisplay} back to SOL (attempt ${attempt}/${attempts}${attemptDetails})`,
      )
      let swapResult = await getToolPorts().wallet.swapToken({
        input_mint: baseMint,
        output_mint: 'SOL',
        amount: amountToSwap,
        slippageBps: currentSlippageBps,
      })
      let sr = swapResult as any
      let ok = swapResult && sr.success !== false && !sr.error && (sr.tx || sr.amount_out)

      // Fallback: if Jupiter aggregator has no route or fails, attempt direct DLMM pool swap if pool address is known
      if (!ok && poolAddress) {
        log(
          'executor',
          `Jupiter swap failed for ${token.symbol || baseMint.slice(0, 8)} (${sr?.error || 'no route'}); attempting direct DLMM pool swap fallback on ${poolAddress.slice(0, 8)}`,
        )
        const dlmmRes = await getToolPorts().chain.swapDirectDlmm({
          pool_address: poolAddress,
          input_mint: baseMint,
          amount: amountToSwap,
        })
        if (dlmmRes?.success && (dlmmRes.tx || dlmmRes.amount_out)) {
          swapResult = dlmmRes as any
          sr = dlmmRes as any
          ok = true
        } else if (dlmmRes?.error) {
          lastErr = `DLMM direct swap failed: ${dlmmRes.error} (Jupiter: ${sr?.error || 'no route'})`
        }
      }

      if (ok) {
        if (affectsCircuit) recordSwapSuccess()
        // Jupiter V2 /execute returns outputAmountResult in lamports; divide by 1e9 for SOL.
        // amount_in is also in lamports if used elsewhere.
        const solReceived =
          sr.amount_out != null
            ? (typeof sr.amount_out === 'number' ? sr.amount_out : parseFloat(sr.amount_out)) / 1e9
            : null
        const usdValue =
          token.usd ?? (solReceived != null && balances.sol_price ? solReceived * balances.sol_price : null)

        await markLiquidationSuccess(baseMint, {
          tx: sr.tx,
          amountOutSol: solReceived != null ? solReceived : undefined,
        }).catch(() => {})

        getNotificationPort()
          .notifySwap({
            inputSymbol: token.symbol || baseMint.slice(0, 8),
            outputSymbol: 'SOL',
            amountIn: token.balance != null ? String(token.balance) : String(sr.amount_in ?? '?'),
            amountOut: solReceived != null ? `${solReceived.toFixed(4)} SOL` : String(sr.amount_out ?? '?'),
            tx: sr.tx,
            amountUsd: usdValue,
          })
          .catch((err: any) => {
            log('telegram_warn', `Failed to send swap notification: ${err?.message || err}`)
          })
        return {
          swapped: true,
          result: swapResult as unknown as Record<string, unknown>,
          token: token as unknown as Record<string, unknown>,
        }
      }

      lastErr = sr?.error || sr?.reason || lastErr || 'swap returned no tx'
      lastErrorCode = sr?.error_code || null
      lastErrorCategory = sr?.error_category || null

      // Differentiated error handling based on Jupiter error category
      if (lastErrorCategory === 'liquidity.unavailable') {
        abandonImmediately = true
        log(
          'executor_warn',
          `Auto-swap ${label} permanently illiquid for ${token.symbol || baseMint.slice(0, 8)} (${lastErrorCode || lastErr}): abandoning immediately without further retries`,
        )
        break
      } else if (lastErrorCategory === 'liquidity.partial') {
        // Route cannot process full amount: reduce amount for next attempt
        amountMultiplier = Math.max(0.1, amountMultiplier * 0.5)
        log(
          'executor_warn',
          `Auto-swap ${label} partial liquidity route for ${token.symbol || baseMint.slice(0, 8)}: retrying with reduced amount (${(amountMultiplier * 100).toFixed(0)}%)`,
        )
      } else if (lastErrorCategory === 'slippage.exceeded') {
        // Slippage tolerance exceeded: increase slippage for next attempt (up to 1000 bps)
        currentSlippageBps = Math.min(1000, (currentSlippageBps ?? 100) * 2)
        log(
          'executor_warn',
          `Auto-swap ${label} slippage exceeded for ${token.symbol || baseMint.slice(0, 8)}: retrying with slippage ${currentSlippageBps} bps`,
        )
      }
    } catch (e: any) {
      lastErr = e.message
    }
    log('executor_warn', `Auto-swap ${label} attempt ${attempt}/${attempts} failed: ${lastErr}`)
    if (attempt < attempts && !abandonImmediately) await sleep(delayMs)
  }
  log(
    'executor_warn',
    `Auto-swap ${label} failed after ${attempts} attempts — base token left unsold (${baseMint.slice(0, 8)})`,
  )
  if (affectsCircuit) recordSwapFailure({ maxFailedSwapsBeforeHalt, haltOnSwapFailure })
  const symbol = lastToken?.symbol || baseMint.slice(0, 8)
  const tokenUsd = lastToken?.usd ?? null
  const alertThreshold = getToolConfig().management.sweeperAlertUsd ?? 1.0

  // Register in persistent liquidation queue
  await enqueuePendingLiquidation({
    mint: baseMint,
    symbol,
    amount: lastToken?.balance ?? 0,
    usd: tokenUsd,
    pool_address: poolAddress || null,
    position: position || null,
    error: lastErr || `Failed after ${attempts} attempts`,
    errorCode: lastErrorCode || lastErrorCategory || null,
    status: abandonImmediately ? 'abandoned' : 'pending',
  }).catch((err: any) => {
    log('state_error', `Failed to enqueue pending liquidation: ${err?.message || err}`)
  })

  // Trigger high-priority alert if token value exceeds alert threshold
  if (typeof tokenUsd === 'number' && tokenUsd >= alertThreshold) {
    getNotificationPort()
      .notifyLiquidationAlert({
        symbol,
        mint: baseMint,
        amount: lastToken?.balance ?? 0,
        usd: tokenUsd,
        reason: lastErr || `Failed after ${attempts} attempts`,
        attempts,
      })
      .catch((err: any) => {
        log('telegram_warn', `Failed to send liquidation alert notification: ${err?.message || err}`)
      })
  } else {
    getNotificationPort()
      .notifySwapError({
        inputSymbol: symbol,
        outputSymbol: 'SOL',
        reason: lastErr || `Failed after ${attempts} attempts`,
      })
      .catch((err: any) => {
        log('telegram_warn', `Failed to send swap error notification: ${err?.message || err}`)
      })
  }

  return {
    swapped: false,
    result: null,
    token: null,
    errorCode: lastErrorCode || lastErrorCategory || null,
    errorCategory: lastErrorCategory,
    abandonImmediately,
  }
}

/**
 * Sweep and reconcile all unsold base tokens in the wallet back to SOL.
 * Combines active wallet holdings with the persistent liquidation backlog.
 */
export async function sweepUnsoldTokens(opts: { skipMints?: string[]; dryRun?: boolean } = [] as any): Promise<{
  total: number
  successful: number
  failed: number
  abandoned: number
  skipped: number
  results: any[]
}> {
  return withWriteToolsLock(() => sweepUnsoldTokensUnlocked(opts))
}

export async function sweepUnsoldTokensUnlocked(opts: { skipMints?: string[]; dryRun?: boolean } = [] as any): Promise<{
  total: number
  successful: number
  failed: number
  abandoned: number
  skipped: number
  results: any[]
}> {
  let skipMints: string[] = []
  if (Array.isArray(opts)) {
    skipMints = opts
  } else if (opts && typeof opts === 'object') {
    const raw = (opts as any).skipMints || (opts as any).skip_mints
    if (Array.isArray(raw)) skipMints = raw
  }

  const balances = await getToolPorts().wallet.getWalletBalances()
  if (!balances?.tokens) {
    return { total: 0, successful: 0, failed: 0, abandoned: 0, skipped: 0, results: [] }
  }

  const SOL_MINT_1 = 'So11111111111111111111111111111111111111111'
  const SOL_MINT_2 = 'So11111111111111111111111111111111111111112'
  const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
  const skips = new Set([SOL_MINT_1, SOL_MINT_2, USDC_MINT, ...skipMints])

  // Reconcile wallet balances with persistent liquidation queue
  const priceMap: Record<string, number> = {}
  for (const t of balances.tokens as any[]) {
    const symbolUpper = (t.symbol || '').toUpperCase()
    const isSolOrUsdc = symbolUpper === 'SOL' || symbolUpper === 'WSOL' || symbolUpper === 'USDC'
    if (t.mint && typeof t.usd === 'number' && typeof t.balance === 'number' && t.balance > 0) {
      priceMap[t.mint] = t.usd / t.balance
    }
    if (skips.has(t.mint) || isSolOrUsdc || (t.balance ?? 0) <= 0) continue

    const existing = getPendingLiquidation(t.mint)
    if (!existing || existing.status === 'liquidated') {
      await enqueuePendingLiquidation({
        mint: t.mint,
        symbol: t.symbol,
        amount: t.balance,
        usd: t.usd,
      }).catch(() => {})
    }
  }

  if (Object.keys(priceMap).length > 0) {
    try {
      const { updatePendingTradesMarkToMarket } = await import('../domain/lessons.js')
      updatePendingTradesMarkToMarket(priceMap)
    } catch {
      // ignore
    }
  }

  const pendingItems = getPendingLiquidations('pending')
  let total = 0
  let skipped = 0
  let successful = 0
  let failed = 0
  let abandoned = 0
  const results: any[] = []

  const interSwapDelayMs = Math.max(0, Number(getToolConfig().management.autoSwapInterSwapDelayMs ?? 1500))
  const minUsd = Math.max(0, Number(getToolConfig().management.sweeperMinUsd ?? 0.02))
  const maxAttempts = Math.max(1, Number(getToolConfig().management.sweeperMaxAttempts ?? 10))
  const abandonWindowHours = Math.max(1, Number(getToolConfig().management.sweeperAbandonWindowHours ?? 2))
  let swapAttempted = false

  for (const item of pendingItems) {
    if (skips.has(item.mint)) {
      skipped++
      continue
    }

    total++
    const currentToken = (balances.tokens as any[])?.find((t: any) => t.mint === item.mint)
    if (!currentToken || (currentToken.balance ?? 0) <= 0) {
      await markLiquidationSuccess(item.mint).catch(() => {})
      skipped++
      continue
    }

    const isDust = typeof currentToken.usd === 'number' && currentToken.usd >= 0 && currentToken.usd < minUsd
    if (isDust) {
      skipped++
      results.push({
        mint: item.mint,
        symbol: item.symbol,
        success: false,
        reason: `skipped dust (< $${minUsd.toFixed(2)})`,
      })
      continue
    }

    // Pace swaps to respect API rate limits
    if (swapAttempted && interSwapDelayMs > 0) {
      await sleep(interSwapDelayMs)
    }
    swapAttempted = true

    try {
      const res = await swapBaseToSolWithRetry(item.mint, 'sweeper', minUsd, item.pool_address, null, {
        affectsCircuit: false,
      })
      if (res.swapped) {
        successful++
        results.push({ mint: item.mint, symbol: item.symbol, success: true, result: res.result })
      } else {
        const shouldAbandon = res.abandonImmediately || res.errorCategory === 'liquidity.unavailable'
        const outcome = await markLiquidationAttempt(item.mint, {
          error: 'sweeper failed to liquidate token',
          errorCode: res.errorCode || res.errorCategory || null,
          maxAttempts,
          abandonWindowHours,
          abandonImmediately: shouldAbandon,
        })
        if (outcome.status === 'abandoned') {
          abandoned++
          results.push({
            mint: item.mint,
            symbol: item.symbol,
            success: false,
            reason: shouldAbandon
              ? `abandoned immediately (${res.errorCode || 'liquidity unavailable'})`
              : `abandoned after ${outcome.attempts} attempts`,
          })
        } else {
          failed++
          results.push({
            mint: item.mint,
            symbol: item.symbol,
            success: false,
            reason: `liquidation attempt ${outcome.attempts} failed`,
          })
        }
      }
    } catch (e: any) {
      failed++
      results.push({ mint: item.mint, symbol: item.symbol, success: false, reason: e.message })
    }
  }

  // Prune older settled entries (settled > 24h ago)
  await pruneSettledLiquidations(24).catch(() => {})

  logAction({
    tool: 'sweepUnsoldTokens',
    args: { skipMints },
    result: { total, skipped, successful, failed, abandoned },
    duration_ms: 0,
    success: failed === 0,
  })

  return { total, skipped, successful, failed, abandoned, results }
}

/**
 * Orchestrate swapping all non-SOL/USDC tokens to SOL.
 */
export async function swapAllTokensToSol(skipMintsInput: string[] | { skipMints?: string[] } = []): Promise<{
  total: number
  skipped: number
  successful: number
  failed: number
  results: any[]
}> {
  return withWriteToolsLock(() => swapAllTokensToSolUnlocked(skipMintsInput))
}

export async function swapAllTokensToSolUnlocked(skipMintsInput: string[] | { skipMints?: string[] } = []): Promise<{
  total: number
  skipped: number
  successful: number
  failed: number
  results: any[]
}> {
  let skipMints: string[] = []
  if (Array.isArray(skipMintsInput)) {
    skipMints = skipMintsInput
  } else if (skipMintsInput && typeof skipMintsInput === 'object') {
    const raw = (skipMintsInput as any).skipMints || (skipMintsInput as any).skip_mints
    if (Array.isArray(raw)) {
      skipMints = raw
    }
  }

  const balances = await getToolPorts().wallet.getWalletBalances()
  if (!balances?.tokens) {
    return { total: 0, skipped: 0, successful: 0, failed: 0, results: [] }
  }

  const SOL_MINT_1 = 'So11111111111111111111111111111111111111111'
  const SOL_MINT_2 = 'So11111111111111111111111111111111111111112'
  const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
  const skips = new Set([SOL_MINT_1, SOL_MINT_2, USDC_MINT, ...skipMints])

  let total = 0
  let skipped = 0
  let successful = 0
  let failed = 0
  const results = []
  const interSwapDelayMs = Math.max(0, Number(getToolConfig().management.autoSwapInterSwapDelayMs ?? 1500))
  let swapAttempted = false

  for (const token of balances.tokens as any[]) {
    total++
    const symbolUpper = (token.symbol || '').toUpperCase()
    const isSolOrUsdc = symbolUpper === 'SOL' || symbolUpper === 'WSOL' || symbolUpper === 'USDC'
    const isDust = typeof token.usd === 'number' && token.usd >= 0 && token.usd < 0.02
    const hasBalance = (token.balance ?? 0) > 0

    if (skips.has(token.mint) || isSolOrUsdc || !hasBalance || isDust) {
      skipped++
      continue
    }

    // Pace swaps to respect Jupiter rate limits (Free tier: 60 RPM main bucket).
    // /order counts against the main bucket; /execute has its own bucket.
    if (swapAttempted && interSwapDelayMs > 0) {
      await sleep(interSwapDelayMs)
    }
    swapAttempted = true

    try {
      const res = await swapBaseToSolWithRetry(token.mint, 'batch cleanup', 0.02, null, null, {
        affectsCircuit: false,
      })
      if (res.swapped) {
        successful++
        results.push({ mint: token.mint, success: true, result: res.result })
      } else {
        failed++
        results.push({ mint: token.mint, success: false, reason: 'auto-swap failed' })
      }
    } catch (e: any) {
      failed++
      results.push({ mint: token.mint, success: false, reason: e.message })
    }
  }

  logAction({
    tool: 'swapAllTokensToSol',
    args: { skipMints },
    result: { total, skipped, successful, failed },
    duration_ms: 0,
    success: failed === 0,
  })

  return { total, skipped, successful, failed, results }
}

/**
 * Orchestrate closing all open positions.
 */
export async function closeAllPositions(
  skipSwapInput: boolean | { skipSwap?: boolean; skip_swap?: boolean } = false,
): Promise<{
  total: number
  successful: number
  failed: number
  results: any[]
}> {
  return withWriteToolsLock(() => closeAllPositionsUnlocked(skipSwapInput))
}

export async function closeAllPositionsUnlocked(
  skipSwapInput: boolean | { skipSwap?: boolean; skip_swap?: boolean } = false,
): Promise<{
  total: number
  successful: number
  failed: number
  results: any[]
}> {
  let skipSwap = false
  if (typeof skipSwapInput === 'boolean') {
    skipSwap = skipSwapInput
  } else if (skipSwapInput && typeof skipSwapInput === 'object') {
    skipSwap = Boolean((skipSwapInput as any).skipSwap || (skipSwapInput as any).skip_swap)
  }
  const positionsRes = await getToolPorts().chain.getMyPositions({ force: true })
  if (!positionsRes?.positions) {
    return { total: 0, successful: 0, failed: 0, results: [] }
  }

  const positions = positionsRes.positions as any[]
  let successful = 0
  let failed = 0
  const results = []

  for (const pos of positions) {
    try {
      const res = (await executeToolUnlocked('close_position', {
        position_address: pos.position,
        skip_swap: skipSwap,
        reason: 'close all',
      })) as any
      if (res && res.success !== false && !res.error) {
        successful++
        results.push({ position: pos.position, success: true, result: res })
      } else {
        failed++
        results.push({ position: pos.position, success: false, reason: res?.error || 'failed to close' })
      }
    } catch (e: any) {
      failed++
      results.push({ position: pos.position, success: false, reason: e.message })
    }
  }

  logAction({
    tool: 'closeAllPositions',
    args: { skipSwap },
    result: { total: positions.length, successful, failed },
    duration_ms: 0,
    success: failed === 0,
  })

  return { total: positions.length, successful, failed, results }
}

/**
 * Execute a tool call with safety checks and logging.
 */
export async function executeTool(name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const normalizedName = name.replace(/<.*$/, '').trim()
  if (WRITE_TOOLS.has(normalizedName)) {
    return withWriteToolsLock(() => executeToolUnlocked(normalizedName, args))
  }
  return executeToolUnlocked(normalizedName, args)
}

async function executeToolUnlocked(name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const startTime = Date.now()

  // Strip model artifacts like "<|channel|>commentary" appended to tool names
  name = name.replace(/<.*$/, '').trim()

  // ─── Validate tool exists ─────────────────
  const fn = toolRegistry.getHandler(name)
  if (!fn) {
    const error = `Unknown tool: ${name}`
    log('error', error)
    return { error }
  }

  // ─── Pre-execution safety checks ──────────
  if (PROTECTED_TOOLS.has(name)) {
    const safetyCheck = await runSafetyChecks(name, args, { getActiveSmartWalletListId })
    if (!safetyCheck.pass) {
      log('safety_block', `${name} blocked: ${safetyCheck.reason}`)
      logStructured({
        category: 'safety_block',
        message: `${name} blocked: ${safetyCheck.reason}`,
        metadata: { tool: name, reason: safetyCheck.reason, args: summarizeArgsForLog(args) },
      })
      return {
        blocked: true,
        reason: safetyCheck.reason,
      }
    }
  }

  // ─── Execute ──────────────────────────────
  try {
    const result = await fn(args)
    const duration = Date.now() - startTime
    const success = (result as any)?.success !== false && !(result as any)?.error

    logAction({
      tool: name,
      args,
      result: summarizeResult(result),
      duration_ms: duration,
      success,
    })

    if (success) {
      if (name === 'swap_token' && (result as any).tx) {
        getNotificationPort()
          .notifySwap({
            inputSymbol: (args.input_mint as string)?.slice(0, 8),
            outputSymbol:
              (args.output_mint as string) === 'So11111111111111111111111111111111111111112' ||
              (args.output_mint as string) === 'SOL'
                ? 'SOL'
                : (args.output_mint as string)?.slice(0, 8),
            amountIn: (result as any).amount_in ?? String(args.amount ?? '?'),
            amountOut: (result as any).amount_out,
            tx: (result as any).tx,
            amountUsd: (result as any).usd_value ?? (result as any).amount_usd ?? null,
          })
          .catch((err: any) => {
            log('telegram_warn', `Failed to send swap notification: ${err?.message || err}`)
          })
      } else if (name === 'deploy_position') {
        const isSuccess = (result as any)?.success !== false && !(result as any)?.error && !(result as any)?.blocked
        if (!isSuccess) {
          getNotificationPort()
            .notifyTransactionError({
              type: 'deploy',
              pair:
                (result as any)?.pool_name || (args as any)?.pool_name || (args.pool_address as string)?.slice(0, 8),
              reason: (result as any)?.error || (result as any)?.reason || 'Deployment execution failed',
            })
            .catch((err: any) => {
              log('telegram_warn', `Failed to send deploy error notification: ${err?.message || err}`)
            })
        } else {
          getNotificationPort()
            .notifyDeploy({
              pair: (result as any).pool_name || (args as any).pool_name || (args.pool_address as string)?.slice(0, 8),
              amountSol: (args.amount_y as number) ?? (args.amount_sol as number) ?? 0,
              position: (result as any).position,
              tx: (result as any).txs?.[0] ?? (result as any).tx,
              priceRange: (result as any).price_range,
              rangeCoverage: (result as any).range_coverage,
              binStep: (result as any).bin_step,
              baseFee: (result as any).base_fee,
            })
            .catch((err: any) => {
              log('telegram_warn', `Failed to send deploy notification: ${err?.message || err}`)
            })
        }
      } else if (name === 'close_position') {
        const isSuccess = (result as any)?.success !== false && !(result as any)?.error && !(result as any)?.blocked
        if (!isSuccess) {
          getNotificationPort()
            .notifyTransactionError({
              type: 'close',
              pair: (result as any)?.pool_name || (args.position_address as string)?.slice(0, 8),
              position: args.position_address as string,
              reason: (result as any)?.error || (result as any)?.reason || 'Position close failed',
            })
            .catch((err: any) => {
              log('telegram_warn', `Failed to send close error notification: ${err?.message || err}`)
            })
        } else {
          // Note low-yield closes in pool memory so screener avoids redeploying
          if ((args.reason as string) && (args.reason as string).toLowerCase().includes('yield')) {
            const poolAddr = (result as any).pool || args.pool_address
            if (poolAddr)
              addPoolNote({
                pool_address: poolAddr,
                note: `Closed: low yield (fee/TVL below threshold) at ${new Date().toISOString().slice(0, 10)}`,
              })
          }

          const baseMint = (result as any).base_mint
          const hasBaseToken = baseMint && baseMint !== 'So11111111111111111111111111111111111111112'
          const posAddr = (args.position_address as string) || (result as any).position

          // Auto-swap base token back to SOL unless user said to hold (retried).
          if (!args.skip_swap && hasBaseToken) {
            const poolAddress = (result as any).pool || (args.pool_address as string)
            const { swapped, result: swapResult } = await swapBaseToSolWithRetry(
              baseMint,
              'after close',
              0.05,
              poolAddress,
              posAddr,
            )
            if (swapped) {
              ;(result as any).auto_swapped = true
              ;(result as any).auto_swap_note =
                `Base token already auto-swapped back to SOL (${baseMint.slice(0, 8)} → SOL). Do NOT call swap_token again.`
              if ((swapResult as any)?.amount_out) (result as any).sol_received = (swapResult as any).amount_out
            }
          }

          const isPending = hasBaseToken && !(result as any).auto_swapped
          getNotificationPort()
            .notifyClose({
              pair: (result as any).pool_name || (args.position_address as string)?.slice(0, 8),
              pnlUsd: (result as any).pnl_usd ?? 0,
              pnlPct: (result as any).pnl_pct ?? 0,
              status: isPending ? 'closed_pending_swap' : 'realized',
              solReceived: (result as any).sol_received,
            })
            .catch((err: any) => {
              log('telegram_warn', `Failed to send close notification: ${err?.message || err}`)
            })
        }
      } else if (name === 'claim_fees') {
        const isSuccess = (result as any)?.success !== false && !(result as any)?.error && !(result as any)?.blocked
        if (!isSuccess) {
          getNotificationPort()
            .notifyTransactionError({
              type: 'claim',
              position: args.position_address as string,
              reason: (result as any)?.error || (result as any)?.reason || 'Fee claim failed',
            })
            .catch((err: any) => {
              log('telegram_warn', `Failed to send claim error notification: ${err?.message || err}`)
            })
        } else if (getToolConfig().management.autoSwapAfterClaim && (result as any).base_mint) {
          const poolAddress = (result as any).pool || (args.pool_address as string)
          await swapBaseToSolWithRetry((result as any).base_mint, 'after claim', 0.05, poolAddress)
        }
      }
    }

    return result
  } catch (error: any) {
    const duration = Date.now() - startTime

    logAction({
      tool: name,
      args,
      error: error.message,
      duration_ms: duration,
      success: false,
    })

    if (['deploy_position', 'close_position', 'claim_fees', 'swap_token'].includes(name)) {
      const typeMap: Record<string, 'deploy' | 'close' | 'claim' | 'swap'> = {
        deploy_position: 'deploy',
        close_position: 'close',
        claim_fees: 'claim',
        swap_token: 'swap',
      }
      getNotificationPort()
        .notifyTransactionError({
          type: typeMap[name] || 'confirm',
          pair: (args.pool_name || args.pool_address) as string,
          position: args.position_address as string,
          reason: error.message,
        })
        .catch((err: any) => {
          log('telegram_warn', `Failed to send tool exception notification: ${err?.message || err}`)
        })
    }

    return {
      error: error.message,
      tool: name,
    }
  }
}

/**
 * Run safety checks before executing write operations.
 */

/**
 * Summarize a result for logging (truncate large responses).
 */
function summarizeResult(result: Record<string, unknown>): Record<string, unknown> | string {
  const str = JSON.stringify(result)
  if (str.length > 1000) {
    return `${str.slice(0, 1000)}...(truncated)`
  }
  return result
}

/**
 * Summarize tool args for structured logging — truncates long string values,
 * strips sensitive fields, and keeps only first-level keys.
 */
function summarizeArgsForLog(args: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {}
  const SENSITIVE_KEYS = new Set(['private_key', 'secret', 'api_key', 'apiKey', 'token'])
  for (const [key, value] of Object.entries(args)) {
    if (SENSITIVE_KEYS.has(key)) {
      summary[key] = '[REDACTED]'
    } else if (typeof value === 'string') {
      summary[key] = value.length > 100 ? `${value.slice(0, 100)}...` : value
    } else {
      summary[key] = value
    }
  }
  return summary
}
