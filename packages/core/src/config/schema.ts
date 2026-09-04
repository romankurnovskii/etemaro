import { z } from 'zod'
import { DEFAULT_PNL_SOURCE } from '../shared/constants.js'
import { resolveEnvString } from '../shared/utils.js'

// Helper to handle process.env references for strings
const envString = z.string().transform((val, ctx) => {
  if (val.startsWith('env.')) {
    const envVar = val.slice(4)
    const resolved = process.env[envVar]
    if (resolved === undefined || resolved.trim() === '') {
      ctx.addIssue({
        code: 'custom',
        message: `Environment variable ${envVar} is not set but is referenced by configuration.\nSet ${envVar} in your .env file or environment.`,
        params: { envVar, ref: val },
      })
      return z.NEVER
    }
    return resolved.trim()
  }
  return val
})

// Helper for strings that can be null or empty string, resolving env references if applicable
const envStringNullable = z
  .string()
  .nullable()
  .optional()
  .transform((val) => {
    if (val && typeof val === 'string' && val.startsWith('env.')) {
      return resolveEnvString(val)
    }
    return val ?? null
  })

// Helper for numbers that might be passed as strings from env or config
const envNumber = z.union([z.number(), z.string()]).transform((val, ctx) => {
  if (typeof val === 'string') {
    if (val.startsWith('env.')) {
      const envVar = val.slice(4)
      const resolved = process.env[envVar]
      if (resolved === undefined) {
        ctx.addIssue({
          code: 'custom',
          message: `Environment variable ${envVar} is not set but is referenced.`,
          params: { envVar, ref: val },
        })
        return z.NEVER
      }
      const num = Number(resolved)
      if (Number.isNaN(num)) {
        ctx.addIssue({
          code: 'custom',
          message: `Environment variable ${envVar} did not resolve to a valid number.`,
        })
        return z.NEVER
      }
      return num
    }
    const num = Number(val)
    if (Number.isNaN(num)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Expected a number',
      })
      return z.NEVER
    }
    return num
  }
  return val
})

const envBoolean = z.union([z.boolean(), z.string()]).transform((val, ctx) => {
  if (typeof val === 'string') {
    if (val.startsWith('env.')) {
      const envVar = val.slice(4)
      const resolved = process.env[envVar]
      if (resolved === undefined) {
        ctx.addIssue({
          code: 'custom',
          message: `Environment variable ${envVar} is not set but is referenced.`,
        })
        return z.NEVER
      }
      return resolved.toLowerCase() === 'true' || resolved === '1'
    }
    return val.toLowerCase() === 'true' || val === '1'
  }
  return val
})

export const UserConfigSchema = z
  .object({
    _version: z.number().optional().default(3),
    preset: z.string().optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    agentId: envStringNullable.optional(),
    connection: z
      .object({
        description: z.string().optional(),
        rpcUrl: envString.optional(),
        rpcUrl2: envStringNullable.optional(),
        walletPrivateKey: envString.optional(),
        wallet: z.string().optional(),
        heliusApiKey: envStringNullable.optional(),
        telegramBotToken: envStringNullable.optional(),
        telegramChatId: envStringNullable.optional(),
        telegramAllowedUserIds: envStringNullable.optional(),
        dryRun: envBoolean,
        allowSelfUpdate: envBoolean.optional().default(false),
      })
      .strict()
      .optional(),
    risk: z
      .object({
        description: z.string().optional(),
        maxPositions: envNumber,
        maxDeployAmount: envNumber,
      })
      .strict(),
    screening: z
      .object({
        description: z.string().optional(),
        entrySource: z.enum(['market', 'smart_wallets']).optional().default('market'),
        excludeHighSupplyConcentration: envBoolean,
        minFeeActiveTvlRatio: envNumber,
        minTvl: envNumber,
        maxTvl: envNumber,
        minVolume: envNumber,
        minOrganic: envNumber,
        minQuoteOrganic: envNumber,
        minHolders: envNumber,
        minMcap: envNumber,
        maxMcap: envNumber,
        minBinStep: envNumber,
        maxBinStep: envNumber,
        timeframe: envString,
        category: envString,
        minTokenFeesSol: envNumber,
        useDiscordSignals: envBoolean.optional().default(false),
        discordSignalMode: z.string().optional().default('merge'),
        avoidPvpSymbols: envBoolean,
        blockPvpSymbols: envBoolean,
        maxBotHoldersPct: envNumber,
        maxTop10Pct: envNumber,
        loneCandidateMinDegen: envNumber,
        allowedLaunchpads: z.array(envString),
        blockedLaunchpads: z.array(envString),
        minTokenAgeHours: envNumber.nullable(),
        maxTokenAgeHours: envNumber.nullable(),
      })
      .strict(),
    management: z
      .object({
        description: z.string().optional(),
        minClaimAmount: envNumber,
        autoSwapAfterClaim: envBoolean,
        autoSwapRetryAttempts: envNumber,
        autoSwapRetryDelayMs: envNumber,
        autoSwapInterSwapDelayMs: envNumber,
        haltOnSwapFailure: envBoolean,
        maxFailedSwapsBeforeHalt: envNumber,
        outOfRangeBinsToClose: envNumber,
        outOfRangeWaitMinutes: envNumber,
        oorCooldownTriggerCount: envNumber,
        oorCooldownHours: envNumber,
        repeatDeployCooldownEnabled: envBoolean,
        repeatDeployCooldownTriggerCount: envNumber,
        repeatDeployCooldownHours: envNumber,
        repeatDeployCooldownScope: envString,
        repeatDeployCooldownMinFeeEarnedPct: envNumber,
        minVolumeToRebalance: envNumber,
        stopLossPct: envNumber,
        takeProfitPct: envNumber,
        minFeePerTvl24h: envNumber,
        minAgeBeforeYieldCheck: envNumber,
        minSolToOpen: envNumber,
        deployAmountSol: envNumber,
        gasReserve: envNumber,
        positionSizePct: envNumber,
        trailingTakeProfit: envBoolean,
        trailingTriggerPct: envNumber,
        trailingDropPct: envNumber,
        pnlSanityMaxDiffPct: envNumber,
        solMode: envBoolean,
      })
      .strict(),
    strategy: z
      .object({
        description: z.string().optional(),
        activeStrategyId: envString,
        strategyMeteora: z.enum(['spot', 'curve', 'bid_ask']),
        minBinsBelow: envNumber,
        maxBinsBelow: envNumber,
        defaultBinsBelow: envNumber,
        minSafeBinsBelow: envNumber,
      })
      .strict(),
    schedule: z
      .object({
        description: z.string().optional(),
        managementIntervalMin: envNumber,
        screeningIntervalMin: envNumber,
        healthCheckIntervalMin: envNumber,
      })
      .strict(),
    llm: z
      .object({
        description: z.string().optional(),
        baseUrl: envStringNullable.optional(),
        apiKey: envStringNullable.optional(),
        temperature: envNumber,
        maxTokens: envNumber,
        maxSteps: envNumber,
        model: z.string().nullable().optional(),
        defaultModel: z.string().nullable().optional(),
        fallbackModel: envStringNullable.optional(),
        managementModel: z.string().nullable().optional(),
        screeningModel: z.string().nullable().optional(),
        generalModel: z.string().nullable().optional(),
      })
      .strict()
      .superRefine((val, ctx) => {
        // Resolve candidate base model
        let directModel: string | null = null
        if (val.defaultModel && typeof val.defaultModel === 'string' && val.defaultModel.trim() !== '') {
          if (!val.defaultModel.startsWith('env.')) {
            directModel = val.defaultModel.trim()
          } else {
            const envVar = val.defaultModel.slice(4)
            const envVal = process.env[envVar]?.trim()
            if (envVal) directModel = envVal
          }
        }
        if (!directModel && val.model && typeof val.model === 'string' && val.model.trim() !== '') {
          if (!val.model.startsWith('env.')) {
            directModel = val.model.trim()
          } else {
            const envVar = val.model.slice(4)
            const envVal = process.env[envVar]?.trim()
            if (envVal) directModel = envVal
          }
        }

        // If no model is defined directly and no referenced env var is set, report the missing env var
        if (!directModel) {
          const rawRef = val.defaultModel?.startsWith('env.')
            ? val.defaultModel
            : val.model?.startsWith('env.')
              ? val.model
              : 'env.LLM_MODEL'
          const envVar = rawRef.startsWith('env.') ? rawRef.slice(4) : 'LLM_MODEL'
          ctx.addIssue({
            code: 'custom',
            message: `Environment variable ${envVar} is not set but is referenced by configuration.\nSet ${envVar} in your .env file or environment, or set "defaultModel" directly in your JSON config file.`,
            params: { envVar, ref: rawRef },
            path: ['defaultModel'],
          })
        }
      })
      .transform((val) => {
        let baseModel = ''
        if (val.defaultModel && typeof val.defaultModel === 'string' && !val.defaultModel.startsWith('env.')) {
          baseModel = val.defaultModel.trim()
        } else if (val.model && typeof val.model === 'string' && !val.model.startsWith('env.')) {
          baseModel = val.model.trim()
        } else if (val.defaultModel?.startsWith('env.')) {
          baseModel = process.env[val.defaultModel.slice(4)]?.trim() || ''
        } else if (val.model?.startsWith('env.')) {
          baseModel = process.env[val.model.slice(4)]?.trim() || ''
        }

        const resolveRoleModel = (roleVal?: string | null): string => {
          if (!roleVal || roleVal.trim() === '') return baseModel
          if (!roleVal.startsWith('env.')) return roleVal.trim()
          const envVar = roleVal.slice(4)
          const resolved = process.env[envVar]?.trim()
          return resolved || baseModel
        }

        return {
          ...val,
          defaultModel: baseModel,
          managementModel: resolveRoleModel(val.managementModel),
          screeningModel: resolveRoleModel(val.screeningModel),
          generalModel: resolveRoleModel(val.generalModel),
        }
      }),
    darwin: z
      .object({
        description: z.string().optional(),
        enabled: envBoolean,
        windowDays: envNumber,
        recalcEvery: envNumber,
        boostFactor: envNumber,
        decayFactor: envNumber,
        weightFloor: envNumber,
        weightCeiling: envNumber,
        minSamples: envNumber,
      })
      .strict(),
    hiveMind: z
      .object({
        description: z.string().optional(),
        enabled: envBoolean.default(true),
        url: envStringNullable.optional(),
        apiKey: envStringNullable.optional(),
        agentId: envStringNullable.optional(),
        pullMode: envString,
      })
      .strict(),
    api: z
      .object({
        description: z.string().optional(),
        meridian: z
          .object({
            description: z.string().optional(),
            enabled: envBoolean.default(true),
            url: envStringNullable.optional(),
            publicApiKey: envStringNullable.optional(),
            lpAgentRelayEnabled: envBoolean.default(false),
          })
          .strict()
          .optional(),
        lpAgent: z
          .object({
            description: z.string().optional(),
            enabled: envBoolean.default(false),
            url: envStringNullable.optional(),
            apiKey: envStringNullable.optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    pnl: z
      .object({
        description: z.string().optional(),
        rpcUrl: envString.default('https://pump.helius-rpc.com'),
        source: envString.default(DEFAULT_PNL_SOURCE),
        pollIntervalSec: envNumber.default(15),
        depositCacheTtlSec: envNumber.default(300),
        confirmTicks: envNumber.default(2),
      })
      .strict(),
    opportunity: z
      .object({
        description: z.string().optional(),
        enabled: envBoolean,
        pollIntervalSec: envNumber,
        limit: envNumber,
        minScore: envNumber,
        smartWalletScoreBonus: envNumber,
        targetVolRatio: envNumber,
        targetLpCount: envNumber,
        targetFeeRatio: envNumber,
        targetLiquidity: envNumber,
      })
      .strict(),
    gmgn: z
      .object({
        description: z.string().optional(),
        enabled: envBoolean.default(false),
        apiKey: envStringNullable.optional(),
        baseUrl: envString,
        requestDelayMs: envNumber,
        maxRetries: envNumber,
        feeSource: envString,
      })
      .strict(),
    jupiter: z
      .object({
        description: z.string().optional(),
        apiKey: envStringNullable.optional(),
        referralAccount: envStringNullable.optional(),
        referralFeeBps: envNumber.optional().default(50),
      })
      .strict(),
    chartIndicators: z
      .object({
        description: z.string().optional(),
        enabled: envBoolean,
        entryPreset: envString,
        exitPreset: envString,
        rsiLength: envNumber,
        intervals: z.array(envString),
        candles: envNumber,
        rsiOversold: envNumber,
        rsiOverbought: envNumber,
        requireAllIntervals: envBoolean,
      })
      .strict(),
  })
  .strict()

export type ValidatedUserConfig = z.infer<typeof UserConfigSchema>
export type UserConfigRaw = z.input<typeof UserConfigSchema>
