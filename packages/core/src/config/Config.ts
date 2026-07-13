/**
 * @file Config.ts
 * @description Runtime configuration loader that merges Zod-validated defaults with user-config.json and gmgn-config.json overrides.
 *
 * @features
 * - Defines Zod schemas for risk, screening, management, strategy, schedule, LLM, Darwin, tokens, HiveMind, APIs, PnL, opportunity, GMGN, Jupiter, and indicators
 * - Builds the singleton AppConfig from file-based overrides and environment variables
 * - Exposes computeDeployAmount and reloadScreeningThresholds for dynamic config updates
 *
 * @dependencies zod
 * @sideEffects Reads user-config.json and gmgn-config.json from disk; mutates process.env
 */
import fs from 'node:fs';
import { z } from 'zod';
import {
  type AppConfig,
  type ScreeningConfig,
  type ManagementConfig,
  type StrategyConfig,
  type ScheduleConfig,
  type LlmConfig,
  type DarwinConfig,
  type HiveMindConfig,
  type ApiConfig,
  type PnlConfig,
  type OpportunityConfig,
  type GmgnConfig,
  type JupiterConfig,
  type IndicatorConfig,
} from '../shared/types.js';
import {
  repoPath,
  dataPath,
  configPath,
  MIN_SAFE_BINS_BELOW,
  DEFAULT_HIVEMIND_URL,
  DEFAULT_AGENT_MERIDIAN_API_URL,
  DEFAULT_AGENT_MERIDIAN_PUBLIC_KEY,
  DEFAULT_HIVEMIND_API_KEY,
  TOKEN_MINTS,
} from '../shared/constants.js';
import { numericConfig, nonEmptyString, scaleScreeningToTimeframe } from '../shared/utils.js';

// ─── Zod Schemas ───────────────────────────────────────────────

const RiskSchema = z.object({
  maxPositions: z.number(),
  maxDeployAmount: z.number(),
});

const ScreeningSchema = z.object({
  excludeHighSupplyConcentration: z.boolean(),
  minFeeActiveTvlRatio: z.number(),
  minTvl: z.number(),
  maxTvl: z.number(),
  minVolume: z.number(),
  minOrganic: z.number(),
  minQuoteOrganic: z.number(),
  minHolders: z.number(),
  minMcap: z.number(),
  maxMcap: z.number(),
  minBinStep: z.number(),
  maxBinStep: z.number(),
  timeframe: z.string(),
  category: z.string(),
  minTokenFeesSol: z.number(),
  useDiscordSignals: z.boolean(),
  discordSignalMode: z.string(),
  avoidPvpSymbols: z.boolean(),
  blockPvpSymbols: z.boolean(),
  maxBotHoldersPct: z.number(),
  maxTop10Pct: z.number(),
  loneCandidateMinDegen: z.number(),
  allowedLaunchpads: z.array(z.string()),
  blockedLaunchpads: z.array(z.string()),
  minTokenAgeHours: z.number().nullable(),
  maxTokenAgeHours: z.number().nullable(),
});

const ManagementSchema = z.object({
  minClaimAmount: z.number(),
  autoSwapAfterClaim: z.boolean(),
  autoSwapRetryAttempts: z.number(),
  autoSwapRetryDelayMs: z.number(),
  outOfRangeBinsToClose: z.number(),
  outOfRangeWaitMinutes: z.number(),
  oorCooldownTriggerCount: z.number(),
  oorCooldownHours: z.number(),
  repeatDeployCooldownEnabled: z.boolean(),
  repeatDeployCooldownTriggerCount: z.number(),
  repeatDeployCooldownHours: z.number(),
  repeatDeployCooldownScope: z.string(),
  repeatDeployCooldownMinFeeEarnedPct: z.number(),
  minVolumeToRebalance: z.number(),
  stopLossPct: z.number(),
  takeProfitPct: z.number(),
  minFeePerTvl24h: z.number(),
  minAgeBeforeYieldCheck: z.number(),
  minSolToOpen: z.number(),
  deployAmountSol: z.number(),
  gasReserve: z.number(),
  positionSizePct: z.number(),
  trailingTakeProfit: z.boolean(),
  trailingTriggerPct: z.number(),
  trailingDropPct: z.number(),
  pnlSanityMaxDiffPct: z.number(),
  solMode: z.boolean(),
});

const ConfigSchema = z.object({
  risk: RiskSchema,
  screening: ScreeningSchema,
  management: ManagementSchema,
  strategy: z.object({
    strategy: z.string(),
    minBinsBelow: z.number(),
    maxBinsBelow: z.number(),
    defaultBinsBelow: z.number(),
  }),
  schedule: z.object({
    managementIntervalMin: z.number(),
    screeningIntervalMin: z.number(),
    healthCheckIntervalMin: z.number(),
  }),
  llm: z.object({
    temperature: z.number(),
    maxTokens: z.number(),
    maxSteps: z.number(),
    managementModel: z.string(),
    screeningModel: z.string(),
    generalModel: z.string(),
  }),
  darwin: z.object({
    enabled: z.boolean(),
    windowDays: z.number(),
    recalcEvery: z.number(),
    boostFactor: z.number(),
    decayFactor: z.number(),
    weightFloor: z.number(),
    weightCeiling: z.number(),
    minSamples: z.number(),
  }),
  tokens: z.object({
    SOL: z.string(),
    USDC: z.string(),
    USDT: z.string(),
  }),
  hiveMind: z.object({
    url: z.string().nullable(),
    apiKey: z.string().nullable(),
    agentId: z.string().nullable(),
    pullMode: z.string(),
  }),
  api: z.object({
    url: z.string().nullable(),
    publicApiKey: z.string().nullable(),
    lpAgentRelayEnabled: z.boolean(),
  }),
  pnl: z.object({
    rpcUrl: z.string(),
    source: z.string(),
    pollIntervalSec: z.number(),
    depositCacheTtlSec: z.number(),
    confirmTicks: z.number(),
  }),
  opportunity: z.object({
    enabled: z.boolean(),
    pollIntervalSec: z.number(),
    limit: z.number(),
    minScore: z.number(),
    smartWalletScoreBonus: z.number(),
    targetVolRatio: z.number(),
    targetLpCount: z.number(),
    targetFeeRatio: z.number(),
    targetLiquidity: z.number(),
  }),
  gmgn: z.object({
    apiKey: z.string().nullable(),
    baseUrl: z.string(),
    requestDelayMs: z.number(),
    maxRetries: z.number(),
    feeSource: z.string(),
  }),
  jupiter: z.object({
    apiKey: z.string(),
    referralAccount: z.string(),
    referralFeeBps: z.number(),
  }),
  indicators: z.object({
    enabled: z.boolean(),
    entryPreset: z.string(),
    exitPreset: z.string(),
    rsiLength: z.number(),
    intervals: z.array(z.string()),
    candles: z.number(),
    rsiOversold: z.number(),
    rsiOverbought: z.number(),
    requireAllIntervals: z.boolean(),
  }),
});

// ─── Config Builder ────────────────────────────────────────────

// Ensure data and config directories exist on initialization
try {
  const dDir = dataPath();
  const cDir = configPath();
  if (!fs.existsSync(dDir)) fs.mkdirSync(dDir, { recursive: true });
  if (!fs.existsSync(cDir)) fs.mkdirSync(cDir, { recursive: true });
} catch {
  // Ignore filesystem errors in initialization
}

const USER_CONFIG_PATH = configPath('user-config.json');
const GMGN_CONFIG_PATH = configPath('gmgn-config.json');

function readUserConfig(): Record<string, unknown> {
  if (!fs.existsSync(USER_CONFIG_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(USER_CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function readGmgnConfig(): Record<string, unknown> {
  if (!fs.existsSync(GMGN_CONFIG_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(GMGN_CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function buildBinsBelow(u: Record<string, unknown>) {
  const legacyBinsBelow = numericConfig(u.binsBelow);
  const configuredMinBinsBelow = numericConfig(u.minBinsBelow) ?? MIN_SAFE_BINS_BELOW;
  const configuredMaxBinsBelow = numericConfig(u.maxBinsBelow) ?? (legacyBinsBelow != null ? Math.max(legacyBinsBelow, configuredMinBinsBelow) : 69);
  const configuredDefaultBinsBelow = numericConfig(u.defaultBinsBelow) ?? legacyBinsBelow ?? configuredMaxBinsBelow;

  const strategyMinBinsBelow = Math.max(MIN_SAFE_BINS_BELOW, Math.round(configuredMinBinsBelow));
  const strategyMaxBinsBelow = Math.max(strategyMinBinsBelow, Math.round(configuredMaxBinsBelow));
  const strategyDefaultBinsBelow = Math.max(strategyMinBinsBelow, Math.min(strategyMaxBinsBelow, Math.round(configuredDefaultBinsBelow)));

  return {
    strategy: (u.strategy as string) ?? 'bid_ask',
    minBinsBelow: strategyMinBinsBelow,
    maxBinsBelow: strategyMaxBinsBelow,
    defaultBinsBelow: strategyDefaultBinsBelow,
  };
}

function applyUserConfigToEnv(u: Record<string, unknown>): void {
  if (u.rpcUrl) process.env.RPC_URL ||= u.rpcUrl as string;
  if (u.walletKey) process.env.WALLET_PRIVATE_KEY ||= u.walletKey as string;
  if (u.llmModel) process.env.LLM_MODEL ||= u.llmModel as string;
  if (u.llmBaseUrl) process.env.LLM_BASE_URL ||= u.llmBaseUrl as string;
  if (u.llmApiKey) process.env.LLM_API_KEY ||= u.llmApiKey as string;
  if (u.dryRun !== undefined) process.env.DRY_RUN ||= String(u.dryRun);
  if (u.publicApiKey) process.env.PUBLIC_API_KEY ||= u.publicApiKey as string;
  if (u.agentMeridianApiUrl) process.env.AGENT_MERIDIAN_API_URL ||= u.agentMeridianApiUrl as string;
  if (u.telegramChatId) process.env.TELEGRAM_CHAT_ID ||= String(u.telegramChatId);
}

function buildConfig(): AppConfig {
  const u = readUserConfig();
  const gmgnCfg = readGmgnConfig();
  const indicatorUserConfig = (u.chartIndicators ?? {}) as Record<string, unknown>;

  applyUserConfigToEnv(u);

  if (gmgnCfg.apiKey || u.gmgnApiKey) {
    process.env.GMGN_API_KEY ||= (gmgnCfg.apiKey || u.gmgnApiKey) as string;
  }

  const binsBelow = buildBinsBelow(u);

  // Per-timeframe screening floors. A 5m window yields a tiny fee/active-TVL
  // snapshot, so the gate must scale with the timeframe (see TIMEFRAME_SCREENING_SCALES).
  // Explicit user values in user-config.json still win over these defaults.
  const scaledScreening = scaleScreeningToTimeframe(u.timeframe as string | undefined);

  return {
    risk: {
      maxPositions: (u.maxPositions as number) ?? 3,
      maxDeployAmount: (u.maxDeployAmount as number) ?? 50,
    },
    screening: {
      excludeHighSupplyConcentration: (u.excludeHighSupplyConcentration as boolean) ?? true,
      minFeeActiveTvlRatio: (u.minFeeActiveTvlRatio as number) ?? scaledScreening.minFeeActiveTvlRatio,
      minTvl: (u.minTvl as number) ?? 10_000,
      maxTvl: u.maxTvl !== undefined ? (u.maxTvl as number) : 150_000,
      minVolume: (u.minVolume as number) ?? scaledScreening.minVolume,
      minOrganic: (u.minOrganic as number) ?? 60,
      minQuoteOrganic: (u.minQuoteOrganic as number) ?? 60,
      minHolders: (u.minHolders as number) ?? 500,
      minMcap: (u.minMcap as number) ?? 150_000,
      maxMcap: (u.maxMcap as number) ?? 10_000_000,
      minBinStep: (u.minBinStep as number) ?? 80,
      maxBinStep: (u.maxBinStep as number) ?? 125,
      timeframe: (u.timeframe as string) ?? '5m',
      category: (u.category as string) ?? 'trending',
      minTokenFeesSol: (u.minTokenFeesSol as number) ?? 30,
      useDiscordSignals: (u.useDiscordSignals as boolean) ?? false,
      discordSignalMode: (u.discordSignalMode as string) ?? 'merge',
      avoidPvpSymbols: (u.avoidPvpSymbols as boolean) ?? true,
      blockPvpSymbols: (u.blockPvpSymbols as boolean) ?? false,
      maxBotHoldersPct: (u.maxBotHoldersPct as number) ?? 30,
      maxTop10Pct: (u.maxTop10Pct as number) ?? 60,
      loneCandidateMinDegen: (u.loneCandidateMinDegen as number) ?? 50,
      allowedLaunchpads: (u.allowedLaunchpads as string[]) ?? [],
      blockedLaunchpads: (u.blockedLaunchpads as string[]) ?? [],
      minTokenAgeHours: (u.minTokenAgeHours as number | null) ?? null,
      maxTokenAgeHours: (u.maxTokenAgeHours as number | null) ?? null,
    },
    management: {
      minClaimAmount: (u.minClaimAmount as number) ?? 5,
      autoSwapAfterClaim: (u.autoSwapAfterClaim as boolean) ?? false,
      autoSwapRetryAttempts: (u.autoSwapRetryAttempts as number) ?? 3,
      autoSwapRetryDelayMs: (u.autoSwapRetryDelayMs as number) ?? 3000,
      outOfRangeBinsToClose: (u.outOfRangeBinsToClose as number) ?? 10,
      outOfRangeWaitMinutes: (u.outOfRangeWaitMinutes as number) ?? 30,
      oorCooldownTriggerCount: (u.oorCooldownTriggerCount as number) ?? 3,
      oorCooldownHours: (u.oorCooldownHours as number) ?? 12,
      repeatDeployCooldownEnabled: (u.repeatDeployCooldownEnabled as boolean) ?? true,
      repeatDeployCooldownTriggerCount: (u.repeatDeployCooldownTriggerCount as number) ?? 3,
      repeatDeployCooldownHours: (u.repeatDeployCooldownHours as number) ?? 12,
      repeatDeployCooldownScope: (u.repeatDeployCooldownScope as string) ?? 'token',
      repeatDeployCooldownMinFeeEarnedPct: (u.repeatDeployCooldownMinFeeEarnedPct as number) ?? 0,
      minVolumeToRebalance: (u.minVolumeToRebalance as number) ?? 1000,
      stopLossPct: (u.stopLossPct as number) ?? -50,
      takeProfitPct: (u.takeProfitPct as number) ?? 5,
      minFeePerTvl24h: (u.minFeePerTvl24h as number) ?? 7,
      minAgeBeforeYieldCheck: (u.minAgeBeforeYieldCheck as number) ?? 60,
      minSolToOpen: (u.minSolToOpen as number) ?? 0.55,
      deployAmountSol: (u.deployAmountSol as number) ?? 0.5,
      gasReserve: (u.gasReserve as number) ?? 0.2,
      positionSizePct: (u.positionSizePct as number) ?? 0.35,
      trailingTakeProfit: (u.trailingTakeProfit as boolean) ?? true,
      trailingTriggerPct: (u.trailingTriggerPct as number) ?? 3,
      trailingDropPct: (u.trailingDropPct as number) ?? 1.5,
      pnlSanityMaxDiffPct: (u.pnlSanityMaxDiffPct as number) ?? 5,
      solMode: (u.solMode as boolean) ?? false,
    },
    strategy: binsBelow,
    schedule: {
      managementIntervalMin: (u.managementIntervalMin as number) ?? 10,
      screeningIntervalMin: (u.screeningIntervalMin as number) ?? 30,
      healthCheckIntervalMin: (u.healthCheckIntervalMin as number) ?? 60,
    },
    llm: {
      temperature: (u.temperature as number) ?? 0.373,
      maxTokens: (u.maxTokens as number) ?? 4096,
      maxSteps: (u.maxSteps as number) ?? 20,
      // TODO set propper models
      managementModel: (u.managementModel as string) ?? process.env.LLM_MODEL ?? 'openrouter/healer-alpha',
      screeningModel: (u.screeningModel as string) ?? process.env.LLM_MODEL ?? 'openrouter/hunter-alpha',
      generalModel: (u.generalModel as string) ?? process.env.LLM_MODEL ?? 'openrouter/healer-alpha',
    },
    darwin: {
      enabled: (u.darwinEnabled as boolean) ?? true,
      windowDays: (u.darwinWindowDays as number) ?? 60,
      recalcEvery: (u.darwinRecalcEvery as number) ?? 5,
      boostFactor: (u.darwinBoost as number) ?? 1.05,
      decayFactor: (u.darwinDecay as number) ?? 0.95,
      weightFloor: (u.darwinFloor as number) ?? 0.3,
      weightCeiling: (u.darwinCeiling as number) ?? 2.5,
      minSamples: (u.darwinMinSamples as number) ?? 10,
    },
    tokens: { ...TOKEN_MINTS },
    hiveMind: {
      url: nonEmptyString(u.hiveMindUrl, DEFAULT_HIVEMIND_URL),
      apiKey: nonEmptyString(u.hiveMindApiKey, process.env.HIVEMIND_API_KEY, DEFAULT_HIVEMIND_API_KEY),
      agentId: (u.agentId as string) ?? null,
      pullMode: (u.hiveMindPullMode as string) ?? 'auto',
    },
    api: {
      url: nonEmptyString(u.agentMeridianApiUrl, process.env.AGENT_MERIDIAN_API_URL, DEFAULT_AGENT_MERIDIAN_API_URL),
      publicApiKey: nonEmptyString(u.publicApiKey, process.env.PUBLIC_API_KEY, DEFAULT_AGENT_MERIDIAN_PUBLIC_KEY),
      lpAgentRelayEnabled: (u.lpAgentRelayEnabled as boolean) ?? false,
    },
    pnl: {
      rpcUrl: nonEmptyString(u.pnlRpcUrl, process.env.PNL_RPC_URL, 'https://pump.helius-rpc.com')!,
      source: nonEmptyString(u.pnlSource, 'rpc')!,
      pollIntervalSec: Number(u.pnlPollIntervalSec ?? 3),
      depositCacheTtlSec: Number(u.pnlDepositCacheTtlSec ?? 300),
      confirmTicks: Number(u.pnlConfirmTicks ?? 2),
    },
    opportunity: {
      enabled: (u.opportunityPollEnabled as boolean) ?? true,
      pollIntervalSec: Number(u.opportunityPollIntervalSec ?? 45),
      limit: Number(u.opportunityPollLimit ?? 10),
      minScore: Number(u.opportunityMinScore ?? 40),
      smartWalletScoreBonus: Number(u.opportunitySmartWalletBonus ?? 20),
      targetVolRatio: Number(u.degenTargetVolRatio ?? 20),
      targetLpCount: Number(u.degenTargetLpCount ?? 40),
      targetFeeRatio: Number(u.degenTargetFeeRatio ?? 0.2),
      targetLiquidity: Number(u.degenTargetLiquidity ?? 20000),
    },
    gmgn: {
      apiKey: nonEmptyString(gmgnCfg.apiKey, u.gmgnApiKey, process.env.GMGN_API_KEY),
      baseUrl: nonEmptyString(gmgnCfg.baseUrl, u.gmgnBaseUrl, 'https://openapi.gmgn.ai')!,
      requestDelayMs: Number(gmgnCfg.requestDelayMs ?? (u.gmgnRequestDelayMs as number) ?? 2500),
      maxRetries: Number(gmgnCfg.maxRetries ?? (u.gmgnMaxRetries as number) ?? 2),
      feeSource: nonEmptyString(gmgnCfg.feeSource, u.gmgnFeeSource, 'gmgn')!,
    },
    jupiter: {
      apiKey: process.env.JUPITER_API_KEY ?? '',
      referralAccount: process.env.JUPITER_REFERRAL_ACCOUNT ?? '', // TODO could be public address
      referralFeeBps: Number(process.env.JUPITER_REFERRAL_FEE_BPS ?? 50),
    },
    indicators: {
      enabled: (indicatorUserConfig.enabled as boolean) ?? false,
      entryPreset: (indicatorUserConfig.entryPreset as string) ?? 'supertrend_break',
      exitPreset: (indicatorUserConfig.exitPreset as string) ?? 'supertrend_break',
      rsiLength: (indicatorUserConfig.rsiLength as number) ?? 2,
      intervals: Array.isArray(indicatorUserConfig.intervals) ? (indicatorUserConfig.intervals as string[]) : ['5_MINUTE'],
      candles: (indicatorUserConfig.candles as number) ?? 298,
      rsiOversold: (indicatorUserConfig.rsiOversold as number) ?? 30,
      rsiOverbought: (indicatorUserConfig.rsiOverbought as number) ?? 80,
      requireAllIntervals: (indicatorUserConfig.requireAllIntervals as boolean) ?? false,
    },
  };
}

// ─── Singleton ─────────────────────────────────────────────────

export const config: AppConfig = buildConfig();

/**
 * Compute the optimal deploy amount for a given wallet balance.
 * Scales position size with wallet growth (compounding).
 */
export function computeDeployAmount(walletSol: number): number {
  const reserve = config.management.gasReserve;
  const pct = config.management.positionSizePct;
  const floor = config.management.deployAmountSol;
  const ceil = config.risk.maxDeployAmount;
  const deployable = Math.max(0, walletSol - reserve);
  const dynamic = deployable * pct;
  const result = Math.min(ceil, Math.max(floor, dynamic));
  return parseFloat(result.toFixed(2));
}

/**
 * Reload user-config.json and apply updated screening thresholds to the
 * in-memory config object. Called after threshold evolution.
 */
export function reloadScreeningThresholds(): void {
  try {
    if (!fs.existsSync(USER_CONFIG_PATH)) return;
    const fresh = JSON.parse(fs.readFileSync(USER_CONFIG_PATH, 'utf8')) as Record<string, unknown>;
    const s = config.screening;

    if (fresh.minFeeActiveTvlRatio != null) s.minFeeActiveTvlRatio = fresh.minFeeActiveTvlRatio as number;
    if (fresh.minTokenFeesSol != null) s.minTokenFeesSol = fresh.minTokenFeesSol as number;
    if (fresh.maxTop10Pct != null) s.maxTop10Pct = fresh.maxTop10Pct as number;
    if (fresh.useDiscordSignals !== undefined) s.useDiscordSignals = fresh.useDiscordSignals as boolean;
    if (fresh.discordSignalMode != null) s.discordSignalMode = fresh.discordSignalMode as string;
    if (fresh.excludeHighSupplyConcentration !== undefined) s.excludeHighSupplyConcentration = fresh.excludeHighSupplyConcentration as boolean;
    if (fresh.minOrganic != null) s.minOrganic = fresh.minOrganic as number;
    if (fresh.minQuoteOrganic != null) s.minQuoteOrganic = fresh.minQuoteOrganic as number;
    if (fresh.minHolders != null) s.minHolders = fresh.minHolders as number;
    if (fresh.minMcap != null) s.minMcap = fresh.minMcap as number;
    if (fresh.maxMcap != null) s.maxMcap = fresh.maxMcap as number;
    if (fresh.minTvl != null) s.minTvl = fresh.minTvl as number;
    if (fresh.maxTvl !== undefined) s.maxTvl = fresh.maxTvl as number;
    if (fresh.minVolume != null) s.minVolume = fresh.minVolume as number;
    if (fresh.minBinStep != null) s.minBinStep = fresh.minBinStep as number;
    if (fresh.maxBinStep != null) s.maxBinStep = fresh.maxBinStep as number;
    if (fresh.timeframe != null) s.timeframe = fresh.timeframe as string;
    if (fresh.category != null) s.category = fresh.category as string;
    if (fresh.minTokenAgeHours !== undefined) s.minTokenAgeHours = fresh.minTokenAgeHours as number | null;
    if (fresh.maxTokenAgeHours !== undefined) s.maxTokenAgeHours = fresh.maxTokenAgeHours as number | null;
    if (fresh.avoidPvpSymbols !== undefined) s.avoidPvpSymbols = fresh.avoidPvpSymbols as boolean;
    if (fresh.blockPvpSymbols !== undefined) s.blockPvpSymbols = fresh.blockPvpSymbols as boolean;
    if (fresh.maxBotHoldersPct != null) s.maxBotHoldersPct = fresh.maxBotHoldersPct as number;
    if (fresh.allowedLaunchpads !== undefined) s.allowedLaunchpads = fresh.allowedLaunchpads as string[];
    if (fresh.blockedLaunchpads !== undefined) s.blockedLaunchpads = fresh.blockedLaunchpads as string[];

    const minBinsBelow = numericConfig(fresh.minBinsBelow) ?? config.strategy.minBinsBelow;
    const maxBinsBelow = numericConfig(fresh.maxBinsBelow) ?? numericConfig(fresh.binsBelow) ?? config.strategy.maxBinsBelow;
    const defaultBinsBelow =
      numericConfig(fresh.defaultBinsBelow) ?? numericConfig(fresh.binsBelow) ?? config.strategy.defaultBinsBelow ?? maxBinsBelow;
    config.strategy.minBinsBelow = Math.max(MIN_SAFE_BINS_BELOW, Math.round(minBinsBelow));
    config.strategy.maxBinsBelow = Math.max(config.strategy.minBinsBelow, Math.round(maxBinsBelow));
    config.strategy.defaultBinsBelow = Math.max(config.strategy.minBinsBelow, Math.min(config.strategy.maxBinsBelow, Math.round(defaultBinsBelow)));
  } catch {
    /* ignore */
  }
}
