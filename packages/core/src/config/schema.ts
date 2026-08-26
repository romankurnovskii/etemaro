import { z } from 'zod';

// Helper to handle process.env references for strings
const envString = z.string().transform((val) => {
  if (val.startsWith('env.')) {
    const envVar = val.slice(4);
    const resolved = process.env[envVar];
    if (resolved === undefined) {
      throw new Error(
        `Environment variable ${envVar} is not set but is referenced by configuration.\n` + `Set ${envVar} in your .env file or environment.`,
      );
    }
    return resolved;
  }
  return val;
});

// Helper for strings that can be null or empty string, resolving env references if applicable
const envStringNullable = z
  .string()
  .nullable()
  .transform((val) => {
    if (val && val.startsWith('env.')) {
      const envVar = val.slice(4);
      return process.env[envVar] || null;
    }
    return val;
  });

// Helper for numbers that might be passed as strings from env or config
const envNumber = z.union([z.number(), z.string()]).transform((val, ctx) => {
  if (typeof val === 'string') {
    if (val.startsWith('env.')) {
      const envVar = val.slice(4);
      const resolved = process.env[envVar];
      if (resolved === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Environment variable ${envVar} is not set but is referenced.`,
        });
        return z.NEVER;
      }
      const num = Number(resolved);
      if (isNaN(num)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Environment variable ${envVar} did not resolve to a valid number.`,
        });
        return z.NEVER;
      }
      return num;
    }
    const num = Number(val);
    if (isNaN(num)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Expected a number',
      });
      return z.NEVER;
    }
    return num;
  }
  return val;
});

const envBoolean = z.union([z.boolean(), z.string()]).transform((val, ctx) => {
  if (typeof val === 'string') {
    if (val.startsWith('env.')) {
      const envVar = val.slice(4);
      const resolved = process.env[envVar];
      if (resolved === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Environment variable ${envVar} is not set but is referenced.`,
        });
        return z.NEVER;
      }
      return resolved.toLowerCase() === 'true' || resolved === '1';
    }
    return val.toLowerCase() === 'true' || val === '1';
  }
  return val;
});

export const UserConfigSchema = z.object({
  _version: z.number().optional().default(3),
  preset: z.string().optional(),
  agentId: envStringNullable.optional(),
  connection: z
    .object({
      description: z.string().optional(),
      rpcUrl: envString.optional(),
      walletPrivateKey: envString.optional(),
      heliusApiKey: envStringNullable.optional(),
      telegramBotToken: envStringNullable.optional(),
      // Legacy aliases accepted while existing configs migrate to llm.*.
      llmBaseUrl: envStringNullable.optional(),
      llmApiKey: envStringNullable.optional(),
      llmModel: envStringNullable.optional(),
      dryRun: envBoolean,
      telegramChatId: envStringNullable.optional(),
      telegramAllowedUserIds: envStringNullable.optional(),
    })
    .optional(),
  rpcUrl: envString.optional(),
  walletPrivateKey: envString.optional(),
  risk: z.object({
    maxPositions: envNumber,
    maxDeployAmount: envNumber,
  }),
  screening: z.object({
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
    useDiscordSignals: envBoolean,
    discordSignalMode: envString,
    avoidPvpSymbols: envBoolean,
    blockPvpSymbols: envBoolean,
    maxBotHoldersPct: envNumber,
    maxTop10Pct: envNumber,
    loneCandidateMinDegen: envNumber,
    allowedLaunchpads: z.array(envString),
    blockedLaunchpads: z.array(envString),
    minTokenAgeHours: envNumber.nullable(),
    maxTokenAgeHours: envNumber.nullable(),
  }),
  management: z.object({
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
  }),
  strategy: z.object({
    activeStrategyId: envString,
    strategyMeteora: z.enum(['spot', 'curve', 'bid_ask']),
    minBinsBelow: envNumber,
    maxBinsBelow: envNumber,
    defaultBinsBelow: envNumber,
    minSafeBinsBelow: envNumber,
  }),
  schedule: z.object({
    managementIntervalMin: envNumber,
    screeningIntervalMin: envNumber,
    healthCheckIntervalMin: envNumber,
  }),
  llm: z.object({
    baseUrl: envStringNullable.optional(),
    apiKey: envStringNullable.optional(),
    defaultModel: envString.optional(),
    temperature: envNumber,
    maxTokens: envNumber,
    maxSteps: envNumber,
    managementModel: envString,
    screeningModel: envString,
    generalModel: envString,
  }),
  darwin: z.object({
    enabled: envBoolean,
    windowDays: envNumber,
    recalcEvery: envNumber,
    boostFactor: envNumber,
    decayFactor: envNumber,
    weightFloor: envNumber,
    weightCeiling: envNumber,
    minSamples: envNumber,
  }),
  hiveMind: z.object({
    description: z.string().optional(),
    enabled: envBoolean.default(true),
    url: envStringNullable.optional(),
    apiKey: envStringNullable.optional(),
    agentId: envStringNullable.optional(),
    pullMode: envString,
  }),
  api: z.object({
    description: z.string().optional(),
    meridian: z
      .object({
        description: z.string().optional(),
        enabled: envBoolean.default(true),
        url: envStringNullable.optional(),
        publicApiKey: envStringNullable.optional(),
        lpAgentRelayEnabled: envBoolean.default(false),
      })
      .optional(),
    lpAgent: z
      .object({
        description: z.string().optional(),
        enabled: envBoolean.default(false),
        url: envStringNullable.optional(),
        apiKey: envStringNullable.optional(),
      })
      .optional(),
    // Legacy API fields remain accepted while existing configs migrate.
    url: envStringNullable.optional(),
    publicApiKey: envStringNullable.optional(),
    lpAgentRelayEnabled: envBoolean.optional(),
  }),
  pnl: z.object({
    rpcUrl: envString,
    source: envString,
    pollIntervalSec: envNumber,
    depositCacheTtlSec: envNumber,
    confirmTicks: envNumber,
  }),
  opportunity: z.object({
    enabled: envBoolean,
    pollIntervalSec: envNumber,
    limit: envNumber,
    minScore: envNumber,
    smartWalletScoreBonus: envNumber,
    targetVolRatio: envNumber,
    targetLpCount: envNumber,
    targetFeeRatio: envNumber,
    targetLiquidity: envNumber,
  }),
  gmgn: z.object({
    description: z.string().optional(),
    enabled: envBoolean.default(false),
    apiKey: envStringNullable.optional(),
    baseUrl: envString,
    requestDelayMs: envNumber,
    maxRetries: envNumber,
    feeSource: envString,
  }),
  jupiter: z.object({
    apiKey: envString,
    referralAccount: envString,
    referralFeeBps: envNumber,
  }),
  chartIndicators: z.object({
    enabled: envBoolean,
    entryPreset: envString,
    exitPreset: envString,
    rsiLength: envNumber,
    intervals: z.array(envString),
    candles: envNumber,
    rsiOversold: envNumber,
    rsiOverbought: envNumber,
    requireAllIntervals: envBoolean,
  }),
});

export type ValidatedUserConfig = z.infer<typeof UserConfigSchema>;
