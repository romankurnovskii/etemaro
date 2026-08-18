# Etemaro — Configuration Guide

Etemaro uses a single-source configuration system: every field MUST be present in the active JSON configuration file. By default, the application reads `config/user-config.json`, but a custom configuration file path can be passed via the `USER_CONFIG_PATH` environment variable (or per-agent `userConfigPath` in Desktop App's `config/agents.json`).

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
                  │  ConfigValidator.ts    │ ─── Startup validation & auto-migration:
                  └────────────────────────┘     ALL fields must be present.
```

> The canonical template is [`config/user-config.example.json`](../../config/user-config.example.json). Copy this template to `config/user-config.json` (`cp config/user-config.example.json config/user-config.json`) or specify custom files via `USER_CONFIG_PATH`.

---

## 1. `env.` Pattern (Referencing Environment Variables)

Any **string field** in `user-config.json` can reference an environment variable using the `env.` prefix:

```json
{
  "connection": {
    "walletKey": "env.WALLET_PRIVATE_KEY",
    "rpcUrl": "env.MY_CUSTOM_RPC"
  },
  "llm": {
    "generalModel": "env.LLM_MODEL"
  }
}
```

The value is resolved from `process.env` at startup. If the referenced variable is not set, validation fails with a clear error.

This keeps secrets out of the JSON file — ideal for `walletKey`, API keys (`jupiterApiKey`, `gmgnApiKey`, `hiveMindApiKey`, `publicApiKey`), and environment-specific URLs (`rpcUrl`, `pnlRpcUrl`).

---

## 2. Environment Variables

Conventional environment variables that the daemon reads:

- `WALLET_PRIVATE_KEY`: Your Solana wallet's base58 private key.
- `RPC_URL`: Main Solana RPC endpoint.
- `HELIUS_API_KEY`: API key for Helius (used for wallet balances and token holders).
- `LLM_API_KEY`: API key for LLM provider.
- `DRY_RUN`: Set to `true` (default) for safe simulation, `false` for live on-chain operations.
- `USER_CONFIG_PATH`: Absolute path to the active JSON config (Desktop / multi-agent). When the basename is not a generic `user-config*`, state files under the data dir are auto-suffixed (e.g. `state-agt_….json`).
- `ETEMARO_DATA_DIR` (preferred) or `DATA_DIR`: Absolute path for runtime data (state, logs, lessons, notifications, pool memory). Default is `<repo>/data`. Desktop sets `ETEMARO_DATA_DIR` from each agent's `dataDir` so the UI log viewer and the daemon write to the same tree. Must be present in the process environment **before** Node starts (not switched mid-process).

---

## 3. User Configuration (`user-config.json`)

### Format

`user-config.json` is organized into **categories** that mirror the internal `AppConfig` structure. Each category has a `description` field explaining its purpose.

```json
{
  "preset": "custom",
  "connection": {
    "description": "Network endpoints, API credentials, wallet key, LLM provider settings, and runtime mode.",
    "rpcUrl": "https://pump.helius-rpc.com",
    "walletKey": "env.WALLET_PRIVATE_KEY",
    "llmBaseUrl": "",
    "llmApiKey": "",
    "llmModel": "minimax/minimax-m2.7",
    "dryRun": true,
    "telegramChatId": ""
  },
  "risk": {
    "description": "Global capital limits that cap exposure regardless of how many positions look attractive.",
    "maxPositions": 3,
    "maxDeployAmount": 50
  },
  "screening": {
    "description": "Filters applied when scanning for new pool candidates.",
    "entrySource": "market",
    "timeframe": "5m",
    "category": "trending",
    ...
  }
}
```

### Hierarchy

- Nested category values are the single source of truth.
- A legacy flat-key format is also accepted (old configs still work), but flat keys at the top level override nested values.
- The `env.` prefix is resolved from `process.env` after flattening.

### Field Reference

#### Connection

| Field            | Purpose                                                        | Example / what to expect                                         |
| ---------------- | -------------------------------------------------------------- | ---------------------------------------------------------------- |
| `preset`         | Profile the config was generated from.                         | `"moderate"` — informational; does not override explicit fields. |
| `rpcUrl`         | Solana RPC endpoint used for chain reads.                      | `"https://pump.helius-rpc.com"` or `"env.MY_RPC_URL"`            |
| `walletKey`      | Wallet private key (base58).                                   | `"env.WALLET_PRIVATE_KEY"` → use `WALLET_PRIVATE_KEY` env var.   |
| `llmBaseUrl`     | Custom OpenAI-compatible LLM endpoint (optional).              | `""` → use OpenRouter default, or `"env.MY_LLM_BASE_URL"`        |
| `llmApiKey`      | LLM provider API key.                                          | `""` or `"env.LLM_API_KEY"`                                      |
| `llmModel`       | Default model for all roles unless a per-role override is set. | `"minimax/minimax-m2.7"` or `"env.LLM_MODEL"`                    |
| `dryRun`         | `true` = simulate, never sign transactions. `false` = live.    | `true` → safe mode, no on-chain writes.                          |
| `telegramChatId` | Chat id for bot notifications/commands.                        | `""` → no Telegram.                                              |

#### Risk

| Field             | Purpose                                | Example / what to expect      |
| ----------------- | -------------------------------------- | ----------------------------- |
| `maxPositions`    | Maximum number of open positions.      | `3` → never hold more than 3. |
| `maxDeployAmount` | Hard cap on SOL deployed per position. | `50` → never deploy > 50 SOL. |

#### Screening

| Field                                     | Purpose                                                  | Example / what to expect                                                                                                      |
| ----------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `entrySource`                             | Entry universe source for pool candidates.               | `"market"` → trending pool discovery + LLM screener. `"smart_wallets"` → copy-entry from tracked LP wallets (bypasses LLM).   |
| `timeframe`                               | Candle timeframe used by indicator scans.                | `"5m"` → 5-minute candles. `"1m"` scans faster/shorter.                                                                       |
| `category`                                | Pool category filter from the discovery API.             | `"trending"` → trending pools. `"new"` → recently launched.                                                                   |
| `excludeHighSupplyConcentration`          | Skip tokens whose supply is concentrated in few wallets. | `true` → filters out likely dumps. `false` → includes them.                                                                   |
| `minTvl` / `maxTvl`                       | Allowed total-value-locked window (USD).                 | `10000`–`150000` → only pools in that TVL band.                                                                               |
| `minVolume`                               | Minimum 24h volume (USD).                                | `500` → pools under $500 volume are skipped.                                                                                  |
| `minOrganic` / `minQuoteOrganic`          | Minimum "organic" (non-bot) score 0–100.                 | `60` → pools scoring below 60 organic are rejected.                                                                           |
| `minHolders`                              | Minimum holder count.                                    | `500` → thin-holder tokens excluded.                                                                                          |
| `minMcap` / `maxMcap`                     | Allowed market-cap window (USD).                         | `150000`–`10000000` → mid-cap band.                                                                                           |
| `minBinStep` / `maxBinStep`               | Allowed Meteora bin-step range.                          | `80`–`125` → typical tradable band; outside is skipped.                                                                       |
| `minFeeActiveTvlRatio`                    | Yield-quality gate: fees earned ÷ active TVL.            | `0.05` → keep pools paying ≥5% of TVL in fees. `0.02` = looser (more, riskier pools); `0.1` = stricter (fewer, higher-yield). |
| `minTokenFeesSol`                         | Minimum fees the token itself has earned (SOL).          | `30` → tokens with <30 SOL lifetime fees skipped.                                                                             |
| `useDiscordSignals`                       | Enable external Discord signal ingestion.                | `false` → ignore signals.                                                                                                     |
| `discordSignalMode`                       | How signals combine with internal scoring.               | `"merge"` blends; `"replace"` trusts signals over internal score.                                                             |
| `avoidPvpSymbols` / `blockPvpSymbols`     | Handle PvP ("player vs player") tokens.                  | `avoidPvpSymbols: true` de-prioritizes; `blockPvpSymbols: true` hard-blocks them.                                             |
| `maxBotHoldersPct`                        | Max % of holders that are bots/snipers.                  | `30` → pools where >30% of holders look like bots are skipped.                                                                |
| `maxTop10Pct`                             | Max % of supply held by the top 10 wallets.              | `60` → if top-10 wallets hold >60% of supply, the token is skipped (supply-concentration guard).                              |
| `loneCandidateMinDegen`                   | Minimum degen score for a lone (single) candidate.       | `50` → lone candidates below 50 degen score are skipped.                                                                      |
| `allowedLaunchpads` / `blockedLaunchpads` | Launchpad allow/deny lists.                              | `[]` → no restriction. `["pump"]` in `blockedLaunchpads` → skip pump.fun tokens.                                              |
| `minTokenAgeHours` / `maxTokenAgeHours`   | Token age window.`null` = no limit.                      | `null`/`null` → any age. `1`/`24` → only 1–24h-old tokens.                                                                    |

#### Management & Exits

| Field                                          | Purpose                                                                 | Example / what to expect                                                          |
| ---------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `minClaimAmount`                               | Min fees (USD) before auto-claiming.                                    | `5` → claim only when ≥$5 fees accrued.                                           |
| `autoSwapAfterClaim`                           | Swap claimed base token back to SOL after claiming.                     | `false` → leave base token; `true` → auto-swap to SOL.                            |
| `autoSwapRetryAttempts`                        | Number of retries if auto-swap fails.                                   | `3` → retry up to 3 times.                                                        |
| `autoSwapRetryDelayMs`                         | Delay between auto-swap retries (ms).                                   | `3000` → wait 3s between attempts.                                                |
| `autoSwapInterSwapDelayMs`                     | Delay between sequential token swaps in a batch (ms).                   | `1500` → ~40 swaps/min, safe for Free Jupiter tier (60 RPM).                      |
| `haltOnSwapFailure`                            | Enable circuit-breaker: block new deploys after repeated swap failures. | `true` → fail-safe (block deploys). `false` → log only, keep deploying.           |
| `maxFailedSwapsBeforeHalt`                     | Consecutive failed swaps before circuit-breaker trips.                  | `5` → after 5 failed swaps, new deploys are blocked until operator resets.        |
| `outOfRangeBinsToClose`                        | Bins a position can drift out-of-range before it counts.                | `10` → position must exceed active bin by >10 bins to be "OOR".                   |
| `outOfRangeWaitMinutes`                        | Minutes out-of-range before closing.                                    | `30` → after 30m OOR, the deterministic rule closes it. `2` = fast exit on drift. |
| `oorCooldownTriggerCount` / `oorCooldownHours` | After N OOR closes, cooldown redeploys to that pool for H hours.        | `3`/`12` → 3rd OOR close blocks re-entry for 12h.                                 |
| `repeatDeployCooldownEnabled`                  | Enable cooldown after repeat deploys to the same pool.                  | `true` → prevents immediate re-deploy to the same pool.                           |
| `repeatDeployCooldownTriggerCount`             | Number of deploys before cooldown activates.                            | `3` → cooldown after 3 deploys.                                                   |
| `repeatDeployCooldownHours`                    | Cooldown duration (hours) after repeat deploys.                         | `12` → block re-deploy for 12h.                                                   |
| `repeatDeployCooldownScope`                    | Scope of repeat-deploy cooldown.                                        | `"token"` → same token; `"pool"` → same pool.                                     |
| `repeatDeployCooldownMinFeeEarnedPct`          | Minimum fee earned (%) to reset the repeat-deploy cooldown.             | `0` → any positive fee resets cooldown.                                           |
| `minVolumeToRebalance`                         | Volume threshold that permits rebalance logic.                          | `1000`                                                                            |
| `stopLossPct`                                  | Close when PnL ≤ this. Negative number.                                 | `-50` → closes at −50% loss. `-15` = tighter risk.                                |
| `takeProfitPct`                                | Close when PnL ≥ this.                                                  | `5` → closes at +5% gain. `2` = quicker profit-taking.                            |
| `minFeePerTvl24h`                              | Min 24h fee/TVL (%) to avoid "low-yield" close.                         | `7` → yields under 7%/24h (after 60m age) trigger close.                          |
| `minAgeBeforeYieldCheck`                       | Age (min) before the low-yield rule applies.                            | `60` → protects brand-new positions from early low-yield close.                   |
| `trailingTakeProfit`                           | Enable trailing take-profit.                                            | `true` → locks in gains as price rises.                                           |
| `trailingTriggerPct` / `trailingDropPct`       | Trailing activation / retrace thresholds.                               | `3`/`1.5` → arm at +3%, close on 1.5% drop from peak.                             |
| `pnlSanityMaxDiffPct`                          | Max allowed PnL discrepancy between sources.                            | `5` → bigger gaps are flagged/sanitized.                                          |
| `solMode`                                      | SOL-only operation mode.                                                | `false` → normal; `true` → restricts to SOL-centric flows.                        |
| `deployAmountSol`                              | SOL deployed per position.                                              | `0.1` → small size; `0.5` = larger.                                               |
| `minSolToOpen`                                 | Min SOL balance required to open.                                       | `0.55` → skips deploy if wallet < 0.55 SOL.                                       |
| `maxDeployAmount`                              | Cap on deploy size.                                                     | `50` → never deploy more than 50 SOL.                                             |
| `gasReserve`                                   | SOL kept in reserve for fees.                                           | `0.2` → never let balance dip below this for gas.                                 |
| `positionSizePct`                              | Fraction of available SOL per position.                                 | `0.35` → ~35% of free SOL per deploy.                                             |

#### Strategy

| Field                                                | Purpose                                | Example / what to expect                                          |
| ---------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------- |
| `strategy`                                           | LP strategy preset.                    | `"bid_ask"` → liquidity both sides of price. `"spot"` → centered. |
| `minBinsBelow` / `maxBinsBelow` / `defaultBinsBelow` | Bin range placed below the active bin. | `10`/`69`/`69` → stack 69 bins below active price.                |
| `minSafeBinsBelow`                                   | Safety floor for minBinsBelow.         | `10` → default floor. Can be lowered (e.g., `5`) for sparse data. |

> **Note:** The default safety floor for `minBinsBelow` is **10**. You can override it via `minSafeBinsBelow` in the config. Setting a lower value (e.g., `5`) allows fewer bins in sparse datasets; raising it adds extra safety margin.

#### Schedule

| Field                    | Purpose                            | Example / what to expect                                            |
| ------------------------ | ---------------------------------- | ------------------------------------------------------------------- |
| `managementIntervalMin`  | Minutes between management cycles. | `10` → manage every 10 min. Must be ≤ your OOR wait to act in time. |
| `screeningIntervalMin`   | Minutes between screening cycles.  | `30` → screen every 30 min.                                         |
| `healthCheckIntervalMin` | Minutes between health checks.     | `60` → hourly.                                                      |

#### LLM

| Field                                                 | Purpose                                | Example / what to expect                                                   |
| ----------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------- |
| `temperature`                                         | Sampling temperature.                  | `0.37` → fairly deterministic.                                             |
| `maxTokens`                                           | Max tokens per LLM response.           | `4096`                                                                     |
| `maxSteps`                                            | Max ReAct steps per loop.              | `20`                                                                       |
| `managementModel` / `screeningModel` / `generalModel` | Per-role model overrides of`llmModel`. | `"minimax/minimax-m2.5"` for screening; `"minimax/minimax-m2.7"` for chat. |

#### Darwin (Signal Evolution)

| Field                           | Purpose                               | Example / what to expect                               |
| ------------------------------- | ------------------------------------- | ------------------------------------------------------ |
| `darwinEnabled`                 | Enable auto-evolving signal weights.  | `true` → weights adjust from closed-position outcomes. |
| `darwinWindowDays`              | Lookback window (days) for evolution. | `60`                                                   |
| `darwinRecalcEvery`             | Recalc cadence (cycles).              | `5`                                                    |
| `darwinBoost` / `darwinDecay`   | Weight multipliers up/down.           | `1.05`/`0.95`                                          |
| `darwinFloor` / `darwinCeiling` | Weight bounds.                        | `0.3`/`2.5`                                            |
| `darwinMinSamples`              | Min samples before evolving.          | `10` → avoids overfitting on tiny data.                |

#### HiveMind (Collective Learning)

See [HIVEMIND.md](HIVEMIND.md) for the full pull/push lifecycle.

| Field              | Purpose                                                            | Example / what to expect                                                      |
| ------------------ | ------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `hiveMindUrl`      | HiveMind backend base URL. Empty = disabled.                       | `"https://api.agentmeridian.xyz"` → on. Set empty to disable.                 |
| `hiveMindApiKey`   | Auth key.                                                          | `"env.HIVEMIND_API_KEY"` → recommended via env var.                           |
| `agentId`          | Stable HiveMind instance id. Leave`""` to auto-generate `agt_...`. | `""` → written back on first startup.                                         |
| `hiveMindPullMode` | `auto` (default) or `manual`.                                      | `"auto"` → pull on startup + every 15 min. `"manual"` → only on `/hive pull`. |

#### API (Meridian & Relay)

| Field                 | Purpose                                | Example / what to expect                          |
| --------------------- | -------------------------------------- | ------------------------------------------------- |
| `agentMeridianApiUrl` | Meridian API base URL.                 | `"https://api.agentmeridian.xyz/api"`             |
| `publicApiKey`        | Public API key for Meridian endpoints. | `"env.PUBLIC_API_KEY"` → recommended via env var. |
| `lpAgentRelayEnabled` | Enable LP agent relay.                 | `false` → relay off.                              |

#### PnL Tracking

| Field                   | Purpose                      | Example / what to expect                               |
| ----------------------- | ---------------------------- | ------------------------------------------------------ |
| `pnlSource`             | PnL data source.             | `"rpc"` → read positions via RPC.                      |
| `pnlRpcUrl`             | RPC used for PnL reads.      | `"https://pump.helius-rpc.com"` or `"env.PNL_RPC_URL"` |
| `pnlPollIntervalSec`    | Poll interval (seconds).     | `3`                                                    |
| `pnlDepositCacheTtlSec` | Deposit cache TTL (seconds). | `300`                                                  |
| `pnlConfirmTicks`       | Confirm ticks for PnL calc.  | `2`                                                    |

#### Opportunity (Smart Wallet Poller)

| Field                         | Purpose                                   | Example / what to expect           |
| ----------------------------- | ----------------------------------------- | ---------------------------------- |
| `opportunityPollEnabled`      | Enable the background opportunity poller. | `true` → poller runs.              |
| `opportunityPollIntervalSec`  | Poll interval (seconds).                  | `45`                               |
| `opportunityPollLimit`        | Max candidates per poll.                  | `10`                               |
| `opportunityMinScore`         | Minimum degen score to consider.          | `40`                               |
| `opportunitySmartWalletBonus` | Score bonus for smart-wallet presence.    | `20`                               |
| `degenTargetVolRatio`         | Target 24h volume / liquidity ratio.      | `20` → vol must be ≥20× liquidity. |
| `degenTargetLpCount`          | Target LP count.                          | `40`                               |
| `degenTargetFeeRatio`         | Target fee / TVL ratio.                   | `0.2` → fees ≥20% of TVL.          |
| `degenTargetLiquidity`        | Minimum liquidity (USD).                  | `20000`                            |

The opportunity poller checks whether tracked smart wallets (configured in `data/smart-wallets.json`) are present in high-degen candidate pools. If smart wallets are found, the effective degen-score threshold is lowered by `opportunitySmartWalletBonus` points, allowing the agent to act on pools it would otherwise skip. See [QA.md — Smart Wallets](QA.md#smart-wallets-kol--alpha-tracking) for how to maintain the tracked-wallet list.

#### GMGN

| Field                | Purpose                      | Example / what to expect     |
| -------------------- | ---------------------------- | ---------------------------- |
| `gmgnFeeSource`      | Fee routing source.          | `"gmgn"`                     |
| `gmgnApiKey`         | GMGN API key (optional).     | `""` or `"env.GMGN_API_KEY"` |
| `gmgnBaseUrl`        | GMGN API base URL.           | `"https://openapi.gmgn.ai"`  |
| `gmgnRequestDelayMs` | Delay between requests (ms). | `2500` → 2.5s.               |
| `gmgnMaxRetries`     | Max retries on failure.      | `2`                          |

#### Jupiter

| Field                    | Purpose                       | Example / what to expect                 |
| ------------------------ | ----------------------------- | ---------------------------------------- |
| `jupiterApiKey`          | Jupiter API key.              | `""` or `"env.JUPITER_API_KEY"`          |
| `jupiterReferralAccount` | Referral wallet address.      | `""` or `"env.JUPITER_REFERRAL_ACCOUNT"` |
| `jupiterReferralFeeBps`  | Referral fee in basis points. | `50` → 0.5%                              |

#### Indicators (Chart Technical Analysis)

| Field                 | Purpose                        | Example / what to expect                                              |
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

## 3. Config Parsing & Reloading

- **Startup validation**: `ConfigValidator.ts` reads `user-config.json`, flattens nested categories, resolves `env.` references, and validates **ALL** required fields are present. Missing fields cause immediate failure with a clear list.
- **No fallback defaults**: Every field MUST be in `user-config.json`. The code has no hardcoded defaults — the example config is the single source of truth.
- **Dynamic Reloading**: `reloadScreeningThresholds()` re-reads `user-config.json` at the start of every screening cycle, re-resolves `env.` refs, and applies changes without restarting.
- **Darwinian Auto-Evolution**: `npm run evolve` evaluates closed-position logs, updates thresholds (e.g. `minOrganic`), and writes them back into `user-config.json`.

---

## 4. Editing Config at Runtime

Use the `update_config` tool (Telegram `/setcfg` or agent self-tuning) to change fields without restarting. Changes are persisted to `user-config.json` immediately.

Example:

```json
{
  "minOrganic": 70,
  "stopLossPct": -20
}
```

The tool maps these flat keys to their nested categories on write. Fields modified at runtime appear as flat keys at the top level of `user-config.json` and take precedence over nested category values on subsequent reads.

---

## 5. Automatic Configuration Upgrades & Schema Migrations

Etemaro automatically tracks and upgrades your active configuration file (`config/user-config.json` or any custom JSON config specified via `USER_CONFIG_PATH`) when new app versions introduce new fields or schema changes.

### How It Works

1. **Schema Versioning**: The active config file includes a top-level `_version` field (e.g. `"_version": 1`). Legacy unversioned configurations are recognized as `_version: 0`.
2. **Auto-Migration Runner**: On app startup, `loadAndValidateConfig()` invokes `ConfigMigrator.ts` prior to strict schema validation.
3. **Default Auto-Filling**: If an upgrade introduces new configuration fields (such as `autoSwapInterSwapDelayMs`), the runner auto-fills missing default values from `config/user-config.example.json` into their respective categories.
4. **Preserves Custom Settings**: Your existing custom threshold overrides and API keys are strictly preserved.
5. **Automatic Backup (`.bak`)**: Before updating the target configuration file on disk, a backup copy is automatically created (e.g., `user-config.json.bak` or `custom-config.json.bak`) to prevent data loss.

### Logging Example

When an upgrade occurs, the daemon logs clear migration information:

```text
[config] Migrated user-config.json schema from v0 to v1
[config]   + Auto-filled 1 new field(s): autoSwapInterSwapDelayMs
```

### Adding New Migrations (For Developers)

When adding new configuration options in a PR:

1. Update `config/user-config.example.json` with the new field and default value.
2. Increment `CURRENT_CONFIG_VERSION` in `packages/core/src/config/ConfigMigrator.ts` if a structural transformation or key rename is required.
3. Add a new migration step to the `MIGRATIONS` array in `ConfigMigrator.ts`.
