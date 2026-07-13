# Meridian — Configuration Guide

Meridian uses a layered configuration system combining environment variables, a user-specific JSON configuration file, and fallback defaults.

```
                  ┌────────────────────────┐
                  │          .env          │ ─── API keys, Wallet Private Key,
                  └───────────┬────────────┘     Global default LLM_MODEL
                              ▼
                  ┌────────────────────────┐
                  │    user-config.json    │ ─── Risk rules, screening filters,
                  └───────────┬────────────┘     model-specific overrides
                              ▼
                  ┌────────────────────────┐
                  │    Config.ts           │ ─── Fallback defaults & Zod validation
                  └────────────────────────┘
```

> The canonical template is [`config/user-config.example.json`](../../config/user-config.example.json). `npm run setup` writes a `user-config.json` from a preset; you can also copy the example and edit by hand.

---

## 1. Environment Variables (`.env`)

Used strictly for private credentials, API keys, and global overrides. Kept out of JSON config files to avoid accidental code commits:
* `WALLET_PRIVATE_KEY`: Your Solana wallet's base58 private key.
* `RPC_URL`: Main Solana RPC endpoint.
* `HELIUS_API_KEY`: API key for Helius (used for wallet balances and token holders).
* `OPENROUTER_API_KEY`: OpenRouter API key for LLM calls.
* `LLM_MODEL`: Acts as the default LLM model for all three agent roles (`SCREENER`, `MANAGER`, `GENERAL`) unless overridden individually.
* `DRY_RUN`: Set to `true` (default) for safe simulation, `false` for live on-chain operations.
* `HIVEMIND_API_KEY`: Optional fallback for the HiveMind API key (see §2 HiveMind fields).

---

## 2. User Configuration (`user-config.json`)

### Hierarchy & Priority
If you define `LLM_MODEL` in `.env`, it is used for all agent loops. Per-role overrides set in `user-config.json` take priority:
```json
{
  "llmModel": "openrouter/hunter-alpha", // default for all loops
  "generalModel": "openai/gpt-4o",       // overrides llmModel for ad-hoc chats
  "screeningModel": "anthropic/claude-3" // overrides llmModel for screening
}
```
Precedence: specific model in `user-config.json` > `LLM_MODEL` in `.env` > built-in fallback.

### Field Reference

Every field below is read from `user-config.json` (flat keys are mapped into the typed config in `packages/core/src/config/Config.ts`). The **Example / what to expect** column is filled in for fields that are easy to misconfigure.

#### Identity & Connection
| Field | Purpose | Example / what to expect |
|-------|---------|--------------------------|
| `preset` | Profile the config was generated from. | `"moderate"` — informational; does not override explicit fields. |
| `rpcUrl` | Solana RPC endpoint used for chain reads. | `"https://pump.helius-rpc.com"` |
| `llmBaseUrl` | Custom OpenAI-compatible LLM endpoint (optional). | `""` → use OpenRouter default. |
| `llmApiKey` | LLM provider API key (alternative to `OPENROUTER_API_KEY`). | `""` |
| `llmModel` | Default model for all roles unless a per-role override is set. | `"minimax/minimax-m2.7"` |
| `dryRun` | `true` = simulate, never sign transactions. `false` = live. | `true` → safe mode, no on-chain writes. |
| `agentId` | Stable HiveMind instance id. Leave `""` to auto-generate `agt_...`. | `""` → written back on first startup. |

#### Screening Filters
| Field | Purpose | Example / what to expect |
|-------|---------|--------------------------|
| `timeframe` | Candle timeframe used by indicator scans. | `"5m"` → 5-minute candles. `"1m"` scans faster/shorter. |
| `category` | Pool category filter from the discovery API. | `"trending"` → trending pools. `"new"` → recently launched. |
| `excludeHighSupplyConcentration` | Skip tokens whose supply is concentrated in few wallets. | `true` → filters out likely dumps. `false` → includes them. |
| `minTvl` / `maxTvl` | Allowed total-value-locked window (USD). | `10000`–`150000` → only pools in that TVL band. |
| `minVolume` | Minimum 24h volume (USD). | `500` → pools under $500 volume are skipped. |
| `minOrganic` / `minQuoteOrganic` | Minimum "organic" (non-bot) score 0–100. | `60` → pools scoring below 60 organic are rejected. |
| `minHolders` | Minimum holder count. | `500` → thin-holder tokens excluded. |
| `minMcap` / `maxMcap` | Allowed market-cap window (USD). | `150000`–`10000000` → mid-cap band. |
| `minBinStep` / `maxBinStep` | Allowed Meteora bin-step range. | `80`–`125` → typical tradable band; outside is skipped. |
| `minFeeActiveTvlRatio` | Yield-quality gate: fees earned ÷ active TVL. | `0.05` → keep pools paying ≥5% of TVL in fees. `0.02` = looser (more, riskier pools); `0.1` = stricter (fewer, higher-yield). |
| `minTokenFeesSol` | Minimum fees the token itself has earned (SOL). | `30` → tokens with <30 SOL lifetime fees skipped. |
| `useDiscordSignals` | Enable external Discord signal ingestion. | `false` → ignore signals. |
| `discordSignalMode` | How signals combine with internal scoring. | `"merge"` blends; `"replace"` trusts signals over internal score. |
| `avoidPvpSymbols` / `blockPvpSymbols` | Handle PvP ("player vs player") tokens. | `avoidPvpSymbols: true` de-prioritizes; `blockPvpSymbols: true` hard-blocks them. |
| `maxBotHoldersPct` | Max % of holders that are bots/snipers. | `30` → pools where >30% of holders look like bots are skipped. |
| `maxTop10Pct` | Max % of supply held by the top 10 wallets. | `60` → if top-10 wallets hold >60% of supply, the token is skipped (supply-concentration guard). |
| `allowedLaunchpads` / `blockedLaunchpads` | Launchpad allow/deny lists. | `[]` → no restriction. `["pump"]` in `blockedLaunchpads` → skip pump.fun tokens. |
| `minTokenAgeHours` / `maxTokenAgeHours` | Token age window. `null` = no limit. | `null`/`null` → any age. `1`/`24` → only 1–24h-old tokens. |

#### Management & Exits
| Field | Purpose | Example / what to expect |
|-------|---------|--------------------------|
| `minClaimAmount` | Min fees (USD) before auto-claiming. | `5` → claim only when ≥$5 fees accrued. |
| `autoSwapAfterClaim` | Swap claimed base token back to SOL after claiming. | `false` → leave base token; `true` → auto-swap to SOL. |
| `outOfRangeBinsToClose` | Bins a position can drift out-of-range before it counts. | `10` → position must exceed active bin by >10 bins to be "OOR". |
| `outOfRangeWaitMinutes` | Minutes out-of-range before closing. | `30` → after 30m OOR, the deterministic rule closes it. `2` = fast exit on drift. |
| `oorCooldownTriggerCount` / `oorCooldownHours` | After N OOR closes, cooldown redeploys to that pool for H hours. | `3`/`12` → 3rd OOR close blocks re-entry for 12h. |
| `minVolumeToRebalance` | Volume threshold that permits rebalance logic. | `1000` |
| `stopLossPct` | Close when PnL ≤ this. Negative number. | `-50` → closes at −50% loss. `-15` = tighter risk. |
| `takeProfitPct` | Close when PnL ≥ this. | `5` → closes at +5% gain. `2` = quicker profit-taking. |
| `minFeePerTvl24h` | Min 24h fee/TVL (%) to avoid "low-yield" close. | `7` → yields under 7%/24h (after 60m age) trigger close. |
| `minAgeBeforeYieldCheck` | Age (min) before the low-yield rule applies. | `60` → protects brand-new positions from early low-yield close. |
| `trailingTakeProfit` | Enable trailing take-profit. | `true` → locks in gains as price rises. |
| `trailingTriggerPct` / `trailingDropPct` | Trailing activation / retrace thresholds. | `3`/`1.5` → arm at +3%, close on 1.5% drop from peak. |
| `pnlSanityMaxDiffPct` | Max allowed PnL discrepancy between sources. | `5` → bigger gaps are flagged/sanitized. |
| `solMode` | SOL-only operation mode. | `false` → normal; `true` → restricts to SOL-centric flows. |
| `deployAmountSol` | SOL deployed per position. | `0.1` → small size; `0.5` = larger. |
| `minSolToOpen` | Min SOL balance required to open. | `0.55` → skips deploy if wallet < 0.55 SOL. |
| `maxDeployAmount` | Cap on deploy size. | `50` → never deploy more than 50 SOL. |
| `gasReserve` | SOL kept in reserve for fees. | `0.2` → never let balance dip below this for gas. |
| `positionSizePct` | Fraction of available SOL per position. | `0.35` → ~35% of free SOL per deploy. |

#### Strategy
| Field | Purpose | Example / what to expect |
|-------|---------|--------------------------|
| `strategy` | LP strategy preset. | `"bid_ask"` → liquidity both sides of price. `"spot"` → centered. |
| `minBinsBelow` / `maxBinsBelow` / `defaultBinsBelow` | Bin range placed below the active bin. | `35`/`69`/`69` → stack 69 bins below active price. |

#### Schedule
| Field | Purpose | Example / what to expect |
|-------|---------|--------------------------|
| `managementIntervalMin` | Minutes between management cycles. | `10` → manage every 10 min. Must be ≤ your OOR wait to act in time. |
| `screeningIntervalMin` | Minutes between screening cycles. | `30` → screen every 30 min. |
| `healthCheckIntervalMin` | Minutes between health checks. | `60` → hourly. |

#### LLM
| Field | Purpose | Example / what to expect |
|-------|---------|--------------------------|
| `temperature` | Sampling temperature. | `0.37` → fairly deterministic. |
| `maxTokens` | Max tokens per LLM response. | `4096` |
| `maxSteps` | Max ReAct steps per loop. | `20` |
| `managementModel` / `screeningModel` / `generalModel` | Per-role model overrides of `llmModel`. | `"minimax/minimax-m2.5"` for screening; `"minimax/minimax-m2.7"` for chat. |

#### Darwin (Signal Evolution)
| Field | Purpose | Example / what to expect |
|-------|---------|--------------------------|
| `darwinEnabled` | Enable auto-evolving signal weights. | `true` → weights adjust from closed-position outcomes. |
| `darwinWindowDays` | Lookback window (days) for evolution. | `60` |
| `darwinRecalcEvery` | Recalc cadence (cycles). | `5` |
| `darwinBoost` / `darwinDecay` | Weight multipliers up/down. | `1.05`/`0.95` |
| `darwinFloor` / `darwinCeiling` | Weight bounds. | `0.3`/`2.5` |
| `darwinMinSamples` | Min samples before evolving. | `10` → avoids overfitting on tiny data. |

#### HiveMind (Collective Learning)
See [HIVEMIND.md](HIVEMIND.md) for the full pull/push lifecycle.
| Field | Purpose | Example / what to expect |
|-------|---------|--------------------------|
| `hiveMindUrl` | HiveMind backend base URL. Empty = disabled. | `""` → off. Set + key → on. |
| `hiveMindApiKey` | Auth key (or use `HIVEMIND_API_KEY` env). | `""` → disabled. |
| `hiveMindPullMode` | `auto` (default) or `manual`. | `"auto"` → pull on startup + every 15 min. `"manual"` → only on `/hive pull`. |

#### PnL Tracking
| Field | Purpose | Example / what to expect |
|-------|---------|--------------------------|
| `pnlSource` | PnL data source. | `"rpc"` → read positions via RPC. |
| `pnlRpcUrl` | RPC used for PnL reads. | `"https://pump.helius-rpc.com"` |
| `pnlPollIntervalSec` | Poll interval (seconds). | `3` |
| `pnlDepositCacheTtlSec` | Deposit cache TTL (seconds). | `300` |

#### GMGN
| Field | Purpose | Example / what to expect |
|-------|---------|--------------------------|
| `gmgnFeeSource` | Fee routing source. | `"gmgn"` |
| `gmgnApiKey` | GMGN API key (optional). | `""` |

#### Indicators (Chart Technical Analysis)
| Field | Purpose | Example / what to expect |
|-------|---------|--------------------------|
| `chartIndicators` | Object toggling RSI/supertrend entry-exit signals. | `{"enabled": false, "entryPreset": "supertrend_break", "rsiLength": 2, "intervals": ["5_MINUTE"], ...}` → `enabled:false` disables indicator gating. |

#### Telegram
| Field | Purpose | Example / what to expect |
|-------|---------|--------------------------|
| `telegramChatId` | Chat id for bot notifications/commands. | `""` → no Telegram. |

---

## 3. Config Parsing & Reloading (`Config.ts`)

* **Zod validation**: Values are verified at startup against the Zod schemas in [packages/core/src/shared/types.ts](../../packages/core/src/shared/types.ts). Invalid values fail fast with a clear error.
* **Dynamic Reloading**: `reloadScreeningThresholds()` re-reads `user-config.json` from disk at the start of every screening cycle, so you can edit screening filters and risk parameters without restarting the daemon.
* **Darwinian Auto-Evolution**: `npm run evolve` evaluates closed-position logs, updates thresholds (e.g. `minOrganic`), and writes them back into `user-config.json`.
