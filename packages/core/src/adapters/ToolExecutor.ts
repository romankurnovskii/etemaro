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
import fs from 'node:fs';
import { execSync, spawn } from 'node:child_process';

// ─── Shared imports ────────────────────────────────────────────
import { config, reloadScreeningThresholds } from '../config/Config.js';
import { REPO_ROOT, configPath, MIN_SAFE_BINS_BELOW } from '../shared/constants.js';
import { log, logAction } from '../shared/logger.js';
import type { AppConfig, AgentRole } from '../shared/types.js';

// ─── Adapter imports ───────────────────────────────────────────
import { discoverPools, getPoolDetail, getTopCandidates } from './blockchain/ScreeningAdapter.js';
import {
  getActiveBin,
  deployPosition,
  getMyPositions,
  getWalletPositions,
  getPositionPnl,
  claimFees,
  closePosition,
  searchPools,
} from './blockchain/MeteoraAdapter.js';
import { getWalletBalances, swapToken } from './blockchain/WalletAdapter.js';
import { studyTopLPers } from './blockchain/StudyAdapter.js';
import { getTokenInfo, getTokenHolders, getTokenNarrative } from './blockchain/TokenDataAdapter.js';

// ─── JS module imports (no type declarations) ─────────────────
import {
  addLesson,
  clearAllLessons,
  clearPerformance,
  removeLessonsByKeyword,
  getPerformanceHistory,
  pinLesson,
  unpinLesson,
  listLessons,
} from '../domain/lessons.js';
import { setPositionInstruction } from '../domain/state.js';
import { getPoolMemory, addPoolNote } from '../domain/pool-memory.js';
import { addStrategy, listStrategies, getStrategy, setActiveStrategy, removeStrategy } from '../domain/strategy-library.js';
import { addToBlacklist, removeFromBlacklist, listBlacklist } from '../domain/token-blacklist.js';
import { blockDev, unblockDev, listBlockedDevs } from '../domain/dev-blocklist.js';
import { addSmartWallet, removeSmartWallet, listSmartWallets, checkSmartWalletsOnPool } from '../domain/smart-wallets.js';
import { getRecentDecisions } from '../domain/decision-log.js';
import { normalizeTimeframe, scaleScreeningToTimeframe } from '../shared/utils.js';
import { notifyDeploy, notifyClose, notifySwap } from './notifications/TelegramAdapter.js';

// ─── Constants ─────────────────────────────────────────────────

const USER_CONFIG_PATH = configPath('user-config.json');
const POOL_DISCOVERY_BASE = 'https://pool-discovery-api.datapi.meteora.ag';
const MIN_VOLATILITY_TIMEFRAME = '30m';
const TIMEFRAME_MINUTES: Record<string, number> = {
  '5m': 5,
  '30m': 30,
  '1h': 60,
  '2h': 120,
  '4h': 240,
  '12h': 720,
  '24h': 1440,
};

// ─── Helper functions ──────────────────────────────────────────

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getVolatilityTimeframe(sourceTimeframe: string | undefined): string {
  const source = String(sourceTimeframe || '').trim();
  const sourceMinutes = TIMEFRAME_MINUTES[source];
  const minMinutes = TIMEFRAME_MINUTES[MIN_VOLATILITY_TIMEFRAME]!;
  return sourceMinutes != null && sourceMinutes >= minMinutes ? source : MIN_VOLATILITY_TIMEFRAME;
}

function poolDetailTvl(pool: Record<string, unknown>): number | null {
  return numberOrNull((pool as any)?.tvl ?? (pool as any)?.active_tvl ?? (pool as any)?.liquidity);
}

function poolDetailBinStep(pool: Record<string, unknown>): number | null {
  return numberOrNull((pool as any)?.dlmm_params?.bin_step ?? (pool as any)?.pool_config?.bin_step);
}

function poolDetailFeeActiveTvlRatio(pool: Record<string, unknown>): number | null {
  return numberOrNull((pool as any)?.fee_active_tvl_ratio);
}

function poolDetailVolatility(pool: Record<string, unknown>): number | null {
  return numberOrNull((pool as any)?.volatility);
}

async function fetchFreshPoolDetail(
  poolAddress: string,
  timeframe: string = config.screening.timeframe || '5m',
): Promise<Record<string, unknown> | null> {
  const encodedTimeframe = encodeURIComponent(timeframe);
  const filter = encodeURIComponent(`pool_address=${poolAddress}`);
  const url = `${POOL_DISCOVERY_BASE}/pools?page_size=1&filter_by=${filter}&timeframe=${encodedTimeframe}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Pool Discovery API error: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as { data?: Record<string, unknown>[] };
  return (data?.data || [])[0] ?? null;
}

async function validateDeployPoolThresholds(args: Record<string, unknown>): Promise<{
  pass: boolean;
  reason?: string;
  entryMarketData?: Record<string, unknown>;
}> {
  let detail: Record<string, unknown> | null;
  try {
    detail = await fetchFreshPoolDetail(args.pool_address as string);
    if (!detail) throw new Error(`Pool ${args.pool_address} not found`);
  } catch (error: any) {
    return {
      pass: false,
      reason: `Could not verify pool screening thresholds before deploy: ${error.message}`,
    };
  }

  const tvl = poolDetailTvl(detail);
  const minTvl = numberOrNull(config.screening.minTvl);
  const maxTvl = numberOrNull(config.screening.maxTvl);
  if (tvl == null) {
    return {
      pass: false,
      reason: 'Could not verify pool TVL before deploy.',
    };
  }
  if (minTvl != null && minTvl > 0 && tvl < minTvl) {
    return {
      pass: false,
      reason: `Pool TVL $${tvl} is below configured minTvl $${minTvl}.`,
    };
  }
  if (maxTvl != null && maxTvl > 0 && tvl > maxTvl) {
    return {
      pass: false,
      reason: `Pool TVL $${tvl} is above configured maxTvl $${maxTvl}.`,
    };
  }

  const feeActiveTvlRatio = poolDetailFeeActiveTvlRatio(detail);
  const minFeeActiveTvlRatio = numberOrNull(config.screening.minFeeActiveTvlRatio);
  if (minFeeActiveTvlRatio != null && minFeeActiveTvlRatio > 0 && (feeActiveTvlRatio == null || feeActiveTvlRatio < minFeeActiveTvlRatio)) {
    return {
      pass: false,
      reason: `Pool fee/active-TVL ${feeActiveTvlRatio ?? 'unknown'}% is below configured minFeeActiveTvlRatio ${minFeeActiveTvlRatio}%.`,
    };
  }

  const volatilityTimeframe = getVolatilityTimeframe(config.screening.timeframe || '5m');
  let volatilityDetail = detail;
  if ((config.screening.timeframe || '5m') !== volatilityTimeframe) {
    try {
      volatilityDetail = (await fetchFreshPoolDetail(args.pool_address as string, volatilityTimeframe))!;
    } catch (error: any) {
      return {
        pass: false,
        reason: `Could not verify pool ${volatilityTimeframe} volatility before deploy: ${error.message}`,
      };
    }
  }

  const volatility = poolDetailVolatility(volatilityDetail);
  if (volatility == null || volatility <= 0) {
    return {
      pass: false,
      reason: `Pool ${volatilityTimeframe} volatility ${volatility ?? 'unknown'} is unusable. Refusing deploy.`,
    };
  }

  const actualBinStep = poolDetailBinStep(detail);
  const minStep = numberOrNull(config.screening.minBinStep);
  const maxStep = numberOrNull(config.screening.maxBinStep);
  if (actualBinStep != null && minStep != null && actualBinStep < minStep) {
    return {
      pass: false,
      reason: `Pool bin_step ${actualBinStep} is below configured minBinStep ${minStep}.`,
    };
  }
  if (actualBinStep != null && maxStep != null && actualBinStep > maxStep) {
    return {
      pass: false,
      reason: `Pool bin_step ${actualBinStep} is above configured maxBinStep ${maxStep}.`,
    };
  }

  const baseMint = (detail as any)?.token_x?.address || (detail as any)?.base_token_address || null;
  const entryMarketData: Record<string, unknown> = {
    entry_mcap: numberOrNull((detail as any)?.token_x?.market_cap ?? (detail as any)?.base_token_market_cap),
    entry_tvl: tvl,
    entry_volume: numberOrNull((detail as any)?.volume),
    entry_holders: numberOrNull((detail as any)?.base_token_holders ?? (detail as any)?.token_x?.holders),
  };

  return { pass: true, entryMarketData };
}

// ─── Cron restarter (registered by index.js) ───────────────────

let _cronRestarter: (() => void) | null = null;

export function registerCronRestarter(fn: () => void): void {
  _cronRestarter = fn;
}

// ─── Config coercion helpers ───────────────────────────────────

function coerceBoolean(value: unknown, key: string): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  throw new Error(`${key} must be true or false`);
}

function coerceFiniteNumber(value: unknown, key: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${key} must be a finite number`);
  return n;
}

function coerceString(value: unknown, key: string): string {
  if (typeof value !== 'string') throw new Error(`${key} must be a string`);
  return value.trim();
}

function coerceStringArray(value: unknown, key: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${key} must be an array of strings`);
  return value.map((entry: unknown) => coerceString(entry, key)).filter(Boolean);
}

function normalizeConfigValue(key: string, value: unknown): unknown {
  const booleanKeys = new Set([
    'excludeHighSupplyConcentration',
    'useDiscordSignals',
    'avoidPvpSymbols',
    'blockPvpSymbols',
    'autoSwapAfterClaim',
    'trailingTakeProfit',
    'solMode',
    'darwinEnabled',
    'lpAgentRelayEnabled',
  ]);
  const arrayKeys = new Set(['allowedLaunchpads', 'blockedLaunchpads']);
  const stringKeys = new Set([
    'timeframe',
    'category',
    'discordSignalMode',
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
  ]);
  if (value === null) return null;
  if (booleanKeys.has(key)) return coerceBoolean(value, key);
  if (arrayKeys.has(key)) return coerceStringArray(value, key);
  if (stringKeys.has(key)) return coerceString(value, key);
  return coerceFiniteNumber(value, key);
}

// ─── Tool map ──────────────────────────────────────────────────

type ToolFn = (args: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>;

const toolMap: Record<string, ToolFn> = {
  discover_pools: discoverPools as unknown as ToolFn,
  get_top_candidates: getTopCandidates as unknown as ToolFn,
  get_pool_detail: getPoolDetail as unknown as ToolFn,
  get_position_pnl: getPositionPnl as unknown as ToolFn,
  get_active_bin: getActiveBin as unknown as ToolFn,
  deploy_position: deployPosition as unknown as ToolFn,
  get_my_positions: getMyPositions as unknown as ToolFn,
  get_wallet_positions: getWalletPositions as unknown as ToolFn,
  search_pools: searchPools as unknown as ToolFn,
  get_token_info: getTokenInfo as unknown as ToolFn,
  get_token_holders: getTokenHolders as unknown as ToolFn,
  get_token_narrative: getTokenNarrative as unknown as ToolFn,
  add_smart_wallet: addSmartWallet as unknown as ToolFn,
  remove_smart_wallet: removeSmartWallet as unknown as ToolFn,
  list_smart_wallets: listSmartWallets as unknown as ToolFn,
  check_smart_wallets_on_pool: checkSmartWalletsOnPool as unknown as ToolFn,
  claim_fees: claimFees as unknown as ToolFn,
  close_position: closePosition as unknown as ToolFn,
  get_wallet_balance: getWalletBalances as unknown as ToolFn,
  swap_token: swapToken as unknown as ToolFn,
  get_top_lpers: studyTopLPers as unknown as ToolFn,
  study_top_lpers: studyTopLPers as unknown as ToolFn,
  set_position_note: ({ position_address, instruction }: Record<string, unknown>) => {
    const ok = setPositionInstruction(position_address as string, (instruction as string) || null);
    if (!ok) return { error: `Position ${position_address} not found in state` };
    return { saved: true, position: position_address, instruction: (instruction as string) || null };
  },
  self_update: async () => {
    try {
      const result = execSync('git pull', { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
      if (result.includes('Already up to date')) {
        return { success: true, updated: false, message: 'Already up to date — no restart needed.' };
      }
      setTimeout(() => {
        if (!process.env.pm_id) {
          const child = spawn(process.execPath, process.argv.slice(1), {
            detached: true,
            stdio: 'inherit',
            cwd: REPO_ROOT,
          });
          child.unref();
        }
        process.exit(0);
      }, 3000);
      const restartMode = process.env.pm_id ? 'PM2 detected — exiting in 3s so PM2 can restart the managed process.' : 'Restarting in 3s...';
      return { success: true, updated: true, message: `Updated! ${restartMode}\n${result}` };
    } catch (e: any) {
      return { success: false, error: e.message };
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
  add_lesson: ({ rule, tags, pinned, role }: Record<string, unknown>) => {
    addLesson(rule as string, (tags as string[]) || [], { pinned: !!pinned, role: (role as AgentRole) || null });
    return { saved: true, rule, pinned: !!pinned, role: (role as string) || 'all' };
  },
  pin_lesson: ({ id }: Record<string, unknown>) => pinLesson(Number(id)),
  unpin_lesson: ({ id }: Record<string, unknown>) => unpinLesson(Number(id)),
  list_lessons: ({ role, pinned, tag, limit }: Record<string, unknown> = {}) =>
    listLessons({ role: role as string | null, pinned: pinned as boolean | null, tag: tag as string | null, limit: limit as number }),
  clear_lessons: ({ mode, keyword }: Record<string, unknown>) => {
    if (mode === 'all') {
      const n = clearAllLessons();
      log('lessons', `Cleared all ${n} lessons`);
      return { cleared: n, mode: 'all' };
    }
    if (mode === 'performance') {
      const n = clearPerformance();
      log('lessons', `Cleared ${n} performance records`);
      return { cleared: n, mode: 'performance' };
    }
    if (mode === 'keyword') {
      if (!keyword) return { error: 'keyword required for mode=keyword' };
      const n = removeLessonsByKeyword(keyword as string);
      log('lessons', `Cleared ${n} lessons matching "${keyword}"`);
      return { cleared: n, mode: 'keyword', keyword };
    }
    return { error: 'invalid mode' };
  },
  update_config: ({ changes, reason = '' }: Record<string, unknown>) => {
    // Flat key → config section mapping (covers everything in config.js)
    const CONFIG_MAP: Record<string, [string, string, string[]?]> = {
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
      useDiscordSignals: ['screening', 'useDiscordSignals'],
      discordSignalMode: ['screening', 'discordSignalMode'],
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
      hiveMindUrl: ['hiveMind', 'url'],
      hiveMindApiKey: ['hiveMind', 'apiKey'],
      agentId: ['hiveMind', 'agentId'],
      hiveMindPullMode: ['hiveMind', 'pullMode'],
      // meridian api / relay
      publicApiKey: ['api', 'publicApiKey'],
      agentMeridianApiUrl: ['api', 'url'],
      lpAgentRelayEnabled: ['api', 'lpAgentRelayEnabled'],
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
    };

    const applied: Record<string, unknown> = {};
    const unknown: string[] = [];

    // Build case-insensitive lookup
    const CONFIG_MAP_LOWER = Object.fromEntries(Object.entries(CONFIG_MAP).map(([k, v]) => [k.toLowerCase(), [k, v]]));

    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
      return { success: false, error: 'changes must be an object', reason };
    }

    const STRATEGY_BIN_KEYS = new Set(['binsBelow', 'minBinsBelow', 'maxBinsBelow', 'defaultBinsBelow']);
    for (const [key, val] of Object.entries(changes as Record<string, unknown>)) {
      const raw = CONFIG_MAP[key] ? [key, CONFIG_MAP[key]] : CONFIG_MAP_LOWER[key.toLowerCase()];
      if (!raw) {
        unknown.push(key);
        continue;
      }
      const match = raw as [string, [string, string, string[]?]];
      try {
        let normalizedVal = val;
        if (STRATEGY_BIN_KEYS.has(match[0])) {
          const numericVal = Number(val);
          if (!Number.isFinite(numericVal)) {
            throw new Error(`${match[0]} must be a finite number`);
          }
          normalizedVal = Math.max(MIN_SAFE_BINS_BELOW, Math.round(numericVal));
        } else {
          normalizedVal = normalizeConfigValue(match[0], val);
        }
        applied[match[0]] = normalizedVal;
      } catch (error: any) {
        return { success: false, error: error.message, key: match[0], reason };
      }
    }

    if (Object.keys(applied).length === 0) {
      log('config', `update_config failed — unknown keys: ${JSON.stringify(unknown)}, raw changes: ${JSON.stringify(changes)}`);
      return { success: false, unknown, reason };
    }

    let userConfig: Record<string, unknown> = {};
    if (fs.existsSync(USER_CONFIG_PATH)) {
      try {
        userConfig = JSON.parse(fs.readFileSync(USER_CONFIG_PATH, 'utf8'));
      } catch (error: any) {
        return { success: false, error: `Invalid user-config.json: ${error.message}`, reason };
      }
    }

    // Auto-scale fee/volume when timeframe changes (unless user set them explicitly in same call).
    if (applied.timeframe != null && applied.minFeeActiveTvlRatio == null && applied.minVolume == null) {
      const tf = normalizeTimeframe(applied.timeframe as string);
      applied.timeframe = tf;
      const scaled = scaleScreeningToTimeframe(tf);
      applied.minFeeActiveTvlRatio = scaled.minFeeActiveTvlRatio;
      applied.minVolume = scaled.minVolume;
      applied._timeframeScaled = true;
      log('config', `timeframe ${tf} → auto-scaled minFeeActiveTvlRatio=${scaled.minFeeActiveTvlRatio}, minVolume=${scaled.minVolume}`);
    }

    // Apply to live config immediately after the persisted config is known-good.
    for (const [key, val] of Object.entries(applied)) {
      if (key.startsWith('_')) continue;
      const mapping = CONFIG_MAP[key];
      if (!mapping) continue;
      const [section, field] = mapping;
      const before = (config as any)[section][field];
      (config as any)[section][field] = val;
      log('config', `update_config: config.${section}.${field} ${before} → ${val} (verify: ${(config as any)[section][field]})`);
    }
    if (applied.binsBelow != null || applied.minBinsBelow != null || applied.maxBinsBelow != null || applied.defaultBinsBelow != null) {
      config.strategy.minBinsBelow = Math.max(MIN_SAFE_BINS_BELOW, Math.round(Number(config.strategy.minBinsBelow ?? MIN_SAFE_BINS_BELOW)));
      config.strategy.maxBinsBelow = Math.max(
        config.strategy.minBinsBelow,
        Math.round(Number(config.strategy.maxBinsBelow ?? config.strategy.minBinsBelow)),
      );
      config.strategy.defaultBinsBelow = Math.max(
        config.strategy.minBinsBelow,
        Math.min(config.strategy.maxBinsBelow, Math.round(Number(config.strategy.defaultBinsBelow ?? config.strategy.maxBinsBelow))),
      );
    }

    for (const [key, val] of Object.entries(applied)) {
      if (key.startsWith('_')) continue;
      const persistPath = CONFIG_MAP[key]?.[2];
      if (Array.isArray(persistPath) && persistPath.length > 0) {
        let target = userConfig;
        for (const part of persistPath.slice(0, -1)) {
          if (!target[part] || typeof target[part] !== 'object' || Array.isArray(target[part])) {
            target[part] = {};
          }
          target = target[part] as Record<string, unknown>;
        }
        target[persistPath.at(-1)!] = val;
      } else {
        userConfig[key] = val;
      }
    }
    userConfig._lastAgentTune = new Date().toISOString();
    fs.writeFileSync(USER_CONFIG_PATH, JSON.stringify(userConfig, null, 2));

    // Restart cron jobs if intervals changed
    const intervalChanged = applied.managementIntervalMin != null || applied.screeningIntervalMin != null || applied.pnlPollIntervalSec != null;
    if (intervalChanged && _cronRestarter) {
      _cronRestarter();
      log(
        'config',
        `Cron restarted — management: ${config.schedule.managementIntervalMin}m, screening: ${config.schedule.screeningIntervalMin}m, pnlPoll: ${config.pnl.pollIntervalSec}s`,
      );
    }

    // Skip repeated volatility-driven interval changes; they are operational tuning, not reusable lessons.
    const lessonsKeys = Object.keys(applied).filter((k) => !k.startsWith('_') && k !== 'managementIntervalMin' && k !== 'screeningIntervalMin');
    if (lessonsKeys.length > 0) {
      const summary = lessonsKeys.map((k) => `${k}=${applied[k]}`).join(', ');
      addLesson(`[SELF-TUNED] Changed ${summary} — ${reason}`, ['self_tune', 'config_change']);
    }

    log('config', `Agent self-tuned: ${JSON.stringify(applied)} — ${reason}`);
    return { success: true, applied, unknown, reason };
  },
};

// ─── Protected tools ───────────────────────────────────────────

const WRITE_TOOLS = new Set(['deploy_position', 'claim_fees', 'close_position', 'swap_token']);
const PROTECTED_TOOLS = new Set([...WRITE_TOOLS, 'self_update']);

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Swap a base token back to SOL with retry. Jupiter can transiently fail (no route,
 * quote error) and a single attempt silently leaves the token unsold — this retries
 * with a delay, re-fetching the balance each attempt (amounts can shift on partial
 * fills). Treats both a throw AND result.success===false / missing tx as failure.
 * Returns { swapped, result, token } — swapped=false if nothing to do or all attempts failed.
 */
async function swapBaseToSolWithRetry(
  baseMint: string,
  label: string,
): Promise<{
  swapped: boolean;
  result: Record<string, unknown> | null;
  token: Record<string, unknown> | null;
}> {
  const attempts = Math.max(1, Number(config.management.autoSwapRetryAttempts ?? 3));
  const delayMs = Math.max(0, Number(config.management.autoSwapRetryDelayMs ?? 3000));
  let lastErr: string | null = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const balances = await getWalletBalances();
      const token = balances.tokens?.find((t: any) => t.mint === baseMint);
      if (!token || (token.usd ?? 0) < 0.1) {
        return { swapped: attempt > 1, result: null, token: null };
      }
      log(
        'executor',
        `Auto-swapping ${label} ${token.symbol || baseMint.slice(0, 8)} ($${(token.usd ?? 0).toFixed(2)}) back to SOL (attempt ${attempt}/${attempts})`,
      );
      const swapResult = await swapToken({ input_mint: baseMint, output_mint: 'SOL', amount: token.balance });
      const sr = swapResult as any;
      const ok = swapResult && sr.success !== false && !sr.error && (sr.tx || sr.amount_out);
      if (ok) return { swapped: true, result: swapResult as unknown as Record<string, unknown>, token: token as unknown as Record<string, unknown> };
      lastErr = sr?.error || sr?.reason || 'swap returned no tx';
    } catch (e: any) {
      lastErr = e.message;
    }
    log('executor_warn', `Auto-swap ${label} attempt ${attempt}/${attempts} failed: ${lastErr}`);
    if (attempt < attempts) await sleep(delayMs);
  }
  log('executor_warn', `Auto-swap ${label} failed after ${attempts} attempts — base token left unsold (${baseMint.slice(0, 8)})`);
  return { swapped: false, result: null, token: null };
}

/**
 * Execute a tool call with safety checks and logging.
 */
export async function executeTool(name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const startTime = Date.now();

  // Strip model artifacts like "<|channel|>commentary" appended to tool names
  name = name.replace(/<.*$/, '').trim();

  // ─── Validate tool exists ─────────────────
  const fn = toolMap[name];
  if (!fn) {
    const error = `Unknown tool: ${name}`;
    log('error', error);
    return { error };
  }

  // ─── Pre-execution safety checks ──────────
  if (PROTECTED_TOOLS.has(name)) {
    const safetyCheck = await runSafetyChecks(name, args);
    if (!safetyCheck.pass) {
      log('safety_block', `${name} blocked: ${safetyCheck.reason}`);
      return {
        blocked: true,
        reason: safetyCheck.reason,
      };
    }
  }

  // ─── Execute ──────────────────────────────
  try {
    const result = await fn(args);
    const duration = Date.now() - startTime;
    const success = (result as any)?.success !== false && !(result as any)?.error;

    logAction({
      tool: name,
      args,
      result: summarizeResult(result),
      duration_ms: duration,
      success,
    });

    if (success) {
      if (name === 'swap_token' && (result as any).tx) {
        notifySwap({
          inputSymbol: (args.input_mint as string)?.slice(0, 8),
          outputSymbol:
            (args.output_mint as string) === 'So11111111111111111111111111111111111111112' || (args.output_mint as string) === 'SOL'
              ? 'SOL'
              : (args.output_mint as string)?.slice(0, 8),
          amountIn: (result as any).amount_in,
          amountOut: (result as any).amount_out,
          tx: (result as any).tx,
        }).catch(() => {});
      } else if (name === 'deploy_position') {
        notifyDeploy({
          pair: (result as any).pool_name || (args as any).pool_name || (args.pool_address as string)?.slice(0, 8),
          amountSol: (args.amount_y as number) ?? (args.amount_sol as number) ?? 0,
          position: (result as any).position,
          tx: (result as any).txs?.[0] ?? (result as any).tx,
          priceRange: (result as any).price_range,
          rangeCoverage: (result as any).range_coverage,
          binStep: (result as any).bin_step,
          baseFee: (result as any).base_fee,
        }).catch(() => {});
      } else if (name === 'close_position') {
        notifyClose({
          pair: (result as any).pool_name || (args.position_address as string)?.slice(0, 8),
          pnlUsd: (result as any).pnl_usd ?? 0,
          pnlPct: (result as any).pnl_pct ?? 0,
        }).catch(() => {});
        // Note low-yield closes in pool memory so screener avoids redeploying
        if ((args.reason as string) && (args.reason as string).toLowerCase().includes('yield')) {
          const poolAddr = (result as any).pool || args.pool_address;
          if (poolAddr)
            addPoolNote({ pool_address: poolAddr, note: `Closed: low yield (fee/TVL below threshold) at ${new Date().toISOString().slice(0, 10)}` });
        }
        // Auto-swap base token back to SOL unless user said to hold (retried).
        if (!args.skip_swap && (result as any).base_mint) {
          const { swapped, result: swapResult } = await swapBaseToSolWithRetry((result as any).base_mint, 'after close');
          if (swapped) {
            (result as any).auto_swapped = true;
            (result as any).auto_swap_note =
              `Base token already auto-swapped back to SOL (${(result as any).base_mint.slice(0, 8)} → SOL). Do NOT call swap_token again.`;
            if ((swapResult as any)?.amount_out) (result as any).sol_received = (swapResult as any).amount_out;
          }
        }
      } else if (name === 'claim_fees' && config.management.autoSwapAfterClaim && (result as any).base_mint) {
        await swapBaseToSolWithRetry((result as any).base_mint, 'after claim');
      }
    }

    return result;
  } catch (error: any) {
    const duration = Date.now() - startTime;

    logAction({
      tool: name,
      args,
      error: error.message,
      duration_ms: duration,
      success: false,
    });

    return {
      error: error.message,
      tool: name,
    };
  }
}

/**
 * Run safety checks before executing write operations.
 */
async function runSafetyChecks(
  name: string,
  args: Record<string, unknown>,
): Promise<{
  pass: boolean;
  reason?: string;
}> {
  switch (name) {
    case 'deploy_position': {
      const poolThresholds = await validateDeployPoolThresholds(args);
      if (!poolThresholds.pass) return poolThresholds;
      if (poolThresholds.entryMarketData) Object.assign(args, poolThresholds.entryMarketData);

      // Reject pools with bin_step out of configured range
      const minStep = config.screening.minBinStep;
      const maxStep = config.screening.maxBinStep;
      if (args.bin_step != null && ((args.bin_step as number) < minStep || (args.bin_step as number) > maxStep)) {
        return {
          pass: false,
          reason: `bin_step ${args.bin_step} is outside the allowed range of [${minStep}-${maxStep}].`,
        };
      }

      const deployAmountY = Number(args.amount_y ?? args.amount_sol ?? 0);
      const deployAmountX = Number(args.amount_x ?? 0);
      if (Number.isFinite(deployAmountX) && deployAmountX > 0) {
        return {
          pass: false,
          reason: 'This agent only supports single-side SOL deploys. Use amount_y/amount_sol and keep amount_x=0.',
        };
      }
      const requestedBinsBelow = Number(args.bins_below ?? config.strategy.defaultBinsBelow ?? config.strategy.minBinsBelow);
      const requestedBinsAbove = Number(args.bins_above ?? 0);
      const minBinsBelow = Math.max(MIN_SAFE_BINS_BELOW, Number(config.strategy.minBinsBelow ?? MIN_SAFE_BINS_BELOW));
      const isSingleSidedSol = deployAmountY > 0 && deployAmountX <= 0;
      const requestedTotalBins = requestedBinsBelow + requestedBinsAbove;
      const requestedVolatility = args.volatility == null ? null : Number(args.volatility);
      if (args.volatility != null && (!Number.isFinite(requestedVolatility!) || requestedVolatility! <= 0)) {
        return {
          pass: false,
          reason: `volatility ${args.volatility} is invalid. Refusing deploy because the volatility feed is unusable.`,
        };
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
        };
      }
      if (
        isSingleSidedSol &&
        args.downside_pct == null &&
        (!Number.isFinite(requestedBinsBelow) || !Number.isInteger(requestedBinsBelow) || requestedBinsBelow < minBinsBelow)
      ) {
        return {
          pass: false,
          reason: `bins_below ${args.bins_below ?? 'missing'} is below minimum ${minBinsBelow}. Refusing 1-bin/tiny-range deploy.`,
        };
      }
      if (
        isSingleSidedSol &&
        args.upside_pct == null &&
        (!Number.isFinite(requestedBinsAbove) || !Number.isInteger(requestedBinsAbove) || requestedBinsAbove !== 0)
      ) {
        return {
          pass: false,
          reason: 'Single-side SOL deploy must use bins_above=0.',
        };
      }

      // Check position count limit + duplicate pool guard — force fresh scan to avoid stale cache
      const positions = await getMyPositions({ force: true });
      if ((positions as any).total_positions >= config.risk.maxPositions) {
        return {
          pass: false,
          reason: `Max positions (${config.risk.maxPositions}) reached. Close a position first.`,
        };
      }
      const alreadyInPool = (positions as any).positions.some((p: any) => p.pool === args.pool_address);
      if (alreadyInPool) {
        return {
          pass: false,
          reason: `Already have an open position in pool ${args.pool_address}. Cannot open duplicate.`,
        };
      }

      // Block same base token across different pools
      if (args.base_mint) {
        const alreadyHasMint = (positions as any).positions.some((p: any) => p.base_mint === args.base_mint);
        if (alreadyHasMint) {
          return {
            pass: false,
            reason: `Already holding base token ${args.base_mint} in another pool. One position per token only.`,
          };
        }
      }

      // Check amount limits
      const amountY = deployAmountY;
      if (!Number.isFinite(amountY) || amountY <= 0) {
        return {
          pass: false,
          reason: `Must provide a positive SOL amount (amount_y).`,
        };
      }

      const minDeploy = Math.max(0.1, config.management.deployAmountSol);
      if (amountY < minDeploy) {
        return {
          pass: false,
          reason: `Amount ${amountY} SOL is below the minimum deploy amount (${minDeploy} SOL). Use at least ${minDeploy} SOL.`,
        };
      }
      if (amountY > config.risk.maxDeployAmount) {
        return {
          pass: false,
          reason: `SOL amount ${amountY} exceeds maximum allowed per position (${config.risk.maxDeployAmount}).`,
        };
      }

      // Check SOL balance
      if (process.env.DRY_RUN !== 'true') {
        const balance = await getWalletBalances();
        const gasReserve = config.management.gasReserve;
        const minRequired = amountY + gasReserve;
        if (balance.sol < minRequired) {
          return {
            pass: false,
            reason: `Insufficient SOL: have ${balance.sol} SOL, need ${minRequired} SOL (${amountY} deploy + ${gasReserve} gas reserve).`,
          };
        }
      }

      return { pass: true };
    }

    case 'swap_token': {
      return { pass: true };
    }

    case 'self_update': {
      if (process.env.ALLOW_SELF_UPDATE !== 'true') {
        return {
          pass: false,
          reason: 'self_update is disabled by default. Set ALLOW_SELF_UPDATE=true locally if you really want to enable it.',
        };
      }
      if (!process.stdin.isTTY) {
        return {
          pass: false,
          reason: 'self_update is only allowed from a local interactive TTY session, not from Telegram or background automation.',
        };
      }
      return { pass: true };
    }

    default:
      return { pass: true };
  }
}

/**
 * Summarize a result for logging (truncate large responses).
 */
function summarizeResult(result: Record<string, unknown>): Record<string, unknown> | string {
  const str = JSON.stringify(result);
  if (str.length > 1000) {
    return str.slice(0, 1000) + '...(truncated)';
  }
  return result;
}
