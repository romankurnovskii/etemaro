# Reference: Agent Config & Strategy Expectation Analysis

**Purpose.** Before judging whether the agent performed well, reconstruct *what it was configured to do* — and therefore what "working as expected" means for this run. This section is the baseline that the performance, exit, smart-wallet and incident sections are compared against.

Every report MUST contain this analysis (template section *2 · Agent Configuration & Expected Strategy Behavior*). If no config file can be found, write **"No agent config found in this run"** and list what was searched — never guess.

---

## 1. Locate the configuration

Read these, highest authority first. All are optional; if one is absent, say so.

| Priority | Path pattern | What it holds |
| --- | --- | --- |
| 1 | `config/instances/<instance-id>.json` | Exact per-instance runtime config for the run |
| 1 | `<target-dir>/<instance-id>.json`, `<target-dir>/agent-config*.json`, or the same one directory up | Config copied beside the run dir (the `data/instances/<agentId>/` layout) |
| 2 | `config/templates/agent-config.example.json` | Field meanings and defaults if the instance config is missing |
| 3 | `config/shared/strategy-library.json` (+ `strategy-library.shared.json`) | The strategy entry named by `strategy.activeStrategyId` |
| 3 | `config/shared/smart-wallets.json` | Wallet list resolved from the active strategy-library entry: `strategies[config.strategy.activeStrategyId].smartWalletListId` (the agent config has **no** `smartWalletListId` field) |
| 4 | first `agent_loop_start` record's `metadata.goal` in `logs/structured-*.jsonl` | Effective resolved prompt values (strategy notes, limits, deploy amount) |

Instance config ids look like `agent-config.smart-wallet-follow.v260922-003`
(`vYYMMDD` = version, `-N` = variant). `scripts/03_incidents.py` resolves this
path and records it as `config_path` in `03-incidents.json` — read it from there
rather than re-deriving it.

**Instances.** `agent-config.<strategy>.<class>.v<YYMMDD>-<n>`: `vYYMMDD` = config version, `-n` = variant. If the target-dir basename matches an instance, prefer the config with the same basename; otherwise use the newest `config/instances/agent-config*`.

**Redaction (hard rule).** Never print secret values. Render `apiKey`, `publicApiKey`, `heliusApiKey`, `telegramBotToken`, Jupiter/GMGN/HiveMind keys, wallet private material and any `*Key` / `*Token` / `*Secret` as `***`. Keep `env.*` references literal (e.g. `env.RPC_URL`). Never open `.env*`, `*.prod` or `.credentials/*`.

## 2. Config snapshot

Extract into a compact table (values as-is, masked). Cover, when present:

| Area | Fields that matter for the review |
| --- | --- |
| connection | `wallet`, `dryRun`, RPC endpoint names, `telegramEnabled`, `telegramPolling`, `allowSelfUpdate`, `ipcPort`/`ipcToken`/`ipcSocketPath`/`ipcHost` |
| risk | `maxPositions`, `maxDeployAmount` |
| screening | `entrySource` (`market`\|`smart_wallets`), `timeframe`, `category`, `minTvl`/`maxTvl`, `minVolume`, `minOrganic`/`minQuoteOrganic`, `minHolders`, `minMcap`/`maxMcap`, `minBinStep`/`maxBinStep`, `minFeeActiveTvlRatio`, `minTokenFeesSol`, `excludeHighSupplyConcentration`, `avoidPvpSymbols`/`blockPvpSymbols`, `maxBotHoldersPct`, `maxTop10Pct`, `loneCandidateMinDegen`, `minTokenAgeHours`/`maxTokenAgeHours`, `allowedLaunchpads`/`blockedLaunchpads` |
| opportunity | `enabled`, `pollIntervalSec`, `minScore`, `smartWalletScoreBonus`, `target*` |
| strategy | `activeStrategyId`, `strategyMeteora`, `minBinsBelow`, `maxBinsBelow`, `defaultBinsBelow`, `minSafeBinsBelow`; resolve `smartWalletListId` from the strategy-library entry |
| management | `minClaimAmount`, `autoSwapAfterClaim`/`autoSwapRetryAttempts`/`autoSwapRetryDelayMs`/`autoSwapInterSwapDelayMs`, `haltOnSwapFailure`/`maxFailedSwapsBeforeHalt`, `outOfRangeBinsToClose`/`outOfRangeWaitMinutes`, `oorCooldownTriggerCount`/`oorCooldownHours`, `repeatDeployCooldown*`, `minVolumeToRebalance`, `stopLossPct`, `takeProfitPct`, `trailingTakeProfit`/`trailingTriggerPct`/`trailingDropPct`, `minFeePerTvl24h`, `minAgeBeforeYieldCheck`, `minSolToOpen`, `deployAmountSol`, `gasReserve`, `positionSizePct`, `pnlSanityMaxDiffPct`, `solMode`, `sweeperEnabled`/`sweeperIntervalMin`/`sweeperMinUsd`/`sweeperAlertUsd`/`sweeperMaxAttempts`/`sweeperAbandonWindowHours` |
| schedule | `managementIntervalMin`, `screeningIntervalMin`, `healthCheckIntervalMin` |
| pnl | `source` (`meteora_api`\|`rpc`), `rpcUrl`, `pollIntervalSec`, `depositCacheTtlSec`, `confirmTicks` |
| darwin | `enabled`, `windowDays`, `recalcEvery`, factor/floor/ceiling, `minSamples` |
| llm | `temperature`, `maxTokens`, `maxSteps`, model roles (mask keys) |
| api / gmgn / jupiter | `enabled` flags only; mask keys |
| chartIndicators | `enabled`, presets |

## 3. Expected-behavior model

Derive, from the config, how the agent **should** behave for every recurring trigger. Present as a matrix:

| Event / Trigger | Governing config | Expected behavior | Machine-checkable expectation | Verify in |
| --- | --- | --- | --- | --- |
| Screening cycle every `screeningIntervalMin` | `screening.*`, `schedule` | … | … | `logs/agent-*.log` `[cron]` / `[agent]` |

Rows to include (only where the config has the field):

1. **Screening cycle** — cadence `screeningIntervalMin`; universe = `screening.entrySource` (`market` = trending scrape, `smart_wallets` = tracked LP wallets).
2. **Deterministic filters** — every candidate must pass TVL/volume/organic/holders/mcap/binStep/age/PvP/concentration bounds before the LLM sees it.
3. **Opportunity gate** — if `opportunity.enabled`, a pool fires only when `score >= minScore`; `smartWalletScoreBonus` is added when tracked wallets are present. State the effective path in words (e.g. `minScore=9999` + bonus `10000` ⇒ *only* smart-wallet presence can trigger a deploy).
4. **Smart-wallet poller** — when `entrySource=smart_wallets`: every cycle fetch each `type: lp` wallet's positions, diff against `.smart-wallets-snapshot.json`, and deploy into newly seen pools (subject to filters and `maxPositions`).
5. **Deploy** — resolved `amount_sol` from `deployAmountSol` / `positionSizePct` / adaptive sizing; strategy `strategyMeteora`; `bins_below = round(minBinsBelow + (volatility/5)*(maxBinsBelow-minBinsBelow))` clamped to [min,max]; single-side SOL: `bins_above=0`, `amount_x=0`.
6. **Management / PnL tick** — `pnl.pollIntervalSec`, `confirmTicks` (exit latency = tick × confirm); source `meteora_api` vs `rpc`.
7. **Take profit** — close when PnL ≥ `takeProfitPct`; if `trailingTakeProfit`, arm at `trailingTriggerPct`, close on `trailingDropPct` retrace.
8. **Stop loss** — close when PnL ≤ `stopLossPct` (state "no stop configured" if null/0).
9. **Out-of-range** — after `outOfRangeWaitMinutes` and `outOfRangeBinsToClose`, close; `oorCooldownTriggerCount` / `oorCooldownHours` after repeats.
10. **Yield check** — close/rebalance when `minFeePerTvl24h` is not met after `minAgeBeforeYieldCheck`.
11. **Position cap** — never exceed `maxPositions`, never deploy above `maxDeployAmount`.
12. **Repeat-deploy cooldown** — after `repeatDeployCooldownTriggerCount` within `repeatDeployCooldownHours`, scope `repeatDeployCooldownScope`.
13. **Claim / auto-swap** — claim when fees ≥ `minClaimAmount`; if `autoSwapAfterClaim`, swap back to SOL; halt after `maxFailedSwapsBeforeHalt` when `haltOnSwapFailure`.
14. **Darwin** — every `recalcEvery` closed positions, reweight signals within floor/ceiling once `minSamples` is reached.
15. **Health check** — every `healthCheckIntervalMin`.
16. **Unsold-token sweeper** — when `sweeperEnabled`, every `sweeperIntervalMin` the agent swaps non-SOL residuals back to SOL (tool `sweep_unsold_tokens`); residuals ≥ `sweeperMinUsd` are tracked in `state.pendingLiquidations`, alert at `sweeperAlertUsd`, retry up to `sweeperMaxAttempts`, and are abandoned after `sweeperAbandonWindowHours`.

Every expected behavior must be phrased so a later section can mark it **observed / partially observed / not observed**, with a log or store citation.

## 4. Config vs strategy consistency checks

Flag mismatches between the runtime config and the strategy-library entry as findings (they change real behavior):

- `management.takeProfitPct` / `stopLossPct` vs strategy-library `exit.takeProfitPct` (config wins at runtime; a stale strategy note is a documentation bug).
- `strategy.strategyMeteora` vs strategy-library `lpStrategy`.
- `screening.entrySource = smart_wallets` but the active strategy-library entry has no `smartWalletListId`, or the referenced list is missing/empty (a startup failure per `strategy-library.ts`).
- `opportunity.smartWalletScoreBonus > 0` but no wallet list resolvable.
- strategy-library `range.binsBelowPct` vs `strategy.minBinsBelow` / `maxBinsBelow`.
- `deployAmountSol` vs `positionSizePct` vs `maxDeployAmount` — which one actually bound the observed size.
- `sweeperEnabled` vs actual residuals: if `lessons.json` contains `status: closed_pending_swap` or `state.pendingLiquidations` is non-empty while the sweeper is disabled, that is a finding.

## 5. Worked shape (illustrative)

For a config with `entrySource=smart_wallets`, `opportunity.minScore=9999`, `smartWalletScoreBonus=10000`, `maxPositions=1`, `takeProfitPct=0.2`, the expected model is: **no position may open without a tracked `lp` wallet present; exactly one position at a time; exits dominated by a 0.2% take-profit.** Any deploy without a wallet signal, or two simultaneous positions, is a gate failure — regardless of PnL.

## 6. Output requirements

The HTML section must contain, at minimum:

1. config source path + `activeStrategyId` + mode;
2. the config snapshot table;
3. the expected-behavior matrix (all rows derivable from the config);
4. consistency findings (or "none found");
5. a one-line **As-configured baseline** sentence the rest of the report references.

Machine-readable mirror (optional but recommended): save the same model as `reports/REPORT-YYYY-MM-DD.config-analysis.json` next to the HTML.