/**
 * @file Config.ts
 * @description Single-source configuration loader, environment resolver, and runtime settings manager.
 *
 * @features
 * - Loads user-config.json and resolves env variable references
 * - Validates schema using Zod
 * - Exposes singleton `config` object and config mutation helpers
 *
 */

import fs from 'node:fs';
import type { AppConfig } from '../shared/types.js';
import {
  repoPath,
  dataPath,
  USER_CONFIG_PATH,
  MIN_SAFE_BINS_BELOW,
  TOKEN_MINTS,
  setMinSafeBinsBelowOverride,
  DEFAULT_LLM_BASE_URL,
} from '../shared/constants.js';
import { loadAndValidateConfig, isHelpOrInfoCommand } from './ConfigValidator.js';
import { DEFAULT_USER_CONFIG, defaultUserConfigStr } from './defaultUserConfig.js';
import type { ValidatedUserConfig } from './schema.js';
import { numericConfig, resolveEnvString } from '../shared/utils.js';

export class ConfigLoadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ConfigLoadError';
  }
}

function applyUserConfigToEnv(u: ValidatedUserConfig): void {
  const connection = u.connection;
  if (connection?.rpcUrl) process.env.RPC_URL ||= connection?.rpcUrl;
  if (connection?.walletPrivateKey) process.env.WALLET_PRIVATE_KEY ||= connection?.walletPrivateKey;
  if (connection?.heliusApiKey) process.env.HELIUS_API_KEY ||= connection.heliusApiKey;
  if (connection?.telegramBotToken) process.env.TELEGRAM_BOT_TOKEN ||= connection.telegramBotToken;
  if (connection?.telegramAllowedUserIds) process.env.TELEGRAM_ALLOWED_USER_IDS ||= connection.telegramAllowedUserIds;
  if (u.llm?.defaultModel || u.llm?.managementModel) {
    process.env.LLM_MODEL ||= u.llm?.defaultModel || u.llm?.managementModel;
  }
  if (u.llm?.baseUrl) process.env.LLM_BASE_URL ||= u.llm?.baseUrl;
  if (u.llm?.apiKey) process.env.LLM_API_KEY ||= u.llm?.apiKey;
  if (connection?.dryRun !== undefined) process.env.DRY_RUN ||= String(connection.dryRun);
  if (connection?.telegramChatId) process.env.TELEGRAM_CHAT_ID ||= connection.telegramChatId;
  const meridian = u.api?.meridian;
  const lpAgent = u.api?.lpAgent;
  if (meridian?.enabled !== false && meridian?.publicApiKey) {
    process.env.AGENT_MERIDIAN_PUBLIC_API_KEY ||= meridian?.publicApiKey;
  }
  if (meridian?.enabled !== false && meridian?.url) {
    process.env.AGENT_MERIDIAN_API_URL ||= meridian?.url;
  }
  if (lpAgent?.apiKey) process.env.LPAGENT_API_KEY ||= lpAgent.apiKey;
  if (lpAgent?.url) process.env.LPAGENT_API_URL ||= lpAgent.url;
}

function buildConfig(): AppConfig {
  let loaded: Partial<ValidatedUserConfig> = {};
  try {
    loaded = loadAndValidateConfig();
  } catch (err: any) {
    if (isHelpOrInfoCommand()) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[config] Warning: using fallback defaults for info/init: ${err.message}`);
      }
    } else {
      const explicitConfig = process.env.USER_CONFIG_PATH?.trim();
      const message = explicitConfig
        ? `[config] Fatal: Failed to load explicit configuration from USER_CONFIG_PATH="${explicitConfig}": ${err.message}`
        : `[config] Fatal: Failed to load configuration: ${err.message}`;
      throw new ConfigLoadError(message, { cause: err });
    }
  }

  const defaultFallback = DEFAULT_USER_CONFIG as unknown as ValidatedUserConfig;
  const u = {
    ...defaultFallback,
    ...loaded,
    connection: { ...defaultFallback.connection, ...loaded.connection },
    risk: { ...defaultFallback.risk, ...loaded.risk },
    screening: { ...defaultFallback.screening, ...loaded.screening },
    management: { ...defaultFallback.management, ...loaded.management },
    strategy: { ...defaultFallback.strategy, ...loaded.strategy },
    api: {
      ...defaultFallback.api,
      ...loaded.api,
      meridian: { ...defaultFallback.api?.meridian, ...loaded.api?.meridian },
      lpAgent: { ...defaultFallback.api?.lpAgent, ...loaded.api?.lpAgent },
    },
    llm: { ...defaultFallback.llm, ...loaded.llm },
    chartIndicators: { ...defaultFallback.chartIndicators, ...loaded.chartIndicators },
  } as unknown as ValidatedUserConfig;

  applyUserConfigToEnv(u);

  // The shape of u now closely matches AppConfig since Zod validates the nested structure.
  return {
    _version: u._version ?? 3,
    agentId: u.agentId ?? null,
    connection: {
      rpcUrl: u.connection?.rpcUrl,
      walletPrivateKey: u.connection?.walletPrivateKey,
      heliusApiKey: u.connection?.heliusApiKey ?? null,
      telegramBotToken: u.connection?.telegramBotToken ?? null,
      telegramChatId: u.connection?.telegramChatId ?? null,
      telegramAllowedUserIds: u.connection?.telegramAllowedUserIds ?? null,
      dryRun: u.connection?.dryRun ?? false,
    },
    risk: {
      maxPositions: u.risk.maxPositions,
      maxDeployAmount: u.risk.maxDeployAmount,
    },
    screening: {
      entrySource: u.screening.entrySource,
      excludeHighSupplyConcentration: u.screening.excludeHighSupplyConcentration,
      minFeeActiveTvlRatio: u.screening.minFeeActiveTvlRatio,
      minTvl: u.screening.minTvl,
      maxTvl: u.screening.maxTvl,
      minVolume: u.screening.minVolume,
      minOrganic: u.screening.minOrganic,
      minQuoteOrganic: u.screening.minQuoteOrganic,
      minHolders: u.screening.minHolders,
      minMcap: u.screening.minMcap,
      maxMcap: u.screening.maxMcap,
      minBinStep: u.screening.minBinStep,
      maxBinStep: u.screening.maxBinStep,
      timeframe: u.screening.timeframe,
      category: u.screening.category,
      minTokenFeesSol: u.screening.minTokenFeesSol,
      useDiscordSignals: u.screening.useDiscordSignals,
      discordSignalMode: u.screening.discordSignalMode,
      avoidPvpSymbols: u.screening.avoidPvpSymbols,
      blockPvpSymbols: u.screening.blockPvpSymbols,
      maxBotHoldersPct: u.screening.maxBotHoldersPct,
      maxTop10Pct: u.screening.maxTop10Pct,
      loneCandidateMinDegen: u.screening.loneCandidateMinDegen,
      allowedLaunchpads: u.screening.allowedLaunchpads,
      blockedLaunchpads: u.screening.blockedLaunchpads,
      minTokenAgeHours: u.screening.minTokenAgeHours,
      maxTokenAgeHours: u.screening.maxTokenAgeHours,
    },
    management: {
      minClaimAmount: u.management.minClaimAmount,
      autoSwapAfterClaim: u.management.autoSwapAfterClaim,
      autoSwapRetryAttempts: u.management.autoSwapRetryAttempts,
      autoSwapRetryDelayMs: u.management.autoSwapRetryDelayMs,
      autoSwapInterSwapDelayMs: u.management.autoSwapInterSwapDelayMs,
      haltOnSwapFailure: u.management.haltOnSwapFailure,
      maxFailedSwapsBeforeHalt: u.management.maxFailedSwapsBeforeHalt,
      outOfRangeBinsToClose: u.management.outOfRangeBinsToClose,
      outOfRangeWaitMinutes: u.management.outOfRangeWaitMinutes,
      oorCooldownTriggerCount: u.management.oorCooldownTriggerCount,
      oorCooldownHours: u.management.oorCooldownHours,
      repeatDeployCooldownEnabled: u.management.repeatDeployCooldownEnabled,
      repeatDeployCooldownTriggerCount: u.management.repeatDeployCooldownTriggerCount,
      repeatDeployCooldownHours: u.management.repeatDeployCooldownHours,
      repeatDeployCooldownScope: u.management.repeatDeployCooldownScope,
      repeatDeployCooldownMinFeeEarnedPct: u.management.repeatDeployCooldownMinFeeEarnedPct,
      minVolumeToRebalance: u.management.minVolumeToRebalance,
      stopLossPct: u.management.stopLossPct,
      takeProfitPct: u.management.takeProfitPct,
      minFeePerTvl24h: u.management.minFeePerTvl24h,
      minAgeBeforeYieldCheck: u.management.minAgeBeforeYieldCheck,
      minSolToOpen: u.management.minSolToOpen,
      deployAmountSol: u.management.deployAmountSol,
      gasReserve: u.management.gasReserve,
      positionSizePct: u.management.positionSizePct,
      trailingTakeProfit: u.management.trailingTakeProfit,
      trailingTriggerPct: u.management.trailingTriggerPct,
      trailingDropPct: u.management.trailingDropPct,
      pnlSanityMaxDiffPct: u.management.pnlSanityMaxDiffPct,
      solMode: u.management.solMode,
    },
    strategy: {
      activeStrategyId: u.strategy.activeStrategyId,
      strategyMeteora: u.strategy.strategyMeteora,
      minBinsBelow: u.strategy.minBinsBelow,
      maxBinsBelow: u.strategy.maxBinsBelow,
      defaultBinsBelow: u.strategy.defaultBinsBelow,
      minSafeBinsBelow: u.strategy.minSafeBinsBelow,
    },
    schedule: {
      managementIntervalMin: u.schedule.managementIntervalMin,
      screeningIntervalMin: u.schedule.screeningIntervalMin,
      healthCheckIntervalMin: u.schedule.healthCheckIntervalMin,
    },
    llm: {
      temperature: u.llm.temperature,
      maxTokens: u.llm.maxTokens,
      maxSteps: u.llm.maxSteps,
      defaultModel: u.llm.defaultModel,
      managementModel: u.llm.managementModel,
      screeningModel: u.llm.screeningModel,
      generalModel: u.llm.generalModel,
      baseUrl: process.env.LLM_BASE_URL || u.llm.baseUrl || DEFAULT_LLM_BASE_URL,
      apiKey: process.env.LLM_API_KEY || u.llm.apiKey || '',
    },
    darwin: {
      enabled: u.darwin.enabled,
      windowDays: u.darwin.windowDays,
      recalcEvery: u.darwin.recalcEvery,
      boostFactor: u.darwin.boostFactor,
      decayFactor: u.darwin.decayFactor,
      weightFloor: u.darwin.weightFloor,
      weightCeiling: u.darwin.weightCeiling,
      minSamples: u.darwin.minSamples,
    },
    tokens: { ...TOKEN_MINTS },
    hiveMind: {
      enabled: u.hiveMind.enabled,
      url: u.hiveMind.url ?? null,
      apiKey: process.env.HIVEMIND_API_KEY || (u.hiveMind.apiKey ?? null),
      agentId: u.hiveMind.agentId ?? null,
      pullMode: u.hiveMind.pullMode,
    },
    api: {
      meridian: {
        enabled: u.api.meridian?.enabled ?? true,
        url: (process.env.AGENT_MERIDIAN_API_URL || u.api.meridian?.url) ?? null,
        publicApiKey: (process.env.AGENT_MERIDIAN_PUBLIC_API_KEY || u.api.meridian?.publicApiKey) ?? null,
        lpAgentRelayEnabled: u.api.meridian?.lpAgentRelayEnabled ?? false,
      },
      lpAgent: {
        enabled: u.api.lpAgent?.enabled ?? false,
        url: (process.env.LPAGENT_API_URL || u.api.lpAgent?.url) ?? null,
        apiKey: (process.env.LPAGENT_API_KEY || u.api.lpAgent?.apiKey) ?? null,
      },
    },
    pnl: {
      rpcUrl: process.env.PNL_RPC_URL || u.pnl.rpcUrl,
      source: u.pnl.source,
      pollIntervalSec: u.pnl.pollIntervalSec,
      depositCacheTtlSec: u.pnl.depositCacheTtlSec,
      confirmTicks: u.pnl.confirmTicks,
    },
    opportunity: {
      enabled: u.opportunity.enabled,
      pollIntervalSec: u.opportunity.pollIntervalSec,
      limit: u.opportunity.limit,
      minScore: u.opportunity.minScore,
      smartWalletScoreBonus: u.opportunity.smartWalletScoreBonus,
      targetVolRatio: u.opportunity.targetVolRatio,
      targetLpCount: u.opportunity.targetLpCount,
      targetFeeRatio: u.opportunity.targetFeeRatio,
      targetLiquidity: u.opportunity.targetLiquidity,
    },
    gmgn: {
      enabled: u.gmgn.enabled,
      apiKey: u.gmgn.apiKey as string,
      baseUrl: u.gmgn.baseUrl as string,
      requestDelayMs: u.gmgn.requestDelayMs,
      maxRetries: u.gmgn.maxRetries,
      feeSource: u.gmgn.feeSource,
    },
    jupiter: {
      apiKey: process.env.JUPITER_API_KEY || u.jupiter.apiKey,
      referralAccount: process.env.JUPITER_REFERRAL_ACCOUNT || u.jupiter.referralAccount,
      referralFeeBps: Number(process.env.JUPITER_REFERRAL_FEE_BPS ?? u.jupiter.referralFeeBps),
    },
    indicators: {
      enabled: u.chartIndicators.enabled,
      entryPreset: u.chartIndicators.entryPreset,
      exitPreset: u.chartIndicators.exitPreset,
      rsiLength: u.chartIndicators.rsiLength,
      intervals: u.chartIndicators.intervals,
      candles: u.chartIndicators.candles,
      rsiOversold: u.chartIndicators.rsiOversold,
      rsiOverbought: u.chartIndicators.rsiOverbought,
      requireAllIntervals: u.chartIndicators.requireAllIntervals,
    },
  };
}

export const config: AppConfig = buildConfig();

// Initialize the minSafeBinsBelow override from config
setMinSafeBinsBelowOverride(config.strategy.minSafeBinsBelow);

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

export function reloadScreeningThresholds(): void {
  try {
    // Dynamic reloading can just re-read the nested schema
    if (!fs.existsSync(USER_CONFIG_PATH)) return;
    const raw = JSON.parse(fs.readFileSync(USER_CONFIG_PATH, 'utf8'));

    // Partially parse just what we need or assume the structure
    // Since this is just screening thresholds, we can extract them directly.
    if (raw && raw.screening) {
      const u = raw.screening;
      const s = config.screening;

      if (u.minFeeActiveTvlRatio != null) s.minFeeActiveTvlRatio = resolveField('minFeeActiveTvlRatio', u.minFeeActiveTvlRatio) as number;
      if (u.minTokenFeesSol != null) s.minTokenFeesSol = resolveField('minTokenFeesSol', u.minTokenFeesSol) as number;
      if (u.maxTop10Pct != null) s.maxTop10Pct = resolveField('maxTop10Pct', u.maxTop10Pct) as number;
      if (u.useDiscordSignals !== undefined) s.useDiscordSignals = resolveField('useDiscordSignals', u.useDiscordSignals) as boolean;
      if (u.discordSignalMode != null) s.discordSignalMode = resolveField('discordSignalMode', u.discordSignalMode) as string;
      if (u.excludeHighSupplyConcentration !== undefined)
        s.excludeHighSupplyConcentration = resolveField('excludeHighSupplyConcentration', u.excludeHighSupplyConcentration) as boolean;
      if (u.minOrganic != null) s.minOrganic = resolveField('minOrganic', u.minOrganic) as number;
      if (u.minQuoteOrganic != null) s.minQuoteOrganic = resolveField('minQuoteOrganic', u.minQuoteOrganic) as number;
      if (u.minHolders != null) s.minHolders = resolveField('minHolders', u.minHolders) as number;
      if (u.minMcap != null) s.minMcap = resolveField('minMcap', u.minMcap) as number;
      if (u.maxMcap != null) s.maxMcap = resolveField('maxMcap', u.maxMcap) as number;
      if (u.minTvl != null) s.minTvl = resolveField('minTvl', u.minTvl) as number;
      if (u.maxTvl !== undefined) s.maxTvl = resolveField('maxTvl', u.maxTvl) as number;
      if (u.minVolume != null) s.minVolume = resolveField('minVolume', u.minVolume) as number;
      if (u.minBinStep != null) s.minBinStep = resolveField('minBinStep', u.minBinStep) as number;
      if (u.maxBinStep != null) s.maxBinStep = resolveField('maxBinStep', u.maxBinStep) as number;
      if (u.timeframe != null) s.timeframe = resolveField('timeframe', u.timeframe) as string;
      if (u.category != null) s.category = resolveField('category', u.category) as string;
      if (u.minTokenAgeHours !== undefined) s.minTokenAgeHours = resolveField('minTokenAgeHours', u.minTokenAgeHours) as number | null;
      if (u.maxTokenAgeHours !== undefined) s.maxTokenAgeHours = resolveField('maxTokenAgeHours', u.maxTokenAgeHours) as number | null;
      if (u.avoidPvpSymbols !== undefined) s.avoidPvpSymbols = resolveField('avoidPvpSymbols', u.avoidPvpSymbols) as boolean;
      if (u.blockPvpSymbols !== undefined) s.blockPvpSymbols = resolveField('blockPvpSymbols', u.blockPvpSymbols) as boolean;
      if (u.maxBotHoldersPct != null) s.maxBotHoldersPct = resolveField('maxBotHoldersPct', u.maxBotHoldersPct) as number;
      if (u.allowedLaunchpads !== undefined) s.allowedLaunchpads = resolveField('allowedLaunchpads', u.allowedLaunchpads) as string[];
      if (u.blockedLaunchpads !== undefined) s.blockedLaunchpads = resolveField('blockedLaunchpads', u.blockedLaunchpads) as string[];
      if (u.loneCandidateMinDegen != null) s.loneCandidateMinDegen = resolveField('loneCandidateMinDegen', u.loneCandidateMinDegen) as number;
    }

    if (raw && raw.strategy) {
      const u = raw.strategy;
      const minBinsBelow = numericConfig(u.minBinsBelow) ?? config.strategy.minBinsBelow;
      const maxBinsBelow = numericConfig(u.maxBinsBelow) ?? config.strategy.maxBinsBelow;
      const defaultBinsBelow = numericConfig(u.defaultBinsBelow) ?? config.strategy.defaultBinsBelow ?? maxBinsBelow;
      config.strategy.minBinsBelow = Math.max(MIN_SAFE_BINS_BELOW, Math.round(resolveField('minBinsBelow', minBinsBelow) as number));
      config.strategy.maxBinsBelow = Math.max(config.strategy.minBinsBelow, Math.round(resolveField('maxBinsBelow', maxBinsBelow) as number));
      config.strategy.defaultBinsBelow = Math.max(
        config.strategy.minBinsBelow,
        Math.min(config.strategy.maxBinsBelow, Math.round(resolveField('defaultBinsBelow', defaultBinsBelow) as number)),
      );
    }
  } catch {
    /* ignore */
  }
}

function resolveField(key: string, value: unknown): unknown {
  if (typeof value === 'string' && value.startsWith('env.')) {
    return resolveEnvString(value);
  }
  return value;
}
