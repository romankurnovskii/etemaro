# Etemaro — Configuration Guide

Etemaro uses a strict schema-validated configuration system (Version 3): every required field MUST be present in the active JSON configuration file. By default the application reads `config/user-config.json`, but a custom path can be set via the `USER_CONFIG_PATH` environment variable.

```
              ┌────────────────────────┐
              │          .env          │ ─── Referenced via "env.VAR_NAME"
              └───────────┬────────────┘     in JSON config values
                          ▼
              ┌────────────────────────┐
              │    user-config.json    │ ─── Default config (or custom via
              └───────────┬────────────┘     USER_CONFIG_PATH env var)
                          ▼
              ┌────────────────────────┐
              │      schema.ts (Zod)   │ ─── Startup validation:
              └────────────────────────┘     ALL required fields must be present.
```

> First-time setup: `etemaro init` (creates `~/.config/etemaro` and checks wallet + LLM keys). From a source clone you can also run `pnpm cli init`.

**Wallet Setup (Recommended):** Use the secure keystore instead of env vars:
```bash
# Generate a new wallet (saved to ~/.config/etemaro/.credentials/wallets/<alias>.json)
etemaro wallet generate --name main-scalp

# Or import an existing key
etemaro wallet import --name main-scalp --prompt
# or: etemaro wallet import --name main-scalp --file /path/to/keypair.json

# Then reference the alias in your config:
# "connection": { "wallet": "main-scalp" }
```


---

## 1. `env.` Pattern (Referencing Environment Variables)

Any **string field** in `user-config.json` can reference an environment variable using the `env.` prefix:

```json
{
  "walletPrivateKey": "env.WALLET_PRIVATE_KEY",
  "rpcUrl": "env.MY_CUSTOM_RPC",
  "llm": {
    "apiKey": "env.LLM_API_KEY",
    "generalModel": "env.LLM_MODEL"
  }
}
```

The value is resolved from `process.env` at startup. If the referenced variable is not set, validation fails with a clear error.

This keeps secrets out of the JSON file — ideal for `walletPrivateKey`, API keys (`jupiter.apiKey`, `gmgn.apiKey`, `hiveMind.apiKey`, `api.publicApiKey`), and environment-specific URLs (`rpcUrl`, `pnl.rpcUrl`).

---

## 2. Environment Variables

> **Note:** The recommended approach for wallet private keys is the **keystore** (`~/.config/etemaro/.credentials/wallets/<alias>.json`). Environment variables for wallet keys are deprecated but still supported for backward compatibility.

Conventional environment variables the daemon reads:

- `RPC_URL`: Optional override for `connection.rpcUrl`.
- `RPC_URL_2`: Optional override for `connection.rpcUrl2` (fallback RPC URL on errors / rate limits).
- `HELIUS_API_KEY`: Helius API key used for wallet balances and token valuations. Required for normal wallet operation.
- `LLM_API_KEY`: API key for LLM provider.
- `LLM_BASE_URL`: LLM provider base URL.
- `LLM_MODEL`: Default LLM model name.
- `USER_CONFIG_PATH`: Absolute or repo-relative path to the active JSON config.
- `ETEMARO_DATA_DIR` (preferred) or `DATA_DIR`: Absolute path for runtime data (state, logs, lessons, pool memory). Default is `<repo>/data`.

### API key requirements

Required for normal operation:

- `HELIUS_API_KEY`: wallet balance and USD valuation requests.
- `JUPITER_API_KEY`: Jupiter swap operations.

Required only when the related integration is enabled:

- `GMGN_API_KEY`: when `gmgn.enabled` is `true` and `gmgn.feeSource` is `"gmgn"`.
- `LPAGENT_API_KEY`: when `api.lpAgent.enabled` is `true`.
- `DEFAULT_AGENT_MERIDIAN_PUBLIC_KEY`: for authenticated Meridian API requests. Meridian can make unauthenticated requests when the endpoint permits it.

Optional:

- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and `TELEGRAM_ALLOWED_USER_IDS`: Telegram notifications and control.
- `DRY_RUN` and `LOG_LEVEL`: runtime behavior overrides; defaults are `false` and `info`.

---

## 3. User Configuration (`user-config.json`)

### Schema Version 3

Configuration is a **nested JSON object**. The root contains `_version`, `preset`, `agentId`, and the `connection` block. All other settings are in named category objects.

```json
{
  "_version": 3,
  "preset": "custom",
  "agentId": "",
  "connection": {
    "rpcUrl": "https://pump.helius-rpc.com",
    "walletPrivateKey": "env.WALLET_PRIVATE_KEY",
    "dryRun": true,
    "telegramChatId": "env.TELEGRAM_CHAT_ID"
  },

  "risk": { "maxPositions": 1, "maxDeployAmount": 50 },
  "screening": { "entrySource": "market", "timeframe": "5m", ... },
  "management": { "stopLossPct": -50, "takeProfitPct": 5, ... },
  "strategy": { "activeStrategyId": "single_sided_reseed", ... },
  "schedule": { "managementIntervalMin": 10, ... },
  "llm": { "baseUrl": "env.LLM_BASE_URL", "apiKey": "env.LLM_API_KEY", "defaultModel": "env.LLM_MODEL", ... },
  "darwin": { "enabled": true, ... },
  "hiveMind": { "url": "...", "apiKey": "...", "pullMode": "auto" },
  "api": {
    "meridian": { "enabled": true, "url": "...", "publicApiKey": "...", "lpAgentRelayEnabled": false },
    "lpAgent": { "enabled": false, "url": "https://api.lpagent.io/open-api/v1", "apiKey": "env.LPAGENT_API_KEY" }
  },
  "pnl": { "source": "meteora_api", "rpcUrl": "...", "pollIntervalSec": 15, ... },
  "opportunity": { "enabled": true, "minScore": 40, ... },
  "gmgn": { "enabled": false, "feeSource": "gmgn", "baseUrl": "...", ... },
  "jupiter": { "apiKey": "env.JUPITER_API_KEY", ... },
  "chartIndicators": { "enabled": false, ... }
}
```

### Field Reference

#### Root Fields

| Field        | Purpose                                                         | Example                |
| ------------ | --------------------------------------------------------------- | ---------------------- |
| `_version`   | Schema version. Must be `3`.                                    | `3`                    |
| `preset`     | Informational label for the config profile.                     | `"custom"`             |
| `agentId`    | Stable HiveMind instance ID. `""` = auto-assign.                | `""` or `"agt_abc123"` |
| `connection` | Network, provider, wallet, runtime mode, and Telegram settings. | `{ ... }`              |

#### Connection

| Field                    | Purpose                                                       | Example                           |
| ------------------------ | ------------------------------------------------------------- | --------------------------------- |
| `rpcUrl`                 | Primary Solana RPC endpoint for chain reads and transactions. | `"https://pump.helius-rpc.com"`   |
| `rpcUrl2`                | Fallback Solana RPC endpoint on errors/rate-limits (optional).| `"env.RPC_URL_2"`                 |
| `wallet`                 | **Recommended.** Alias of a wallet in the keystore (`~/.config/etemaro/.credentials/wallets/<alias>.json`). | `"main-scalp"`                    |
| `walletPrivateKey`       | **Deprecated.** Wallet private key (base58). Use `wallet` alias instead. | `"env.WALLET_PRIVATE_KEY"`        |
| `heliusApiKey`           | Helius Wallet API key.                                        | `"env.HELIUS_API_KEY"`            |
| `dryRun`                 | Prevent live trade execution.                                 | `true`                            |
| `telegramChatId`         | Telegram destination chat ID.                                 | `"env.TELEGRAM_CHAT_ID"`          |
| `telegramBotToken`       | Telegram bot token.                                           | `"env.TELEGRAM_BOT_TOKEN"`        |
| `telegramAllowedUserIds` | Comma-separated Telegram user IDs allowed to control the bot. | `"env.TELEGRAM_ALLOWED_USER_IDS"` |

#### Risk

| Field             | Purpose                                | Example                       |
| ----------------- | -------------------------------------- | ----------------------------- |
| `maxPositions`    | Max simultaneously open positions.     | `3` → never hold more than 3. |
| `maxDeployAmount` | Hard cap on SOL deployed per position. | `50` → never deploy > 50 SOL. |

#### Screening

| Field                                     | Purpose                                           | Example / what to expect                                                                      |
| ----------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `entrySource`                             | Entry universe source.                            | `"market"` → trending pool discovery. `"smart_wallets"` → copy-entry from tracked LP wallets. |
| `timeframe`                               | Candle timeframe for indicator scans.             | `"5m"` → 5-minute candles.                                                                    |
| `category`                                | Pool category filter from the discovery API.      | `"trending"` → trending pools. `"new"` → recently launched.                                   |
| `excludeHighSupplyConcentration`          | Skip tokens with concentrated supply.             | `true` → filters out likely dumps.                                                            |
| `minTvl` / `maxTvl`                       | Allowed total-value-locked window (USD).          | `10000`–`150000`                                                                              |
| `minVolume`                               | Minimum 24h volume (USD).                         | `500`                                                                                         |
| `minOrganic` / `minQuoteOrganic`          | Minimum organic (non-bot) score 0–100.            | `60`                                                                                          |
| `minHolders`                              | Minimum holder count.                             | `500`                                                                                         |
| `minMcap` / `maxMcap`                     | Allowed market-cap window (USD).                  | `150000`–`10000000`                                                                           |
| `minBinStep` / `maxBinStep`               | Allowed Meteora bin-step range.                   | `80`–`125`                                                                                    |
| `minFeeActiveTvlRatio`                    | Yield-quality gate: fees ÷ active TVL.            | `0.05` → keep pools paying ≥5%.                                                               |
| `minTokenFeesSol`                         | Minimum lifetime fees the token has earned (SOL). | `30`                                                                                          |
| `avoidPvpSymbols` / `blockPvpSymbols`     | Handle PvP tokens.                                | `avoidPvpSymbols: true` de-prioritizes; `blockPvpSymbols: true` hard-blocks.                  |
| `maxBotHoldersPct`                        | Max % of holders that are bots.                   | `30`                                                                                          |
| `maxTop10Pct`                             | Max % of supply held by top 10 wallets.           | `60`                                                                                          |
| `loneCandidateMinDegen`                   | Min degen score for a lone (single) candidate.    | `50`                                                                                          |
| `allowedLaunchpads` / `blockedLaunchpads` | Launchpad allow/deny lists.                       | `[]` → no restriction.                                                                        |
| `minTokenAgeHours` / `maxTokenAgeHours`   | Token age window. `null` = no limit.              | `null`/`null` → any age.                                                                      |

#### Management & Exits

| Field                                          | Purpose                                                | Example / what to expect                              |
| ---------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------- |
| `minClaimAmount`                               | Min fees (USD) before auto-claiming.                   | `5`                                                   |
| `autoSwapAfterClaim`                           | Swap claimed base token back to SOL after claiming.    | `true` → auto-swap to SOL.                            |
| `autoSwapRetryAttempts`                        | Retries if auto-swap fails.                            | `3`                                                   |
| `autoSwapRetryDelayMs`                         | Delay between auto-swap retries (ms).                  | `3000`                                                |
| `autoSwapInterSwapDelayMs`                     | Delay between sequential token swaps in a batch (ms).  | `1500`                                                |
| `haltOnSwapFailure`                            | Enable circuit-breaker after repeated swap failures.   | `true` → blocks deploys until operator resets.        |
| `maxFailedSwapsBeforeHalt`                     | Consecutive failed swaps before circuit-breaker trips. | `5`                                                   |
| `outOfRangeBinsToClose`                        | Bins a position can drift OOR before it counts.        | `10`                                                  |
| `outOfRangeWaitMinutes`                        | Minutes OOR before closing.                            | `30`                                                  |
| `oorCooldownTriggerCount` / `oorCooldownHours` | After N OOR closes, cooldown redeploys for H hours.    | `3`/`12`                                              |
| `repeatDeployCooldownEnabled`                  | Enable cooldown after repeat deploys to the same pool. | `true`                                                |
| `repeatDeployCooldownTriggerCount`             | Deploys before cooldown activates.                     | `3`                                                   |
| `repeatDeployCooldownHours`                    | Cooldown duration (hours).                             | `12`                                                  |
| `repeatDeployCooldownScope`                    | Scope of repeat-deploy cooldown.                       | `"token"` → same token; `"pool"` → same pool.         |
| `repeatDeployCooldownMinFeeEarnedPct`          | Minimum fee earned (%) to reset cooldown.              | `0`                                                   |
| `minVolumeToRebalance`                         | Volume threshold that permits rebalance.               | `1000`                                                |
| `stopLossPct`                                  | Close when PnL ≤ this (negative number).               | `-50` → closes at −50% loss.                          |
| `takeProfitPct`                                | Close when PnL ≥ this.                                 | `5` → closes at +5% gain.                             |
| `minFeePerTvl24h`                              | Min 24h fee/TVL (%) to avoid low-yield close.          | `7`                                                   |
| `minAgeBeforeYieldCheck`                       | Age (min) before the low-yield rule applies.           | `60`                                                  |
| `trailingTakeProfit`                           | Enable trailing take-profit.                           | `true`                                                |
| `trailingTriggerPct` / `trailingDropPct`       | Trailing activation / retrace thresholds.              | `3`/`1.5` → arm at +3%, close on 1.5% drop from peak. |
| `pnlSanityMaxDiffPct`                          | Max allowed PnL discrepancy between sources.           | `5`                                                   |
| `solMode`                                      | SOL-only operation mode.                               | `false` → normal.                                     |
| `deployAmountSol`                              | SOL deployed per position.                             | `0.1`                                                 |
| `minSolToOpen`                                 | Min SOL balance required to open a position.           | `0.55`                                                |
| `gasReserve`                                   | SOL kept in reserve for fees.                          | `0.1`                                                 |
| `positionSizePct`                              | Fraction of available SOL per position.                | `0.35` → ~35%.                                        |

#### Strategy

| Field                                                | Purpose                                | Example / what to expect                                     |
| ---------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------ |
| `activeStrategyId`                                   | Active strategy preset ID.             | `"single_sided_reseed"`                                      |
| `strategyMeteora`                                    | LP strategy preset.                    | `"bid_ask"` → edges. `"spot"` → centered. `"curve"` → curve. |
| `minBinsBelow` / `maxBinsBelow` / `defaultBinsBelow` | Bin range placed below the active bin. | `10`/`69`/`69`                                               |
| `minSafeBinsBelow`                                   | Safety floor for `minBinsBelow`.       | `10`                                                         |

#### Schedule

| Field                    | Purpose                            | Example |
| ------------------------ | ---------------------------------- | ------- |
| `managementIntervalMin`  | Minutes between management cycles. | `10`    |
| `screeningIntervalMin`   | Minutes between screening cycles.  | `30`    |
| `healthCheckIntervalMin` | Minutes between health checks.     | `60`    |

#### LLM

| Field                                                 | Purpose                                | Example                          |
| ----------------------------------------------------- | -------------------------------------- | -------------------------------- |
| `baseUrl`                                             | Custom OpenAI-compatible LLM endpoint. | `"env.LLM_BASE_URL"`             |
| `apiKey`                                              | LLM provider API key.                  | `"env.LLM_API_KEY"`              |
| `defaultModel` (or `model`)                           | Global fallback LLM model. Can be a direct model string or an env reference. When set directly (e.g. `"anthropic/claude-3.5-sonnet"`), `LLM_MODEL` env var is not required. | `"env.LLM_MODEL"` or `"anthropic/claude-3.5-sonnet"` |
| `temperature`                                         | Sampling temperature.                  | `0.37`                           |
| `maxTokens`                                           | Max tokens per LLM response.           | `10000`                          |
| `maxSteps`                                            | Max ReAct steps per loop.              | `20`                             |
| `managementModel` / `screeningModel` / `generalModel` | Per-role model overrides. Automatically fall back to `defaultModel` if omitted or if `LLM_MODEL` is unset. | `"env.LLM_MODEL"` or `"openai/gpt-4o"` |

#### Darwin (Signal Evolution)

| Field                           | Purpose                              | Example       |
| ------------------------------- | ------------------------------------ | ------------- |
| `enabled`                       | Enable auto-evolving signal weights. | `true`        |
| `windowDays`                    | Lookback window (days).              | `60`          |
| `recalcEvery`                   | Recalc cadence (cycles).             | `5`           |
| `boostFactor` / `decayFactor`   | Weight multipliers up/down.          | `1.05`/`0.95` |
| `weightFloor` / `weightCeiling` | Weight bounds.                       | `0.3`/`2.5`   |
| `minSamples`                    | Min samples before evolving.         | `10`          |

#### HiveMind (Collective Learning)

See [HIVEMIND.md](HIVEMIND.md) for the full pull/push lifecycle.

| Field      | Purpose                                                      | Example                                                                       |
| ---------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `enabled`  | Enable HiveMind lesson and preset synchronization.           | `true`                                                                        |
| `url`      | HiveMind backend base URL.                                   | `"https://api.agentmeridian.xyz"`                                             |
| `apiKey`   | Auth key.                                                    | `"env.HIVEMIND_API_KEY"` → recommended via env var.                           |
| `agentId`  | Stable HiveMind instance ID. `""` = auto-generate `agt_...`. | `""` → written back on first startup.                                         |
| `pullMode` | `"auto"` (default) or `"manual"`.                            | `"auto"` → pull on startup + every 15 min. `"manual"` → only on `/hive pull`. |

#### API Integrations

The `api` block contains two independent services.

##### Meridian

| Field                 | Purpose                                | Example                               |
| --------------------- | -------------------------------------- | ------------------------------------- |
| `enabled`             | Enable Meridian API requests.          | `true`                                |
| `url`                 | Meridian API base URL.                 | `"https://api.agentmeridian.xyz/api"` |
| `publicApiKey`        | Public API key for Meridian endpoints. | `"env.AGENT_MERIDIAN_PUBLIC_API_KEY"` |
| `lpAgentRelayEnabled` | Enable Meridian relay execution.       | `false`                               |

##### LPAgent

| Field     | Purpose                               | Example                                |
| --------- | ------------------------------------- | -------------------------------------- |
| `enabled` | Enable LPAgent position-data lookups. | `false`                                |
| `url`     | LPAgent API base URL.                 | `"https://api.lpagent.io/open-api/v1"` |
| `apiKey`  | LPAgent API key.                      | `"env.LPAGENT_API_KEY"`                |

#### PnL Tracking

| Field                | Purpose                      | Example                                                |
| -------------------- | ---------------------------- | ------------------------------------------------------ |
| `source`             | PnL data source.             | `"meteora_api"` (Recommended default: free Meteora Datapi, 0 RPC credits) or `"rpc"` (On-chain DLMM reads). |
| `rpcUrl`             | RPC used for PnL reads.      | `"https://pump.helius-rpc.com"` or `"env.PNL_RPC_URL"` |
| `pollIntervalSec`    | Poll interval (seconds).     | `15`                                                   |
| `depositCacheTtlSec` | Deposit cache TTL (seconds). | `300`                                                  |
| `confirmTicks`       | Confirm ticks for PnL calc.  | `2`                                                    |

> **Cost Optimization Note**: Setting `source: "meteora_api"` eliminates Solana RPC calls for position tracking and PnL monitoring by utilizing Meteora's free indexed REST API. See [RPC_AND_API_OPTIMIZATION.md](RPC_AND_API_OPTIMIZATION.md) for full details.

#### Opportunity (Smart Wallet Poller)

| Field                   | Purpose                                   | Example |
| ----------------------- | ----------------------------------------- | ------- |
| `enabled`               | Enable the background opportunity poller. | `true`  |
| `pollIntervalSec`       | Poll interval (seconds).                  | `45`    |
| `limit`                 | Max candidates per poll.                  | `10`    |
| `minScore`              | Minimum degen score to consider.          | `40`    |
| `smartWalletScoreBonus` | Score bonus for smart-wallet presence.    | `20`    |
| `targetVolRatio`        | Target 24h volume / liquidity ratio.      | `20`    |
| `targetLpCount`         | Target LP count.                          | `40`    |
| `targetFeeRatio`        | Target fee / TVL ratio.                   | `0.2`   |
| `targetLiquidity`       | Minimum liquidity (USD).                  | `20000` |

#### GMGN

| Field            | Purpose                      | Example                      |
| ---------------- | ---------------------------- | ---------------------------- |
| `enabled`        | Enable GMGN fee lookups.     | `false`                      |
| `feeSource`      | Fee routing source.          | `"gmgn"`                     |
| `apiKey`         | GMGN API key (optional).     | `""` or `"env.GMGN_API_KEY"` |
| `baseUrl`        | GMGN API base URL.           | `"https://openapi.gmgn.ai"`  |
| `requestDelayMs` | Delay between requests (ms). | `2500`                       |
| `maxRetries`     | Max retries on failure.      | `2`                          |

#### Jupiter

| Field             | Purpose                       | Example                                  |
| ----------------- | ----------------------------- | ---------------------------------------- |
| `apiKey`          | Jupiter API key.              | `"env.JUPITER_API_KEY"`                  |
| `referralAccount` | Referral wallet address.      | `""` or `"env.JUPITER_REFERRAL_ACCOUNT"` |
| `referralFeeBps`  | Referral fee in basis points. | `50` → 0.5%                              |

#### Indicators (Chart Technical Analysis)

| Field                 | Purpose                        | Example                                                               |
| --------------------- | ------------------------------ | --------------------------------------------------------------------- |
| `enabled`             | Enable indicator gating.       | `false` → disabled. `true` → RSI/supertrend must pass for entry/exit. |
| `entryPreset`         | Preset name for entry signals. | `"supertrend_break"`                                                  |
| `exitPreset`          | Preset name for exit signals.  | `"supertrend_break"`                                                  |
| `rsiLength`           | RSI period length.             | `2`                                                                   |
| `intervals`           | Candle intervals to evaluate.  | `["5_MINUTE"]`                                                        |
| `candles`             | Number of candles to fetch.    | `298`                                                                 |
| `rsiOversold`         | RSI threshold for oversold.    | `30`                                                                  |
| `rsiOverbought`       | RSI threshold for overbought.  | `80`                                                                  |
| `requireAllIntervals` | Require all intervals to pass. | `false` → any interval passes; `true` → all must pass.                |

---

## 4. Config Parsing & Validation

- **Startup validation**: `loadAndValidateConfig()` reads the config JSON and passes it through the Zod schema (`schema.ts`). Any missing or wrong-type field causes an immediate failure listing every offending path:
  ```
  Error: user-config.json has invalid or missing fields:
    - screening.minTvl: Required
    - hiveMind.pullMode: Required
  ```
- **No backward compatibility**: Version 3 is strict. Old V1/V2 keys (`darwinEnabled`, `hiveMindUrl`, `pnlSource`, `connection.*`, etc.) are not accepted — update your config to V3.
- **Dynamic Reloading**: `reloadScreeningThresholds()` re-reads the config file at the start of every screening cycle and applies changes to the running singleton without restart.

---

## 5. Editing Config at Runtime

Use the `update_config` tool (Telegram `/setcfg` or agent self-tuning) to change fields without restarting. Nested paths are supported:

```json
{
  "screening.minOrganic": 70,
  "management.stopLossPct": -20
}
```

Changes are persisted to the active config file immediately and take effect on the next screening cycle.

---

## 6. Configuration Lifecycle & Test Isolation Conventions

### In-Memory Singleton (`config`)
- Etemaro exports a singleton `config: AppConfig` built on process startup from `user-config.json` and evaluated environment variables.
- Modules import `config` directly to read active runtime settings.
- When dynamic settings are updated (e.g. via `reloadScreeningThresholds()` or `setActiveStrategy()`), the in-memory singleton is mutated in-place to keep all references synchronized.

### Environment Variable Fallbacks
- On config load, `applyUserConfigToEnv` propagates user credentials (RPC URL, Telegram tokens, wallet keys) into `process.env` using `||=` fallback semantics so explicit CLI/shell environment variables maintain precedence.

### Test Isolation Best Practices
- **Snapshot & Restore**: Test suites that mutate `process.env` (e.g., `USER_CONFIG_PATH`, `RPC_URL`) must snapshot `process.env` in `beforeEach` and restore it in `afterEach`.
- **`resetConfig()` Helper**: Call `resetConfig()` from `@etemaro/core` in test fixtures whenever simulating different configuration files or environment state. This re-evaluates all defaults and refreshes the singleton without requiring module reloading.

