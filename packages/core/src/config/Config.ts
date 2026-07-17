import fs from 'node:fs';
import type { AppConfig } from '../shared/types.js';
import { repoPath, dataPath, configPath, MIN_SAFE_BINS_BELOW, TOKEN_MINTS } from '../shared/constants.js';
import { numericConfig } from '../shared/utils.js';
import { loadAndValidateConfig } from './ConfigValidator.js';

const USER_CONFIG_PATH = configPath('user-config.json');
const GMGN_CONFIG_PATH = configPath('gmgn-config.json');

function readGmgnConfig(): Record<string, unknown> {
  if (!fs.existsSync(GMGN_CONFIG_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(GMGN_CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
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
  const { flat: u, chartIndicators } = loadAndValidateConfig();
  const gmgnCfg = readGmgnConfig();

  applyUserConfigToEnv(u);

  if (gmgnCfg.apiKey || u.gmgnApiKey) {
    process.env.GMGN_API_KEY ||= (gmgnCfg.apiKey || u.gmgnApiKey) as string;
  }

  return {
    risk: {
      maxPositions: u.maxPositions as number,
      maxDeployAmount: u.maxDeployAmount as number,
    },
    screening: {
      excludeHighSupplyConcentration: u.excludeHighSupplyConcentration as boolean,
      minFeeActiveTvlRatio: u.minFeeActiveTvlRatio as number,
      minTvl: u.minTvl as number,
      maxTvl: u.maxTvl as number,
      minVolume: u.minVolume as number,
      minOrganic: u.minOrganic as number,
      minQuoteOrganic: u.minQuoteOrganic as number,
      minHolders: u.minHolders as number,
      minMcap: u.minMcap as number,
      maxMcap: u.maxMcap as number,
      minBinStep: u.minBinStep as number,
      maxBinStep: u.maxBinStep as number,
      timeframe: u.timeframe as string,
      category: u.category as string,
      minTokenFeesSol: u.minTokenFeesSol as number,
      useDiscordSignals: u.useDiscordSignals as boolean,
      discordSignalMode: u.discordSignalMode as string,
      avoidPvpSymbols: u.avoidPvpSymbols as boolean,
      blockPvpSymbols: u.blockPvpSymbols as boolean,
      maxBotHoldersPct: u.maxBotHoldersPct as number,
      maxTop10Pct: u.maxTop10Pct as number,
      loneCandidateMinDegen: u.loneCandidateMinDegen as number,
      allowedLaunchpads: u.allowedLaunchpads as string[],
      blockedLaunchpads: u.blockedLaunchpads as string[],
      minTokenAgeHours: u.minTokenAgeHours as number | null,
      maxTokenAgeHours: u.maxTokenAgeHours as number | null,
    },
    management: {
      minClaimAmount: u.minClaimAmount as number,
      autoSwapAfterClaim: u.autoSwapAfterClaim as boolean,
      autoSwapRetryAttempts: u.autoSwapRetryAttempts as number,
      autoSwapRetryDelayMs: u.autoSwapRetryDelayMs as number,
      outOfRangeBinsToClose: u.outOfRangeBinsToClose as number,
      outOfRangeWaitMinutes: u.outOfRangeWaitMinutes as number,
      oorCooldownTriggerCount: u.oorCooldownTriggerCount as number,
      oorCooldownHours: u.oorCooldownHours as number,
      repeatDeployCooldownEnabled: u.repeatDeployCooldownEnabled as boolean,
      repeatDeployCooldownTriggerCount: u.repeatDeployCooldownTriggerCount as number,
      repeatDeployCooldownHours: u.repeatDeployCooldownHours as number,
      repeatDeployCooldownScope: u.repeatDeployCooldownScope as string,
      repeatDeployCooldownMinFeeEarnedPct: u.repeatDeployCooldownMinFeeEarnedPct as number,
      minVolumeToRebalance: u.minVolumeToRebalance as number,
      stopLossPct: u.stopLossPct as number,
      takeProfitPct: u.takeProfitPct as number,
      minFeePerTvl24h: u.minFeePerTvl24h as number,
      minAgeBeforeYieldCheck: u.minAgeBeforeYieldCheck as number,
      minSolToOpen: u.minSolToOpen as number,
      deployAmountSol: u.deployAmountSol as number,
      gasReserve: u.gasReserve as number,
      positionSizePct: u.positionSizePct as number,
      trailingTakeProfit: u.trailingTakeProfit as boolean,
      trailingTriggerPct: u.trailingTriggerPct as number,
      trailingDropPct: u.trailingDropPct as number,
      pnlSanityMaxDiffPct: u.pnlSanityMaxDiffPct as number,
      solMode: u.solMode as boolean,
    },
    strategy: {
      strategy: u.strategy as string,
      minBinsBelow: u.minBinsBelow as number,
      maxBinsBelow: u.maxBinsBelow as number,
      defaultBinsBelow: u.defaultBinsBelow as number,
    },
    schedule: {
      managementIntervalMin: u.managementIntervalMin as number,
      screeningIntervalMin: u.screeningIntervalMin as number,
      healthCheckIntervalMin: u.healthCheckIntervalMin as number,
    },
    llm: {
      temperature: u.temperature as number,
      maxTokens: u.maxTokens as number,
      maxSteps: u.maxSteps as number,
      managementModel: u.managementModel as string,
      screeningModel: u.screeningModel as string,
      generalModel: u.generalModel as string,
    },
    darwin: {
      enabled: u.darwinEnabled as boolean,
      windowDays: u.darwinWindowDays as number,
      recalcEvery: u.darwinRecalcEvery as number,
      boostFactor: u.darwinBoost as number,
      decayFactor: u.darwinDecay as number,
      weightFloor: u.darwinFloor as number,
      weightCeiling: u.darwinCeiling as number,
      minSamples: u.darwinMinSamples as number,
    },
    tokens: { ...TOKEN_MINTS },
    hiveMind: {
      url: typeof u.hiveMindUrl === 'string' && u.hiveMindUrl ? u.hiveMindUrl : null,
      apiKey: process.env.HIVEMIND_API_KEY || (typeof u.hiveMindApiKey === 'string' && u.hiveMindApiKey ? u.hiveMindApiKey : null),
      agentId: typeof u.agentId === 'string' && u.agentId ? u.agentId : null,
      pullMode: u.hiveMindPullMode as string,
    },
    api: {
      url: process.env.AGENT_MERIDIAN_API_URL || (typeof u.agentMeridianApiUrl === 'string' && u.agentMeridianApiUrl ? u.agentMeridianApiUrl : null),
      publicApiKey: process.env.PUBLIC_API_KEY || (typeof u.publicApiKey === 'string' && u.publicApiKey ? u.publicApiKey : null),
      lpAgentRelayEnabled: u.lpAgentRelayEnabled as boolean,
    },
    pnl: {
      rpcUrl: process.env.PNL_RPC_URL || (u.pnlRpcUrl as string),
      source: u.pnlSource as string,
      pollIntervalSec: u.pnlPollIntervalSec as number,
      depositCacheTtlSec: u.pnlDepositCacheTtlSec as number,
      confirmTicks: u.pnlConfirmTicks as number,
    },
    opportunity: {
      enabled: u.opportunityPollEnabled as boolean,
      pollIntervalSec: u.opportunityPollIntervalSec as number,
      limit: u.opportunityPollLimit as number,
      minScore: u.opportunityMinScore as number,
      smartWalletScoreBonus: u.opportunitySmartWalletBonus as number,
      targetVolRatio: u.degenTargetVolRatio as number,
      targetLpCount: u.degenTargetLpCount as number,
      targetFeeRatio: u.degenTargetFeeRatio as number,
      targetLiquidity: u.degenTargetLiquidity as number,
    },
    gmgn: {
      apiKey: (gmgnCfg.apiKey as string) || (u.gmgnApiKey as string),
      baseUrl: (gmgnCfg.baseUrl as string) || (u.gmgnBaseUrl as string),
      requestDelayMs: (gmgnCfg.requestDelayMs as number) ?? (u.gmgnRequestDelayMs as number),
      maxRetries: (gmgnCfg.maxRetries as number) ?? (u.gmgnMaxRetries as number),
      feeSource: (gmgnCfg.feeSource as string) || (u.gmgnFeeSource as string),
    },
    jupiter: {
      apiKey: process.env.JUPITER_API_KEY || (u.jupiterApiKey as string),
      referralAccount: process.env.JUPITER_REFERRAL_ACCOUNT || (u.jupiterReferralAccount as string),
      referralFeeBps: Number(process.env.JUPITER_REFERRAL_FEE_BPS ?? u.jupiterReferralFeeBps),
    },
    indicators: {
      enabled: chartIndicators.enabled as boolean,
      entryPreset: chartIndicators.entryPreset as string,
      exitPreset: chartIndicators.exitPreset as string,
      rsiLength: chartIndicators.rsiLength as number,
      intervals: chartIndicators.intervals as string[],
      candles: chartIndicators.candles as number,
      rsiOversold: chartIndicators.rsiOversold as number,
      rsiOverbought: chartIndicators.rsiOverbought as number,
      requireAllIntervals: chartIndicators.requireAllIntervals as boolean,
    },
  };
}

export const config: AppConfig = buildConfig();

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
    if (!fs.existsSync(USER_CONFIG_PATH)) return;
    const raw = JSON.parse(fs.readFileSync(USER_CONFIG_PATH, 'utf8')) as Record<string, unknown>;
    const u =
      raw.chartIndicators && typeof raw.chartIndicators === 'object' && !Array.isArray(raw.chartIndicators)
        ? { ...(raw as Record<string, unknown>), ...flattenNestedValues(raw) }
        : raw;
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

    const minBinsBelow = numericConfig(u.minBinsBelow) ?? config.strategy.minBinsBelow;
    const maxBinsBelow = numericConfig(u.maxBinsBelow) ?? config.strategy.maxBinsBelow;
    const defaultBinsBelow = numericConfig(u.defaultBinsBelow) ?? config.strategy.defaultBinsBelow ?? maxBinsBelow;
    config.strategy.minBinsBelow = Math.max(MIN_SAFE_BINS_BELOW, Math.round(resolveField('minBinsBelow', minBinsBelow) as number));
    config.strategy.maxBinsBelow = Math.max(config.strategy.minBinsBelow, Math.round(resolveField('maxBinsBelow', maxBinsBelow) as number));
    config.strategy.defaultBinsBelow = Math.max(
      config.strategy.minBinsBelow,
      Math.min(config.strategy.maxBinsBelow, Math.round(resolveField('defaultBinsBelow', defaultBinsBelow) as number)),
    );
  } catch {
    /* ignore */
  }
}

function resolveField(key: string, value: unknown): unknown {
  if (typeof value === 'string' && value.startsWith('env.')) {
    return process.env[value.slice(4)];
  }
  return value;
}

function flattenNestedValues(u: Record<string, unknown>): Record<string, unknown> {
  const flatCategories = [
    'risk',
    'screening',
    'management',
    'strategy',
    'schedule',
    'llm',
    'darwin',
    'hiveMind',
    'api',
    'pnl',
    'opportunity',
    'gmgn',
    'jupiter',
  ];
  const result: Record<string, unknown> = {};
  for (const cat of flatCategories) {
    const catValue = u[cat];
    if (catValue && typeof catValue === 'object' && !Array.isArray(catValue)) {
      const catObj = catValue as Record<string, unknown>;
      const { description, ...fields } = catObj;
      for (const [key, value] of Object.entries(fields)) {
        if (!(key in result)) {
          result[key] = value;
        }
      }
    }
  }
  return result;
}
