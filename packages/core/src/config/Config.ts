/**
 * @file Config.ts
 * @description Single-source configuration loader, environment resolver, and runtime settings manager.
 *
 * @features
 * - Loads agent-config.json and resolves env variable references
 * - Validates schema using Zod
 * - Exposes singleton `config` object and config mutation helpers
 *
 */

import fs from 'node:fs'
import {
  AGENT_CONFIG_PATH,
  DEFAULT_AGENT_ID,
  DEFAULT_LLM_BASE_URL,
  MIN_SAFE_BINS_BELOW,
  setMinSafeBinsBelowOverride,
  TOKEN_MINTS,
} from '../shared/constants.js'
import { setDryRun } from '../shared/flags.js'
import type { AppConfig } from '../shared/types.js'
import { numericConfig, resolveEnvString } from '../shared/utils.js'
import { isHelpOrInfoCommand, loadAndValidateConfig } from './ConfigValidator.js'
import { DEFAULT_AGENT_CONFIG } from './defaultAgentConfig.js'
import { formatConfigLoadError } from './formatConfigLoadError.js'
import type { ValidatedAgentConfig } from './schema.js'

export class ConfigLoadError extends Error {
  public configPath?: string
  public issues?: any[]

  constructor(message: string, options?: ErrorOptions & { configPath?: string; issues?: any[] }) {
    super(message, options)
    this.name = 'ConfigLoadError'
    if (options?.configPath) this.configPath = options.configPath
    if (options?.issues) this.issues = options.issues
  }
}

function buildConfig(): AppConfig {
  let loaded: Partial<ValidatedAgentConfig> = {}
  try {
    loaded = loadAndValidateConfig()
  } catch (err: any) {
    if (isHelpOrInfoCommand()) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[config] Warning: using fallback defaults for info/init: ${err.message}`)
      }
    } else {
      const explicitConfig = process.env.AGENT_CONFIG_PATH?.trim() || process.env.USER_CONFIG_PATH?.trim()
      const resolvedConfigPath = err?.configPath ?? (explicitConfig ? explicitConfig : AGENT_CONFIG_PATH)
      const baseMessage = explicitConfig
        ? `[config] Fatal: Failed to load explicit configuration from AGENT_CONFIG_PATH="${explicitConfig}": ${err.message}`
        : `[config] Fatal: Failed to load configuration: ${err.message}`
      const formatted = formatConfigLoadError(err, resolvedConfigPath)
      const message = `${baseMessage}\n${formatted}`
      const configError = new ConfigLoadError(message, {
        cause: err,
        configPath: resolvedConfigPath,
        issues: err?.issues ?? err?.cause?.issues ?? [],
      })
      if (!process.env.VITEST && process.env.NODE_ENV !== 'test') {
        console.error(formatted)
        process.exit(1)
      }
      throw configError
    }
  }

  const defaultFallback = DEFAULT_AGENT_CONFIG as unknown as ValidatedAgentConfig
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
      hiveMind: { ...defaultFallback.api?.hiveMind, ...loaded.api?.hiveMind },
    },
    llm: { ...defaultFallback.llm, ...loaded.llm },
    chartIndicators: { ...defaultFallback.chartIndicators, ...loaded.chartIndicators },
  } as unknown as ValidatedAgentConfig

  // The shape of u now closely matches AppConfig since Zod validates the nested structure.
  return {
    _version: u._version ?? 5,
    agentId: u.agentId && u.agentId.length > 0 ? u.agentId : DEFAULT_AGENT_ID,
    connection: {
      rpcUrl: u.connection?.rpcUrl ?? '',
      wallet: u.connection?.wallet,
      heliusApiKey: u.connection?.heliusApiKey ?? null,
      telegramBotToken: u.connection?.telegramBotToken ?? null,
      telegramChatId: u.connection?.telegramChatId ?? null,
      telegramAllowedUserIds: u.connection?.telegramAllowedUserIds ?? null,
      telegramEnabled: u.connection?.telegramEnabled ?? true,
      telegramPolling: u.connection?.telegramPolling ?? true,
      dryRun: u.connection?.dryRun ?? false,
      allowSelfUpdate: u.connection?.allowSelfUpdate ?? false,
      ipcPort: u.connection?.ipcPort,
      ipcToken: u.connection?.ipcToken,
      ipcSocketPath: u.connection?.ipcSocketPath,
      ipcHost: u.connection?.ipcHost,
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
      sweeperEnabled: u.management.sweeperEnabled ?? true,
      sweeperIntervalMin: u.management.sweeperIntervalMin ?? 15,
      sweeperMinUsd: u.management.sweeperMinUsd ?? 0.02,
      sweeperAlertUsd: u.management.sweeperAlertUsd ?? 1.0,
      sweeperMaxAttempts: u.management.sweeperMaxAttempts ?? 10,
      sweeperAbandonWindowHours: u.management.sweeperAbandonWindowHours ?? 2,
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
      fallbackModel:
        u.llm && typeof u.llm === 'object'
          ? ((u.llm as { fallbackModel?: string | null }).fallbackModel ?? null)
          : null,
      managementModel: u.llm.managementModel,
      screeningModel: u.llm.screeningModel,
      generalModel: u.llm.generalModel,
      baseUrl: u.llm.baseUrl || DEFAULT_LLM_BASE_URL,
      apiKey: u.llm.apiKey || '',
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
    api: {
      meridian: {
        enabled: u.api.meridian?.enabled ?? true,
        url: u.api.meridian?.url ?? null,
        publicApiKey: u.api.meridian?.publicApiKey ?? null,
        lpAgentRelayEnabled: u.api.meridian?.lpAgentRelayEnabled ?? false,
      },
      lpAgent: {
        enabled: u.api.lpAgent?.enabled ?? false,
        url: u.api.lpAgent?.url ?? null,
        apiKey: u.api.lpAgent?.apiKey ?? null,
      },
      hiveMind: {
        enabled: u.api.hiveMind?.enabled ?? true,
        url: u.api.hiveMind?.url ?? null,
        apiKey: u.api.hiveMind?.apiKey ?? null,
        agentId: u.api.hiveMind?.agentId ?? null,
        pullMode: u.api.hiveMind?.pullMode ?? 'auto',
      },
    },
    pnl: {
      rpcUrl: u.pnl.rpcUrl ?? '',
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
      apiKey: u.gmgn.apiKey || null,
      baseUrl: u.gmgn.baseUrl as string,
      requestDelayMs: u.gmgn.requestDelayMs,
      maxRetries: u.gmgn.maxRetries,
      feeSource: u.gmgn.feeSource,
    },
    jupiter: {
      apiKey: u.jupiter.apiKey ?? '',
      referralAccount: u.jupiter.referralAccount ?? '',
      referralFeeBps: u.jupiter.referralFeeBps ?? 50,
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
  }
}

export const config: AppConfig = buildConfig()

// Propagate dry-run flag to logger (logger.ts cannot import config due to circular deps)
setDryRun(config.connection.dryRun ?? false)

// Initialize the minSafeBinsBelow override from config
setMinSafeBinsBelowOverride(config.strategy.minSafeBinsBelow)

export function computeDeployAmount(walletSol: number, minViableDeploy?: number): number {
  const reserve = config.management.gasReserve
  const pct = config.management.positionSizePct
  const floor = config.management.deployAmountSol
  const ceil = config.risk.maxDeployAmount
  const deployable = Math.max(0, walletSol - reserve)
  const dynamic = deployable * pct
  const effectiveFloor = minViableDeploy !== undefined && deployable < floor ? Math.min(floor, minViableDeploy) : floor
  const result = Math.min(ceil, Math.max(effectiveFloor, dynamic))
  return parseFloat(result.toFixed(2))
}

/**
 * Dynamically reloads partial screening thresholds from agent-config.json into the active config singleton.
 */
export function reloadScreeningThresholds(): void {
  try {
    // Dynamic reloading can just re-read the nested schema
    if (!fs.existsSync(AGENT_CONFIG_PATH)) return
    const raw = JSON.parse(fs.readFileSync(AGENT_CONFIG_PATH, 'utf8'))

    // Partially parse just what we need or assume the structure
    // Since this is just screening thresholds, we can extract them directly.
    if (raw?.screening) {
      const u = raw.screening
      const s = config.screening

      if (u.minFeeActiveTvlRatio != null)
        s.minFeeActiveTvlRatio = resolveField('minFeeActiveTvlRatio', u.minFeeActiveTvlRatio) as number
      if (u.minTokenFeesSol != null) s.minTokenFeesSol = resolveField('minTokenFeesSol', u.minTokenFeesSol) as number
      if (u.maxTop10Pct != null) s.maxTop10Pct = resolveField('maxTop10Pct', u.maxTop10Pct) as number
      if (u.excludeHighSupplyConcentration !== undefined)
        s.excludeHighSupplyConcentration = resolveField(
          'excludeHighSupplyConcentration',
          u.excludeHighSupplyConcentration,
        ) as boolean
      if (u.minOrganic != null) s.minOrganic = resolveField('minOrganic', u.minOrganic) as number
      if (u.minQuoteOrganic != null) s.minQuoteOrganic = resolveField('minQuoteOrganic', u.minQuoteOrganic) as number
      if (u.minHolders != null) s.minHolders = resolveField('minHolders', u.minHolders) as number
      if (u.minMcap != null) s.minMcap = resolveField('minMcap', u.minMcap) as number
      if (u.maxMcap != null) s.maxMcap = resolveField('maxMcap', u.maxMcap) as number
      if (u.minTvl != null) s.minTvl = resolveField('minTvl', u.minTvl) as number
      if (u.maxTvl !== undefined) s.maxTvl = resolveField('maxTvl', u.maxTvl) as number
      if (u.minVolume != null) s.minVolume = resolveField('minVolume', u.minVolume) as number
      if (u.minBinStep != null) s.minBinStep = resolveField('minBinStep', u.minBinStep) as number
      if (u.maxBinStep != null) s.maxBinStep = resolveField('maxBinStep', u.maxBinStep) as number
      if (u.timeframe != null) s.timeframe = resolveField('timeframe', u.timeframe) as string
      if (u.category != null) s.category = resolveField('category', u.category) as string
      if (u.minTokenAgeHours !== undefined)
        s.minTokenAgeHours = resolveField('minTokenAgeHours', u.minTokenAgeHours) as number | null
      if (u.maxTokenAgeHours !== undefined)
        s.maxTokenAgeHours = resolveField('maxTokenAgeHours', u.maxTokenAgeHours) as number | null
      if (u.avoidPvpSymbols !== undefined)
        s.avoidPvpSymbols = resolveField('avoidPvpSymbols', u.avoidPvpSymbols) as boolean
      if (u.blockPvpSymbols !== undefined)
        s.blockPvpSymbols = resolveField('blockPvpSymbols', u.blockPvpSymbols) as boolean
      if (u.maxBotHoldersPct != null)
        s.maxBotHoldersPct = resolveField('maxBotHoldersPct', u.maxBotHoldersPct) as number
      if (u.allowedLaunchpads !== undefined)
        s.allowedLaunchpads = resolveField('allowedLaunchpads', u.allowedLaunchpads) as string[]
      if (u.blockedLaunchpads !== undefined)
        s.blockedLaunchpads = resolveField('blockedLaunchpads', u.blockedLaunchpads) as string[]
      if (u.loneCandidateMinDegen != null)
        s.loneCandidateMinDegen = resolveField('loneCandidateMinDegen', u.loneCandidateMinDegen) as number
    }

    if (raw?.strategy) {
      const u = raw.strategy
      const minBinsBelow = numericConfig(u.minBinsBelow) ?? config.strategy.minBinsBelow
      const maxBinsBelow = numericConfig(u.maxBinsBelow) ?? config.strategy.maxBinsBelow
      const defaultBinsBelow = numericConfig(u.defaultBinsBelow) ?? config.strategy.defaultBinsBelow ?? maxBinsBelow
      config.strategy.minBinsBelow = Math.max(
        MIN_SAFE_BINS_BELOW,
        Math.round(resolveField('minBinsBelow', minBinsBelow) as number),
      )
      config.strategy.maxBinsBelow = Math.max(
        config.strategy.minBinsBelow,
        Math.round(resolveField('maxBinsBelow', maxBinsBelow) as number),
      )
      config.strategy.defaultBinsBelow = Math.max(
        config.strategy.minBinsBelow,
        Math.min(
          config.strategy.maxBinsBelow,
          Math.round(resolveField('defaultBinsBelow', defaultBinsBelow) as number),
        ),
      )
    }
  } catch {
    /* ignore */
  }
}

/**
 * Re-reads user configuration from disk, evaluates process.env fallbacks,
 * and updates the in-memory `config` singleton in-place.
 *
 * Use this in unit tests or when switching configuration files at runtime.
 */
export function resetConfig(): AppConfig {
  const fresh = buildConfig()
  Object.assign(config, fresh)
  setMinSafeBinsBelowOverride(config.strategy.minSafeBinsBelow)
  setDryRun(config.connection.dryRun ?? false)
  return config
}

function resolveField(_key: string, value: unknown): unknown {
  if (typeof value === 'string' && value.startsWith('env.')) {
    return resolveEnvString(value)
  }
  return value
}
