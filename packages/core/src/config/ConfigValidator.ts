import fs from 'node:fs';
import { configPath } from '../shared/constants.js';
import { flattenUserConfig } from '../shared/utils.js';

const REQUIRED_FLAT_KEYS = new Set([
  'preset',
  'rpcUrl',
  'walletKey',
  'llmBaseUrl',
  'llmApiKey',
  'llmModel',
  'dryRun',
  'telegramChatId',
  'maxPositions',
  'maxDeployAmount',
  'timeframe',
  'category',
  'excludeHighSupplyConcentration',
  'minFeeActiveTvlRatio',
  'minTvl',
  'maxTvl',
  'minVolume',
  'minOrganic',
  'minQuoteOrganic',
  'minHolders',
  'minMcap',
  'maxMcap',
  'minBinStep',
  'maxBinStep',
  'minTokenFeesSol',
  'useDiscordSignals',
  'discordSignalMode',
  'avoidPvpSymbols',
  'blockPvpSymbols',
  'maxBotHoldersPct',
  'maxTop10Pct',
  'loneCandidateMinDegen',
  'allowedLaunchpads',
  'blockedLaunchpads',
  'minTokenAgeHours',
  'maxTokenAgeHours',
  'minClaimAmount',
  'autoSwapAfterClaim',
  'autoSwapRetryAttempts',
  'autoSwapRetryDelayMs',
  'outOfRangeBinsToClose',
  'outOfRangeWaitMinutes',
  'oorCooldownTriggerCount',
  'oorCooldownHours',
  'repeatDeployCooldownEnabled',
  'repeatDeployCooldownTriggerCount',
  'repeatDeployCooldownHours',
  'repeatDeployCooldownScope',
  'repeatDeployCooldownMinFeeEarnedPct',
  'minVolumeToRebalance',
  'stopLossPct',
  'takeProfitPct',
  'minFeePerTvl24h',
  'minAgeBeforeYieldCheck',
  'minSolToOpen',
  'deployAmountSol',
  'gasReserve',
  'positionSizePct',
  'trailingTakeProfit',
  'trailingTriggerPct',
  'trailingDropPct',
  'pnlSanityMaxDiffPct',
  'solMode',
  'strategy',
  'minBinsBelow',
  'maxBinsBelow',
  'defaultBinsBelow',
  'minSafeBinsBelow',

  'managementIntervalMin',
  'screeningIntervalMin',
  'healthCheckIntervalMin',
  'temperature',
  'maxTokens',
  'maxSteps',
  'managementModel',
  'screeningModel',
  'generalModel',
  'darwinEnabled',
  'darwinWindowDays',
  'darwinRecalcEvery',
  'darwinBoost',
  'darwinDecay',
  'darwinFloor',
  'darwinCeiling',
  'darwinMinSamples',
  'hiveMindUrl',
  'hiveMindApiKey',
  'agentId',
  'hiveMindPullMode',
  'agentMeridianApiUrl',
  'publicApiKey',
  'lpAgentRelayEnabled',
  'pnlSource',
  'pnlRpcUrl',
  'pnlPollIntervalSec',
  'pnlDepositCacheTtlSec',
  'pnlConfirmTicks',
  'opportunityPollEnabled',
  'opportunityPollIntervalSec',
  'opportunityPollLimit',
  'opportunityMinScore',
  'opportunitySmartWalletBonus',
  'degenTargetVolRatio',
  'degenTargetLpCount',
  'degenTargetFeeRatio',
  'degenTargetLiquidity',
  'gmgnFeeSource',
  'gmgnApiKey',
  'gmgnBaseUrl',
  'gmgnRequestDelayMs',
  'gmgnMaxRetries',
  'jupiterApiKey',
  'jupiterReferralAccount',
  'jupiterReferralFeeBps',
]);

const CATEGORIES = [
  'connection',
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

export interface ValidatedConfig {
  flat: Record<string, unknown>;
  chartIndicators: Record<string, unknown>;
}

function getMissingFields(flat: Record<string, unknown>): string[] {
  const missing: string[] = [];
  for (const key of REQUIRED_FLAT_KEYS) {
    if (!(key in flat)) {
      missing.push(key);
    }
  }

  if (!('chartIndicators' in flat)) {
    return ['chartIndicators'];
  }

  const chartIndicators = flat.chartIndicators as Record<string, unknown>;
  const ciFields = [
    'enabled',
    'entryPreset',
    'exitPreset',
    'rsiLength',
    'intervals',
    'candles',
    'rsiOversold',
    'rsiOverbought',
    'requireAllIntervals',
  ];
  for (const field of ciFields) {
    if (!(field in chartIndicators)) {
      return [`chartIndicators.${field}`];
    }
  }

  return [];
}

// Note: jupiterApiKey / JUPITER_API_KEY is required for Jupiter swap operations. Get a free key at https://developers.jup.ag/portal/
function resolveEnvRefs(config: Record<string, unknown>): Record<string, unknown> {
  const resolved: Record<string, unknown> = { ...config };
  for (const [key, value] of Object.entries(resolved)) {
    if (key === 'chartIndicators') continue;
    if (typeof value === 'string' && value.startsWith('env.')) {
      const envVar = value.slice(4);
      const envValue = process.env[envVar];
      if (envValue === undefined) {
        let helpNote = `Set ${envVar} in your .env file or environment.`;
        if (envVar === 'JUPITER_API_KEY' || key === 'jupiterApiKey') {
          helpNote += `\nJupiter API key is required for swap operations. Get a free API key at https://developers.jup.ag/portal/`;
        }
        throw new Error(`Environment variable ${envVar} is not set but is referenced by ${key} in user-config.json.\n${helpNote}`);
      }
      resolved[key] = envValue;
    }
  }
  return resolved;
}

function resolveChartIndicatorsEnv(chartIndicators: Record<string, unknown>): Record<string, unknown> {
  const resolved = { ...chartIndicators };
  for (const [key, value] of Object.entries(resolved)) {
    if (typeof value === 'string' && value.startsWith('env.')) {
      const envVar = value.slice(4);
      const envValue = process.env[envVar];
      if (envValue === undefined) {
        throw new Error(
          `Environment variable ${envVar} is not set but is referenced by chartIndicators.${key} in user-config.json.\n` +
            `Set ${envVar} in your .env file or environment.`,
        );
      }
      resolved[key] = envValue;
    }
  }
  return resolved;
}

function validateConfig(raw: Record<string, unknown>): ValidatedConfig {
  const flat = flattenUserConfig(raw);

  const missing = getMissingFields(flat);
  if (missing.length > 0) {
    throw new Error(
      `user-config.json is missing ${missing.length} required field(s):\n${missing.map((m) => `  - ${m}`).join('\n')}\n\n` +
        `Copy config/user-config.example.json to config/user-config.json and reapply your custom values.`,
    );
  }

  const chartIndicators = flat.chartIndicators as Record<string, unknown>;

  return {
    flat: resolveEnvRefs(flat),
    chartIndicators: resolveChartIndicatorsEnv(chartIndicators),
  };
}

function mergeIntoExample(exampleRaw: Record<string, unknown>, userRaw: Record<string, unknown>): Record<string, unknown> {
  const userFlat = flattenUserConfig(userRaw);
  const result = JSON.parse(JSON.stringify(exampleRaw)) as Record<string, unknown>;

  for (const [key, value] of Object.entries(userFlat)) {
    if (key === 'chartIndicators') continue;
    if (key === 'preset') {
      result.preset = value;
      continue;
    }

    let placed = false;
    for (const cat of CATEGORIES) {
      const catObj = result[cat];
      if (catObj && typeof catObj === 'object' && catObj !== null && !Array.isArray(catObj) && key in catObj) {
        (catObj as Record<string, unknown>)[key] = value;
        placed = true;
        break;
      }
    }

    if (!placed) {
      result[key] = value;
    }
  }

  // Merge chartIndicators if user provided it
  if (userRaw.chartIndicators && typeof userRaw.chartIndicators === 'object' && !Array.isArray(userRaw.chartIndicators)) {
    result.chartIndicators = {
      ...((result.chartIndicators as Record<string, unknown>) || {}),
      ...(userRaw.chartIndicators as Record<string, unknown>),
    };
  }

  return result;
}

export function loadAndValidateConfig(): ValidatedConfig {
  const USER_CONFIG_PATH = configPath('user-config.json');
  const EXAMPLE_CONFIG_PATH = configPath('user-config.example.json');

  if (process.env.TEST_MODE || process.env.VITEST) {
    if (!fs.existsSync(USER_CONFIG_PATH) && fs.existsSync(EXAMPLE_CONFIG_PATH)) {
      fs.copyFileSync(EXAMPLE_CONFIG_PATH, USER_CONFIG_PATH);
    }
  }

  if (!fs.existsSync(USER_CONFIG_PATH)) {
    if (fs.existsSync(EXAMPLE_CONFIG_PATH)) {
      console.log('[config] user-config.json not found, copying from example');
      fs.copyFileSync(EXAMPLE_CONFIG_PATH, USER_CONFIG_PATH);
    } else {
      throw new Error('user-config.json not found and no example config to copy from');
    }
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(fs.readFileSync(USER_CONFIG_PATH, 'utf8'));
  } catch (e) {
    throw new Error(`Failed to parse user-config.json: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (process.env.TEST_MODE || process.env.VITEST) {
    const flat = flattenUserConfig(raw);
    const resolved: Record<string, unknown> = { ...flat };
    for (const [key, value] of Object.entries(resolved)) {
      if (key === 'chartIndicators') continue;
      if (typeof value === 'string' && value.startsWith('env.')) {
        const envVar = value.slice(4);
        const envValue = process.env[envVar];
        if (envValue === undefined) {
          throw new Error(
            `Environment variable ${envVar} is not set but is referenced by ${key} in user-config.json.\n` +
              `Set ${envVar} in your .env file or environment.`,
          );
        }
        resolved[key] = envValue;
      }
    }
    const chartIndicators = (resolved.chartIndicators as Record<string, unknown>) || {};
    return { flat: resolveEnvRefs(resolved), chartIndicators: resolveChartIndicatorsEnv(chartIndicators) };
  }

  try {
    return validateConfig(raw);
  } catch (err) {
    const EXAMPLE_CONFIG_PATH = configPath('user-config.example.json');

    if (!fs.existsSync(EXAMPLE_CONFIG_PATH)) {
      throw err;
    }

    const exampleRaw = JSON.parse(fs.readFileSync(EXAMPLE_CONFIG_PATH, 'utf8')) as Record<string, unknown>;
    const userFlat = flattenUserConfig(raw);
    const exampleFlat = flattenUserConfig(exampleRaw);

    const missing = getMissingFields(flattenUserConfig(raw));
    if (missing.length === 0) {
      throw err;
    }

    const canAutoFill = missing.every((f) => {
      if (f.startsWith('chartIndicators.')) {
        const field = f.slice('chartIndicators.'.length);
        return field in ((exampleRaw.chartIndicators as Record<string, unknown>) || {});
      }
      return f in exampleFlat;
    });

    if (!canAutoFill) {
      throw err;
    }

    const missingFields = getMissingFields(flattenUserConfig(raw));
    console.log(`[config] user-config.json is missing ${missingFields.length} field(s), auto-filling from example:`);
    for (const field of missingFields) {
      if (field.startsWith('chartIndicators.')) {
        const fieldName = field.slice('chartIndicators.'.length);
        console.log(`  + ${field}: ${JSON.stringify(((exampleRaw.chartIndicators as Record<string, unknown>) || {})[fieldName])}`);
      } else {
        console.log(`  + ${field}: ${JSON.stringify(exampleFlat[field])}`);
      }
    }

    const merged = mergeIntoExample(JSON.parse(JSON.stringify(exampleRaw)) as Record<string, unknown>, raw);

    fs.writeFileSync(configPath('user-config.json'), JSON.stringify(merged, null, 2) + '\n');
    console.log('[config] Updated user-config.json with missing fields. Your custom values are preserved.');

    return validateConfig(merged);
  }
}
