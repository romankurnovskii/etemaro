# Meridian — CLAUDE.md

Autonomous DLMM liquidity provider agent for Meteora pools on Solana.

> **Audience**: future agents/sessions that need to make non-trivial changes
> (add a tool, change a safety rule, fix a cron race, extend a state file)
> without re-reading the whole repo. The README stays user-facing; this
> file is the engineering manual.

---

## TL;DR (read this first)

- **What it is**: Node 22+ ESM service that runs an LLM-driven loop
  (OpenAI-compatible) to screen Meteora DLMM pools, deploy SOL into
  long/short positions, monitor them, and close them — all without a human
  in the loop. Telegram + Discord provide ops surface; HiveMind provides
  shared learning.
- **Entry points**: `node index.js` (full daemon — REPL + cron + Telegram),
  `node cli.js <cmd>` (one-shot CLI), `node setup.js` (first-run wizard).
- **Two agent roles run automatically**:
  - `SCREENER` — every `screeningIntervalMin` minutes, picks a pool,
    calls `deploy_position`.
  - `MANAGER` — every `managementIntervalMin` minutes, evaluates open
    positions, claims/closes them.
- **`GENERAL`** role handles ad-hoc chat (REPL, Telegram, Claude Code
  slash commands) and dispatches to a role-filtered tool subset based on
  intent-pattern matching of the user's goal.
- **All state lives in JSON files at the repo root** — see
  [§ Persistent files](#persistent-files) below. There is no DB.
- **"Always first read the rest of this file"** — there are real
  cross-cutting invariants (lazy SDK load, ONCE_PER_SESSION tool locks,
  position-cache TTL, trailing-TP 15s recheck) that are easy to break.

---

## Architecture

```
                ┌──────────────────────────────────────────────┐
                │              index.js  (daemon)              │
                │  REPL + cron + Telegram bot + PnL poller    │
                │  Health check + briefing + HiveMind HB      │
                └────────────┬─────────────────────────────────┘
                             │
            ┌────────────────┼────────────────────┐
            ▼                ▼                    ▼
       runScreeningCycle  runManagementCycle  cron (every N min)
            │                │                    │
            └────────┬───────┘                    │
                     ▼                            │
                 agentLoop() ◀────────────────────┘
                  (ReAct)               (telegram / REPL messages)
                     │
                     ▼
              buildSystemPrompt(role, …)  →  LLM  →  tool calls
                                                       │
                                                       ▼
                                                executeTool(name, args)
                                                       │
                                                       ▼
                                              PROTECTED_TOOLS →
                                              runSafetyChecks()
                                                       │
                                                       ▼
                                                toolMap[name](args)
                                                       │
                                  ┌────────────────────┴──────────┐
                                  ▼                                ▼
                       tools/dlmm.js (SDK)               tools/wallet.js (Jupiter)
                       tools/screening.js                tools/token.js (Jupiter)
                       tools/study.js (LPAgent)         tools/agent-meridian.js
                                                      tools/chart-indicators.js
                                  │                                │
                                  └──────── on-chain + 3rd-party APIs ─┘
```

### Module responsibilities (read me before editing)

| File | Lines | Purpose |
|---|---:|---|
| **Entry / orchestration** | | |
| `index.js` | ~2016 | Daemon. Cron, REPL, Telegram bot, briefing, HiveMind bootstrap, PnL poller, deterministic close rules, single-candidate skip rule, settings menu. **All** automatic cycles start here. |
| `agent.js` | 416 | `agentLoop(goal, maxSteps, history, agentType, model, maxOut, opts)`. The ReAct loop. Provider fallback, JSON repair, once-per-session tool locks, no-tool retries, `onToolStart`/`onToolFinish` callbacks for live Telegram messages. |
| `cli.js` | 676 | One-shot CLI; every tool exposed as a subcommand. Also writes a `~/.meridian/SKILL.md` at startup for agent discovery. Loads `.env`/`user-config.json` from `~/.meridian/` if present, else from cwd. |
| `setup.js` | ~750 | Interactive first-run wizard. Three presets (degen/moderate/safe) + custom. Covers strategy, screening filters, position sizing, trailing TP, per-role models. |
| **Config & state** | | |
| `config.js` | 278 | Loads `user-config.json` → live `config` object. Sections: `risk`, `screening`, `management`, `strategy`, `schedule`, `llm`, `darwin`, `tokens`, `hiveMind`, `api`, `jupiter`, `indicators`. Exposes `computeDeployAmount(walletSol)`, `reloadScreeningThresholds()`. `MIN_SAFE_BINS_BELOW = 35` (exported). |
| `prompt.js` | 176 | `buildSystemPrompt(agentType, …)`. Three role-specific prompts. MANAGER is intentionally lean (positions pre-loaded into goal). SCREENER gets bins_below formula. |
| **Tools layer** | | |
| `tools/definitions.js` | 1124 | OpenAI-format tool schemas. **Source of truth for what the LLM sees.** All 40+ tool names listed. |
| `tools/executor.js` | 844 | `executeTool(name, args)`. Pre-flight safety checks for `PROTECTED_TOOLS = {deploy, claim, close, swap, self_update}`. Validates pool thresholds via fresh pool discovery call before deploy. Post-tool side-effects: telegram notifications, pool-memory auto-annotation on `low yield` close, auto-swap base→SOL on close. |
| `tools/dlmm.js` | huge | Meteora DLMM SDK wrapper. **Lazy-loads** `@meteora-ag/dlmm` to avoid CJS-import-time crash in DRY_RUN/test. Pool cache (5 min), metadata cache (15 min), positions cache (5 min TTL + inflight dedup). `deployPosition`, `getMyPositions`, `getPositionPnl`, `getActiveBin`, `closePosition`, `claimFees`, `searchPools`, `getWalletPositions`, `addLiquidity`, `withdrawLiquidity`. Also has relay-mode (zap-in via LPAgent) and wide-range path (multi-tx `createExtendedEmptyPosition` + `addLiquidityByStrategyChunkable` for >69 bin ranges). Asserts Meteora bin-array initialization rent never charged. |
| `tools/screening.js` | 862 | `discoverPools`, `getTopCandidates` (hard filter + enrich + score), `getPoolDetail`. Scoring = `fee_tvl*1000 + organic*10 + vol/100 + holders/100`. Has Discord signal merge/only modes, PVP-rival detection. |
| `tools/wallet.js` | 251 | `getWalletBalances` (Helius), `swapToken` (Jupiter Swap V2). `normalizeMint` collapses "SOL"/"native"/any So1-prefixed token to wrapped-SOL. Built-in referral: 50 bps to a fixed address (configurable). |
| `tools/token.js` | 209 | `getTokenInfo` (Jupiter datapi), `getTokenHolders` (top 100 + filter pool-tagged), `getTokenNarrative` (Jupiter ChainInsight). Cross-references smart wallets from `smart-wallets.json`. |
| `tools/study.js` | 152 | `studyTopLPers` → Agent Meridian `/top-lp` + `/study-top-lp`. Returns ranked LPer patterns (avg hold, win rate, preferred strategy). |
| `tools/agent-meridian.js` | 110 | `agentMeridianJson(path, opts)` with retry/backoff. Default base = `https://api.agentmeridian.xyz/api`. |
| `tools/chart-indicators.js` | 299 | `confirmIndicatorPreset({mint, side})`. Eight presets: `supertrend_break`, `rsi_reversal`, `bollinger_reversion`, `rsi_plus_supertrend`, `supertrend_or_rsi`, `bb_plus_rsi`, `fibo_reclaim`, `fibo_reject`. Fetches from Agent Meridian `/chart-indicators/{mint}`. |
| **Persistence (all `.json` at repo root)** | | |
| `state.js` | 513 | `trackPosition`, `markOutOfRange/InRange`, `recordClaim`, `recordClose`, `setPositionInstruction`, `updatePnlAndCheckExits` (the deterministic rules: STOP_LOSS, TRAILING_TP, OUT_OF_RANGE, LOW_YIELD), `getStateSummary`. `syncOpenPositions` reconciles local state with on-chain after 5 min grace. |
| `pool-memory.js` | 405 | Per-pool deploy history + rolling 48-snapshot trend (5min × 4h). Computes `avg_pnl_pct`, `win_rate`, `adjusted_win_rate` (excludes OOR pumps). Cooldown logic: low yield → 4h pool cooldown, 3× OOR closes → 12h pool+token cooldown, optional repeat-deploy cooldown (configurable trigger count/hours/min fee yield/scope). `recordPositionSnapshot`, `recallForPool` for prompt injection. |
| `lessons.js` | 765 | `recordPerformance(perf)` called by executor after `close_position`. Builds lesson string (PREFER/AVOID/WORKED/FAILED). Pinned + role-tagged lesson injection (3-tier cap: PINNED, ROLE, RECENT) with `ROLE_TAGS` map. `evolveThresholds` adjusts `minOrganic` (auto), and writes `[AUTO-EVOLVED @ N]` lesson + applies to live `config`. **Known bug: also references `maxVolatility` and `minFeeTvlRatio` which don't exist in config — no-op for those keys.** `pushHiveLesson`/`pushHivePerformanceEvent` are fire-and-forget. |
| `decision-log.js` | 68 | Rolling 100-entry log. Types: `deploy` / `close` / `skip` / `no_deploy`. Each entry: actor, pool, summary, reason, risks[], metrics{}, rejected[]. Surfaced via `get_recent_decisions` tool and `getDecisionSummary()` in the prompt. |
| `signal-tracker.js` | 87 | In-memory 10-min staging for screening-time signals (`organic_score`, `fee_tvl_ratio`, …). Cleared on deploy or TTL. **Not persisted** — fine because the staged snapshot is also written to `state.json` via `trackPosition({ signal_snapshot })`. |
| `signal-weights.js` | 330 | Darwinian signal weighting. Recalculates every 5 closes (or 10-sample min). Splits signals into quartiles; top → `weight*1.05`, bottom → `weight*0.95`. Persists `signal-weights.json`. `getWeightsSummary()` injected into SCREENER prompt. |
| `strategy-library.js` | 227 | Saved LP strategies. Five defaults preloaded: `custom_ratio_spot`, `single_sided_reseed`, `fee_compounding`, `multi_layer`, `partial_harvest`. `getActiveStrategy()` → used in SCREENER prompt. |
| `smart-wallets.js` | 103 | Tracked KOL/alpha wallets. `type: "lp"` (default) checks positions; `type: "holder"` only checks token holdings. 5-min position cache. `check_smart_wallets_on_pool` is the deployment confidence signal. |
| `token-blacklist.js` | 103 | Mint → reason. Hard-filtered before LLM in `getTopCandidates`. |
| `dev-blocklist.js` | 66 | Deployer wallet → reason. Hard-filtered before LLM, fetched from Jupiter dev field. |
| `hivemind.js` | 346 | Agent Meridian shared learning. `bootstrapHiveMind` on startup, `startHiveMindBackgroundSync` every 15 min. Pushes lessons + performance events; pulls shared lessons + presets. `getSharedLessonsForPrompt` → injected under `── HIVEMIND ──` in prompt. Failures are non-blocking. |
| **Integrations** | | |
| `telegram.js` | 494 | `startPolling(onMessage)`, `stopPolling()`. Long-poll with 35s abort. `createLiveMessage` returns a handle with `toolStart/toolFinish/note/finalize/fail` for live progress. Sends deploy/close/swap/OOR notifications. Auth: `isAuthorizedIncomingMessage` (chatId match + group→allowed user IDs). Registers `/help` `/status` `/positions` `/close` `/closeall` `/set` `/settings` `/setcfg` `/screen` `/candidates` `/deploy` `/briefing` `/hive` `/pause` `/resume` `/stop` via `setMyCommands`. |
| `discord-listener/index.js` | 152 | Selfbot (uses `discord.js-selfbot-v13`). Listens to `DISCORD_CHANNEL_IDS` for `Metlex Pool Bot`, extracts Solana addresses, runs pre-check pipeline, appends to `discord-signals.json`. |
| `discord-listener/pre-checks.js` | 205 | Pipeline: dedup (10min) → blacklist → pool resolution (Meteora direct → DexScreener) → rugcheck.xyz (score>50000 OR top10>60% reject) → deployer blacklist → Jupiter global fees check (`minTokenFeesSol`). |
| `briefing.js` | 71 | HTML daily report. 24h activity, performance, lessons, current portfolio. Sent at 1:00 UTC. |
| `envcrypt.js` | 121 | XOR-cipher with a key from `.envrypt`/`ENVRYPT_KEY`. Encrypts anything matching `*_KEY`, `*SECRET*`, `*TOKEN*`, `*MNEMONIC*`, etc. The `# encrypted` marker in `.env` precedes encrypted lines. |
| `logger.js` | 75 | Daily-rotating `logs/agent-YYYY-MM-DD.log`. `logAction({tool, args, result, duration_ms, success})` writes JSONL `actions-YYYY-MM-DD.jsonl` audit trail. Level via `LOG_LEVEL` env. |
| **Other** | | |
| `discord-listener/`, `test/`, `scripts/`, `utils/` | | Discord listener (above), syntax-checked tests, envcrypt CLI, `safeNumber`. |
| `.claude/agents/{screener,manager}.md` | | Claude Code sub-agent configs — used when you run `claude` inside the repo. |
| `.claude/commands/*.md` | | Slash commands (`/screen`, `/manage`, `/balance`, `/candidates`, `/pool-ohlcv`, etc.) that wrap `cli.js`. |
| `.claude/settings.json` | | Denies `rm -rf`, `wget`, `Read(./.env*)`. **Forbids `run_in_background: true` via a PreToolUse hook.** |

---

## Agent roles & tool access

Three roles (`agent.js:7-8`):

| Role | Tool set (filter on `MANAGER_TOOLS` / `SCREENER_TOOLS` / `INTENT_TOOLS`) | Prompt source |
|---|---|---|
| `SCREENER` | `deploy_position, get_active_bin, get_top_candidates, check_smart_wallets_on_pool, get_token_holders, get_token_narrative, get_token_info, search_pools, get_pool_memory, get_wallet_balance, get_my_positions` | `prompt.js:104` — strict regime, "no hallucination" hard rule, must call `deploy_position` to claim success. |
| `MANAGER` | `close_position, claim_fees, swap_token, get_position_pnl, get_my_positions, get_wallet_balance` | `prompt.js:18` — *mechanical rule-application*; positions + management config pre-loaded in goal. |
| `GENERAL` | Intent-pattern matched (see `INTENT_PATTERNS` in `agent.js:51`). 17 intents: decisions, deploy, close, claim, swap, selfupdate, blocklist, config, balance, positions, strategy, screen, memory, smartwallet, study, performance, lessons. | `prompt.js:156` — full instruction-following. |

Some tools are explicitly **never** sent to GENERAL unless the goal matches an intent: `self_update`, `update_config`, all `add/remove_*` and `pin_/unpin_` tools, `clear_lessons`, `set_active_strategy` (see `GENERAL_INTENT_ONLY_TOOLS`).

### Adding a new tool

1. **`tools/definitions.js`** — add the OpenAI-format schema to the `tools` array.
2. **`tools/executor.js`** — add `tool_name: functionImpl` to the `toolMap`. If it modifies on-chain state, also add it to `WRITE_TOOLS` + `PROTECTED_TOOLS` and add a `case` in `runSafetyChecks()`.
3. **`agent.js`** — add the tool name to `MANAGER_TOOLS` / `SCREENER_TOOLS` and/or to the relevant `INTENT_TOOLS[intent]` set.
4. If you want it in the Telegram `/settings` button menu, add it to `settingValue()` in `index.js` + the relevant `renderSettingsMenu` page.

---

## The ReAct loop (`agent.js:157`)

- **System prompt is built at the start of every cycle** with: portfolio, positions, state summary, lessons (3-tier cap — pinned / role / recent), performance summary, decision summary, optional signal weights summary (SCREENER only), `lessons_for_prompt`.
- **Messages get pushed in OpenAI format** unless the provider rejects the `system` role — then we switch to `providerMode = "user_embedded"` and embed the system prompt inside a user message.
- **Per-step retry**: 3 attempts on transient errors. If the response is 502/503/529 the second attempt swaps to fallback model `stepfun/step-3.5-flash:free`. If `tool_choice=required` is rejected or the provider is in thinking mode, retry with `tool_choice=auto` / omitted.
- **Tool args are JSON-validated** and run through `jsonrepair` if malformed; unrepairable args result in `blocked: true` returned to the LLM.
- **No-tool-loop guard**: if `mustUseRealTool` is true (action intents, `MUTATING_TOOL_INTENTS` regex) and the LLM responds with text only, we inject a reminder; second failure returns an error message.
- **Once-per-session tool locks**:
  - `ONCE_PER_SESSION = { deploy_position, swap_token, close_position }` — blocked on second call regardless of success.
  - `NO_RETRY_TOOLS = { deploy_position }` — locks on first attempt even if it failed.
  - For `swap_token` / `close_position`, locks only on `result.success === true` so a genuine failure can be retried.
- **On every tool call**: `logAction({tool, args, result, duration_ms, success})` writes the audit JSONL.

---

## Cron & cycle architecture (`index.js`)

Cron tasks created by `startCronJobs()`:

| Task | Cadence | Job |
|---|---|---|
| Management | `*/managementIntervalMin * * * *` | `runManagementCycle()` |
| Screening | `*/screeningIntervalMin * * * *` | `runScreeningCycle()` |
| Health check | `0 * * * *` | One-shot `agentLoop` as MANAGER with health summary goal |
| Briefing | `0 1 * * *` (UTC) | `runBriefing()` — 8 AM Jakarta |
| Briefing watchdog | `0 */6 * * *` (UTC) | `maybeRunMissedBriefing()` — fires on startup if missed |
| **PnL poller** | every 30s (`setInterval`) | Trailing-TP detection between management cycles (below) |

**Race condition guards** (all in `index.js`):
- `_managementBusy` / `_screeningBusy` flags prevent overlap.
- `_screeningLastTriggered` (epoch ms) prevents management from spamming screening.
- `_pollTriggeredAt` cooldown equal to `managementIntervalMin` to avoid PnL-poller double-triggering.
- `deploy_position` safety check uses `force: true` on `getMyPositions()` for a fresh position count.

### The hybrid management cycle (deterministic + LLM)

The management cycle is **mostly deterministic in JS, LLM only for the hard cases**:

1. `getMyPositions({ force: true })` → snapshot.
2. `recordPositionSnapshot` per pool.
3. JS `updatePnlAndCheckExits(position, …)` for each:
   - `STOP_LOSS` if `pnl_pct <= stopLossPct`
   - `TRAILING_TP` if `trailing_active && (peak - current) >= trailingDropPct` (queued for 15s recheck)
   - `OUT_OF_RANGE` if `minutes_out_of_range >= outOfRangeWaitMinutes`
   - `LOW_YIELD` if `fee_per_tvl_24h < minFeePerTvl24h && age >= minAgeBeforeYieldCheck`
4. For positions with no exit alert: `getDeterministicCloseRule(p, mgmtConfig)` applies the **5 hard rules** (`index.js:895`):
   - Rule 1: stop loss, Rule 2: take profit, Rule 3: pumped far above range, Rule 4: OOR wait, Rule 5: low yield.
5. Positions needing `CLAIM` if `unclaimed_fees_usd >= minClaimAmount`.
6. Positions with `instruction` set are marked `INSTRUCTION` and deferred to the LLM.
7. **LLM is invoked only if any actionMap value is not `STAY`**, with a hard-coded goal that already lists positions + their assigned action. The LLM just executes (no re-evaluation). This saves tokens and prevents hallucinated rules.

**Trailing TP two-phase confirmation** (15s recheck):
- First poll: candidate drop queued in state.
- 15s later: re-fetch positions, `resolvePendingTrailingDrop` — if the drop still holds (within 1% tolerance), fire `confirmed_trailing_exit` and trigger management cycle.
- Mirror pattern for peak confirmation (`queuePeakConfirmation` / `resolvePendingPeak`).

### The screening cycle (multi-stage pipeline)

1. **Pre-checks**: `getMyPositions` + `getWalletBalances` in parallel. Skip if at `maxPositions` or `balance.sol < deployAmountSol + gasReserve`. Each skip writes a `decision-log` entry.
2. **Top candidates**: `getTopCandidates({limit: 10})` — applies ALL hard filters (TVL, fee/TVL, volatility, organic, holders, mcap, bin step, launchpad allow/block, token age, cooldowns, base mints already in use, dev blocklist), optional indicator confirmation, **and** PVP-rival detection (default: warn; `blockPvpSymbols: true` → hard filter).
3. **Sequential recon** with 150ms throttle (avoid 429s): `getActiveBin`, `checkSmartWalletsOnPool`, `getTokenNarrative`, `getTokenInfo` per candidate.
4. **Hard filters after recon**: launchpad allow/block, `bot_holders_pct > maxBotHoldersPct`.
5. **If 0 pass**: write `no_deploy` decision with `rejected[]` and return `⛔ NO DEPLOY` report.
6. **If 1 pass**: `getLoneCandidateSkipReason()` (smart-wallet absence, no narrative, PVP conflict, etc.) — if skipped, write `no_deploy` decision.
7. **Stage signals** for Darwinian attribution.
8. **Compact candidate blocks** built in `index.js:543`.
9. **LLM** gets the blocks + active strategy + balance + computed deploy amount + bins_below formula. The LLM is *forced* via `tool_choice: "required"` on step 0.
10. **Post-deploy**: `appendDecision` with full context. Darwinian signals (if enabled) get consumed via `getAndClearStagedSignals`.

---

## Position lifecycle

```
deployPosition()                   tools/dlmm.js
   ├─ safety: pool_detail fresh fetch, TVL, fee/TVL, volatility, bin_step
   ├─ safety: bin-array init rent check (refuses pools that need initialization)
   ├─ strategy: spot | curve | bid_ask (config.strategy.strategy)
   ├─ range: bins_below linear in volatility, totalBins >= 35 (MIN_SAFE_BINS_BELOW)
   ├─ wide path: totalBins > 69 → createExtendedEmptyPosition + addLiquidityByStrategyChunkable
   ├─ standard path: initializePositionAndAddLiquidityByStrategy
   └─ post: trackPosition({ signal_snapshot: getAndClearStagedSignals })
        appendDecision({ type: "deploy", actor: "SCREENER", metrics, risks, rejected })
        notifyDeploy (Telegram)   ── skip if live message active

manage cycle (every N min)
   ├─ recordPositionSnapshot per pool
   ├─ updatePnlAndCheckExits → STOP_LOSS / TRAILING_TP / OOR / LOW_YIELD
   ├─ getDeterministicCloseRule → 5 hard rules
   ├─ LLM invoked only for non-STAY actions (or INSTRUCTION)
   └─ on close: recordClose() → recordPerformance() in lessons.js
                 ├─ recordPoolDeploy (pool-memory.json)
                 ├─ derive lesson (PREFER/AVOID/WORKED/FAILED)
                 ├─ if performance.length % 5 == 0 → evolveThresholds + recalculateWeights
                 └─ push HiveMind event (fire-and-forget)

auto-swap on close (executor.js:610)
   ├─ only if !skip_swap && result.base_mint
   ├─ get wallet balance, find base token
   ├─ if usd >= 0.10 → swapToken back to SOL
   └─ result.auto_swapped = true + auto_swap_note (so LLM doesn't double-swap)
```

**OOR detection**: `getMyPositions` calls `markOutOfRange` / `markInRange` for every position every cycle. The first time we see OOR, `out_of_range_since` is set; `minutesOutOfRange` is the diff.

**Position instruction** (`set_position_note`): `instruction` is sanitized (no newlines, max 280 chars, no `<>`) and shown in the system prompt + injected verbatim. The LLM must check `get_position_pnl` against the condition and execute immediately if met. The MANAGER prompt (line 144) says: "BIAS TO HOLD does NOT apply when an instruction condition is met."

**Cooldown logic** (`pool-memory.js`):
- Single `low yield` close → 4h pool cooldown.
- `oorCooldownTriggerCount` (default 3) consecutive OOR closes → `oorCooldownHours` (default 12h) cooldown on **both pool and base mint**.
- Optional repeat-deploy cooldown: `repeatDeployCooldownTriggerCount` (default 3) fee-generating deploys in a row → pool+token cooldown (configurable scope).
- All checked by `isPoolOnCooldown` / `isBaseMintOnCooldown` in `getTopCandidates` and `deployPosition`.

---

## Persistent files (all JSON at repo root)

| File | Shape | Mutated by |
|---|---|---|
| `user-config.json` | Flat keys (e.g. `minTvl`, `deployAmountSol`); nested `chartIndicators`. | `config.js` (load), `update_config` tool, `evolveThresholds`, setup wizard. **NEVER gitignored but you must `.gitignore` it locally** — README says so. |
| `state.json` | `{ positions: { [address]: {position, pool, pool_name, strategy, bin_range, amount_sol, active_bin_at_deploy, deployed_at, out_of_range_since, last_claim_at, total_fees_claimed_usd, rebalance_count, closed, closed_at, notes, peak_pnl_pct, pending_*, trailing_active, instruction, _lastBriefingDate, recentEvents[]} }` | `state.js` |
| `lessons.json` | `{ lessons: [{id, rule, tags, outcome, sourceType, confidence, role, pinned, context, ...}], performance: [{position, pool, pnl_pct, pnl_usd, fees_earned_usd, range_efficiency, minutes_held, close_reason, signal_snapshot, ...}] }` | `lessons.js` |
| `pool-memory.json` | `{ [poolAddress]: { name, base_mint, deploys[], total_deploys, avg_pnl_pct, win_rate, adjusted_win_rate, cooldown_until, base_mint_cooldown_until, notes[], snapshots[] } }` | `pool-memory.js` |
| `decision-log.json` | `{ decisions: [{id, ts, type, actor, pool, summary, reason, risks[], metrics{}, rejected[]}] }` max 100 | `decision-log.js` (called from deploy/close/skip in `tools/dlmm.js`, `index.js`) |
| `signal-weights.json` | `{ weights: {signal: 0.3-2.5}, last_recalc, recalc_count, history[] }` | `signal-weights.js` |
| `strategy-library.json` | `{ active: <id>, strategies: { [id]: {id, name, author, lp_strategy, token_criteria, entry, range, exit, best_for, raw} } }` | `strategy-library.js` |
| `smart-wallets.json` | `{ wallets: [{name, address, category, type, addedAt}] }` | `smart-wallets.js` |
| `token-blacklist.json` | `{ [mint]: {symbol, reason, added_at, added_by} }` | `token-blacklist.js` |
| `dev-blocklist.json` | `{ [wallet]: {label, reason, added_at} }` | `dev-blocklist.js` |
| `deployer-blacklist.json` | `{ _note, addresses: [wallet, …] }` (legacy) | `discord-listener/pre-checks.js` |
| `discord-signals.json` | Array of signals with status pending/processed | `discord-listener` |
| `hivemind-cache.json` | `{ sharedLessons: [], presets: [], pulledAt }` | `hivemind.js` |
| `logs/agent-YYYY-MM-DD.log` | Plain text | `logger.js` |
| `logs/actions-YYYY-MM-DD.jsonl` | Audit JSONL | `logger.js logAction` |

All persistent files are loaded/saved on each call — no in-memory caching layer. Keep writes small and on the path of one position close, never inside a hot loop.

---

## Config system

`config.js` exports a single `config` object built once at module load, then mutated by `update_config` tool and `reloadScreeningThresholds()`. **Top-level keys** (all flat unless noted):

| Section | Keys | Default |
|---|---|---|
| `risk` | `maxPositions`, `maxDeployAmount` | 3, 50 |
| `screening` | `excludeHighSupplyConcentration`, `minFeeActiveTvlRatio`, `minTvl`, `maxTvl`, `minVolume`, `minOrganic`, `minQuoteOrganic`, `minHolders`, `minMcap`, `maxMcap`, `minBinStep`, `maxBinStep`, `timeframe`, `category`, `minTokenFeesSol`, `useDiscordSignals`, `discordSignalMode`, `avoidPvpSymbols`, `blockPvpSymbols`, `maxBotHoldersPct`, `maxTop10Pct`, `allowedLaunchpads`, `blockedLaunchpads`, `minTokenAgeHours`, `maxTokenAgeHours` | see `user-config.example.json` |
| `management` | `minClaimAmount`, `autoSwapAfterClaim`, `outOfRangeBinsToClose`, `outOfRangeWaitMinutes`, `oorCooldownTriggerCount`, `oorCooldownHours`, `repeatDeployCooldownEnabled`, `repeatDeployCooldownTriggerCount`, `repeatDeployCooldownHours`, `repeatDeployCooldownScope`, `repeatDeployCooldownMinFeeEarnedPct`, `minVolumeToRebalance`, `stopLossPct`, `takeProfitPct`, `minFeePerTvl24h`, `minAgeBeforeYieldCheck`, `minSolToOpen`, `deployAmountSol`, `gasReserve`, `positionSizePct`, `trailingTakeProfit`, `trailingTriggerPct`, `trailingDropPct`, `pnlSanityMaxDiffPct`, `solMode` | 5, false, 10, 30, 3, 12, true, 3, 12, "token", 0, 1000, -50, 5, 7, 60, 0.55, 0.5, 0.2, 0.35, true, 3, 1.5, 5, false |
| `strategy` | `strategy`, `minBinsBelow`, `maxBinsBelow`, `defaultBinsBelow` | bid_ask, 35, 69, 69 |
| `schedule` | `managementIntervalMin`, `screeningIntervalMin`, `healthCheckIntervalMin` | 10, 30, 60 |
| `llm` | `temperature`, `maxTokens`, `maxSteps`, `managementModel`, `screeningModel`, `generalModel` | 0.373, 4096, 20, healer-alpha, hunter-alpha, healer-alpha |
| `darwin` | `enabled`, `windowDays`, `recalcEvery`, `boostFactor`, `decayFactor`, `weightFloor`, `weightCeiling`, `minSamples` | true, 60, 5, 1.05, 0.95, 0.3, 2.5, 10 |
| `tokens` | `SOL`, `USDC`, `USDT` (mint addresses) | canonical |
| `hiveMind` | `url`, `apiKey`, `agentId`, `pullMode` | `https://api.agentmeridian.xyz`, built-in key, auto-generated, "auto" |
| `api` | `url`, `publicApiKey`, `lpAgentRelayEnabled` | `https://api.agentmeridian.xyz/api`, built-in key, false |
| `jupiter` | `apiKey`, `referralAccount`, `referralFeeBps` | env override, fixed referral, 50 bps |
| `indicators` | `enabled`, `entryPreset`, `exitPreset`, `rsiLength`, `intervals`, `candles`, `rsiOversold`, `rsiOverbought`, `requireAllIntervals` | false, supertrend_break, supertrend_break, 2, ["5_MINUTE"], 298, 30, 80, false |

`update_config` (executor.js:333) uses a flat-key `CONFIG_MAP` (50+ entries) that knows how to (a) coerce booleans/arrays/strings/numbers, (b) clamp `binsBelow*` to `MIN_SAFE_BINS_BELOW=35`, (c) restart cron if `managementIntervalMin` / `screeningIntervalMin` changed, (d) write a `[SELF-TUNED]` lesson.

`computeDeployAmount(walletSol) = clamp((walletSol - gasReserve) × positionSizePct, [deployAmountSol, maxDeployAmount])` → 2-decimal SOL.

`reloadScreeningThresholds()` (config.js:236) is called by `evolveThresholds` to re-apply changes to the in-memory `config` without process restart.

---

## Environment variables (`.env`)

| Var | Required | Purpose |
|---|---|---|
| `WALLET_PRIVATE_KEY` | yes | Base58 (or JSON array) |
| `RPC_URL` | yes | Solana RPC. Helius recommended. |
| `OPENROUTER_API_KEY` (or `LLM_API_KEY`) | yes | LLM provider key. |
| `LLM_BASE_URL` | no | Override for any OpenAI-compatible endpoint (LM Studio: `http://localhost:1234/v1`). |
| `LLM_MODEL` | no | Default model. Per-role models in `user-config.json` override. |
| `HELIUS_API_KEY` | recommended | Wallet balance lookups via Helius. |
| `LPAGENT_API_KEY` | optional | Direct LPAgent positions fetch fallback. |
| `JUPITER_API_KEY` | optional | Better rate limit on Jupiter Swap. Default key baked in. |
| `TELEGRAM_BOT_TOKEN` | no | Notifications + REPL. |
| `TELEGRAM_CHAT_ID` | no | Default chat (also persisted to `user-config.telegramChatId`). |
| `TELEGRAM_ALLOWED_USER_IDS` | no | Comma-separated Telegram user IDs allowed to control. Required if chat is a group. |
| `ALLOW_SELF_UPDATE` | no | Set `true` to allow the `self_update` tool (default false). |
| `DRY_RUN` | no | Skip all on-chain txs. `npm run dev` sets it. |
| `LOG_LEVEL` | no | `debug` / `info` / `warn` / `error`. |
| `DISCORD_USER_TOKEN` | no | Selfbot for `discord-listener/`. |
| `DISCORD_GUILD_ID` / `DISCORD_CHANNEL_IDS` | no | Discord listener config. |
| `DISCORD_MIN_FEES_SOL` | no | Default 5. |
| `ENVRYPT_KEY` / `ENVCRYPT_KEY` | no | Key for `.env` XOR encryption (line-by-line marked with `# encrypted`). |
| `HIVE_MIND_URL` / `HIVE_MIND_API_KEY` | no | Override defaults. |

Encrypted env flow (optional, see `scripts/envrypt.js`):
1. Save plain values to `.env.raw`.
2. `printf "long-local-key\n" > .envrypt`.
3. `npm run env:encrypt` reads `.env.raw`, encrypts anything matching `*_KEY`/`*SECRET*`/`*TOKEN*`/`*MNEMONIC*`/etc., writes `.env`. Originals are XOR'd with a positional repeating key — **not** cryptographically secure, but obscures values in plaintext grep.

---

## Telegram ops surface

| Surface | Where handled | Notes |
|---|---|---|
| `/help` / `/status` / `/wallet` / `/config` | `index.js#telegramHandler` | Read-only. |
| `/positions` / `/pool <n>` / `/close <n>` / `/set <n> <note>` | `index.js#telegramHandler` | Bypass LLM — direct state mutation. `/close <n>` calls `closePosition` directly. |
| `/closeall` | index.js | Closes all open positions in sequence. |
| `/screen` / `/candidates` / `/deploy <n>` | `runDeterministicScreen` + `deployLatestCandidate` | Deterministic — no LLM. The single-candidate skip rule applies. |
| `/briefing` | `generateBriefing` | On-demand daily report. |
| `/settings` / `/menu` / `/configmenu` | `renderSettingsMenu` + `applySettingsMenuCallback` | Inline-keyboard menu with toggle/step buttons. Updates flow through `update_config` tool. |
| `/hive pull` | `pullHiveMindLessons` + `pullHiveMindPresets` | Manual HiveMind fetch. |
| `/pause` / `/resume` / `/stop` | index.js | Toggle cron jobs / graceful shutdown. |
| Free-form chat | `agentLoop` with `agentType=GENERAL` | Intent-matched tool subset. |
| `cfg:*` callback queries | `applySettingsMenuCallback` | Settings menu button presses. |

**Auth** (`telegram.js#isAuthorizedIncomingMessage`):
- `chatId` must match incoming message's chat (env or persisted `user-config.telegramChatId`).
- If chat is a group/supergroup, `TELEGRAM_ALLOWED_USER_IDS` must be non-empty.
- Otherwise, all messages from the matching chat are accepted.
- Warns-once on missing config, then silently ignores inbound.

**Queueing**: while a management/screening cycle or free-form agentLoop is busy, inbound messages are queued (`_telegramQueue`, max 5). Overflow sends "Queue is full".

**Live messages**: `createLiveMessage` returns a handle. `toolStart`/`toolFinish` push per-tool lines (with `ℹ️`/`✅`/`❌` icons) into a single Telegram message that gets edited in place. While a live message is active, standalone notifications (`notifyDeploy`/`notifyClose`/`notifySwap`/`notifyOutOfRange`) are suppressed to avoid spam.

---

## Discord listener

Standalone process — `cd discord-listener && npm install && npm start`. Shares `../.env` for env vars.

- Uses `discord.js-selfbot-v13` (personal account, not bot). **Selfbot — use responsibly; against Discord TOS.**
- Filters: only `Metlex Pool Bot` author, only configured channels.
- Extracts Solana addresses (base58, 32-44 chars, must contain digit, not in `FALSE_POSITIVE_SKIP` set).
- For each address: runs `runPreChecks` (dedup → blacklist → pool resolve → rug → deployer → fees) and appends to `discord-signals.json` with `status: "pending"`.
- Screener picks up pending signals first (or only, if `discordSignalMode: "only"`).
- `DISCORD_MIN_FEES_SOL` defaults to 5; the screener's hard floor is `minTokenFeesSol` (default 30) — both apply.

---

## Strategy library (default strategies)

| id | name | lp_strategy | idea |
|---|---|---|---|
| `custom_ratio_spot` | Custom Ratio Spot | spot | Express directional bias via token:SOL ratio. |
| `single_sided_reseed` | Single-Sided Bid-Ask + Re-seed | bid_ask | Token-only redeploys on OOR downside. |
| `fee_compounding` | Fee Compounding | any | Claim + add back to same position. |
| `multi_layer` | Multi-Layer | mixed | One position, multiple add-liquidity layers with different shapes. |
| `partial_harvest` | Partial Harvest | any | Withdraw 50% at 10% return; rest keeps running. |

`set_active_strategy` swaps the active one. The screener prompt mentions the active strategy in the `ACTIVE STRATEGY` block.

---

## Known issues / tech debt (verified by reading the code)

- **`lessons.js evolveThresholds()`** evolves `minOrganic` and `minFeeActiveTvlRatio` only.
- **`get_wallet_positions` tool** is in `definitions.js` and wired in `executor.js`, but not in `MANAGER_TOOLS`/`SCREENER_TOOLS`. Only `INTENT_TOOLS.balance` / `INTENT_TOOLS.positions` expose it to GENERAL.
- **Lazy SDK load** (`tools/dlmm.js:33`) — `@meteora-ag/dlmm` is dynamic-imported on first on-chain call to avoid CJS-import crash on Node 24 (the `postinstall` `patch-anchor.js` handles another piece of this). Don't `import` it eagerly at top of file.
- **Position cache** (`_positionsCache` 5min TTL) — in single-process mode it's a perf win, but the cache is invalidated by `_positionsCacheAt = 0` after every deploy/close, and the executor's `deploy_position` safety check uses `force: true` for a fresh count.
- **PnL sanity check** (`pnlSanityMaxDiffPct`, default 5%) — if reported vs derived pnl_pct differ by more than this, the LLM is told not to trust that tick. Implemented in `dlmm.js` getMyPositions and `state.js` updatePnlAndCheckExits.
- **DRY_RUN auto-skip SOL balance check** — `runSafetyChecks` for `deploy_position` only checks `balance.sol < amountY + gasReserve` if `DRY_RUN !== "true"`.
- **HiveMind disable path is murky** — README says "there is currently no empty-string disable path" for HiveMind. `config.hiveMind.url/apiKey` fall back to defaults if blank. Set `pullMode: "manual"` to suppress auto-pull.
- **Selfbot in `discord-listener/`** is a ToS gray area. Make sure operators know.
- **`.claude/settings.json`** denies `rm -rf`, `wget`, and **reads of `.env*`**. It also blocks `run_in_background: true` via a PreToolUse hook. So in this repo, Claude Code can't background long-running commands — serial execution only.
- **Drift risk** — `user-config.json` keys must match the **flat** `update_config` CONFIG_MAP in executor.js. New keys: add to both, otherwise `update_config` returns `unknown: [...]` and skips the apply.
- **The Discord `useDiscordSignals` flag** lives in `screening`, not `discord`. Screener checks `config.screening.useDiscordSignals`, and `discordSignalMode: "merge" | "only"`.

---

## Patterns to copy

When adding a new tool that reads on-chain data, copy the **cache + inflight dedup + `force` flag** pattern from `getMyPositions` (`tools/dlmm.js:1154`). The `force: true` is what the deploy safety check relies on.

When adding a new persistent JSON store, copy the load/save pattern from `state.js` or `pool-memory.js`. **Always** run text through `sanitizeStoredText` (or write a domain-specific sanitizer that strips `<>` and newlines) before persisting — those values get echoed into the LLM prompt later.

When adding a new pre-LLM enrichment, follow the **3-strikes (Discord pre-checks)** model: cheap checks first (in-memory dedup, file lookup), then network (pool resolution, rugcheck), then more network (deployer, global fees). Log each pass/reject with the stage name.

When scheduling work, follow the **`_busy` flag + cooldown** pattern. `_managementBusy`, `_screeningBusy`, `_pnlPollBusy`, `_pollTriggeredAt`, `_screeningLastTriggered` are the canonical examples.

---

## What to read next

- Adding a new tool → `tools/definitions.js` + `tools/executor.js` + `agent.js` (see "Adding a new tool" above).
- Changing safety rules → `tools/executor.js#runSafetyChecks` and `index.js#getDeterministicCloseRule`.
- Adding a new persistent state file → copy `state.js` or `pool-memory.js`. Add a getter to `index.js` system-prompt section if the LLM needs to see it.
- Changing the LLM contract → `prompt.js` (buildSystemPrompt) and `agent.js` (INTENT_TOOLS + role sets + safety guards).
- Changing deploy/close behavior → `tools/dlmm.js` (the SDK wrapper) and `tools/executor.js` (the post-tool side effects + Telegram notify + auto-swap).
- Discord listener issues → `discord-listener/pre-checks.js`.
- HiveMind protocol issues → `hivemind.js` (push side) and `lessons.js#getLessonsForPrompt` (pull side injection).
