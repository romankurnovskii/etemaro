# Reference: Core-Agent Run Directory Data Stores

**Purpose.** The runtime file names and keys the review reads, so it never
guesses a field. Source of truth: `packages/core/src/shared/types.ts` and
`packages/core/src/domain/state.ts` — start here, but re-verify against the
files on disk, because keys are **optional and evolve**.

## Where instances live in this repo

| Layout | Example path |
| --- | --- |
| Local agent runs | `data/instances/<agentId>/` |
| Remote-server runs | `data/remote-server/data/instances/<instance-config-id>/` |
| Config for an instance | `config/instances/<instance-config-id>.json` |
| Shared strategy library | `config/shared/strategy-library.json` (+ `strategy-library.shared.json`) |
| Smart-wallet lists | `config/shared/smart-wallets.json` |

Instance directory names are **config ids**, e.g.
`agent-config.smart-wallet-follow.v260922-003` (`vYYMMDD` = config version,
`-N` = variant). The `agentId` *inside* the logs is different — e.g.
`agt_260922v1`. Do not confuse the two; the report header shows both.

## Core markers

A directory is a core-agent instance when it carries **at least one** of:

`state.json`, `lessons.json`, `decision-log.json`

Optional stores, listed when present:

`signal-weights.json`, `pool-memory.json`, `hivemind-cache.json`,
`.smart-wallets-snapshot.json`, `notifications.jsonl`

## File map

| File | Shape | Purpose |
| --- | --- | --- |
| `state.json` | `StateData` | live + recently closed positions, pending liquidations |
| `lessons.json` | `{lessons[], performance[]}` | **closed-trade ledger** (`performance[]`) + derived rules |
| `decision-log.json` | `{decisions[]}` | deploy / close / skip / no_deploy / note decisions |
| `signal-weights.json` | `SignalWeightsData` | Darwinian signal calibration |
| `pool-memory.json` | `Record<poolAddress, PoolMemoryEntry>` | per-pool history, cooldowns, notes |
| `hivemind-cache.json` | `HiveMindCache` | shared lessons/presets pulled remotely |
| `.smart-wallets-snapshot.json` | `{initialized, positions[]}` | baseline ledger of smart-wallet position addresses |
| `notifications.jsonl` | one JSON per line | Telegram-style notifications (`ts,type,icon,title,body`) |
| `logs/agent-<agentId>-<date>.log` | text | operational narrative (see `log-analysis.md`) |
| `logs/actions-<agentId>-<date>.jsonl` | JSONL | per-tool audit trail |
| `logs/structured-<agentId>-<date>.jsonl` | JSONL | structured events; **the errors live here** |
| `pool_metrics/` | JSON dumps | per-pool metric snapshots |

## 1. `lessons.json` → `performance[]` — the closed-trade ledger

This is the primary financial source. Keys observed on
`agent-config.smart-wallet-follow.v260922-003` (119 records) and
`agent-config.copy_trade_lag.v260910-1` (30 records):

**Identity / setup** — `position`, `pool`, `pool_name`, `base_mint`, `strategy`,
`bin_range` (`{min,max,bins_below,bins_above}`), `bin_step`, `volatility`,
`fee_tvl_ratio`, `organic_score`, `amount_sol`, `signal_snapshot`.

**Timing** — `recorded_at`, `settled_at`, `minutes_held`, `minutes_in_range`.

**Money** — `initial_value_usd`, `final_value_usd`, `fees_earned_usd`,
`price_pnl_usd`, `price_pnl_pct`, `net_pnl_usd`, `pnl_usd`, `pnl_pct`,
`range_efficiency`.

**Settlement (unsold-token lifecycle)** — `status`
(`realized` | `closed_pending_swap` | `abandoned_loss`), `cash_realized_usd`,
`cash_realized_sol`, `unrealized_residual_usd`, `unrealized_tokens_amount`,
`liquidation_mint`, `liquidation_tx`.

**Reason / context** — `close_reason`, `entry_mcap` / `entry_tvl` /
`entry_volume` / `entry_holders`, `exit_mcap` / `exit_tvl` / `exit_volume`.

> Keys are optional. The `data/instances/agent-default` fixture set has neither
> `bin_range`, `strategy`, `settled_at` nor the `exit_*` fields. Read defensively
> and write "not present in this run directory" rather than crashing or guessing.

### Accounting rules — state these in the report

1. `net_pnl_usd = price_pnl_usd + fees_earned_usd`, persisted **rounded to USD
   cents**. Compare with a 0.011 USD tolerance; a larger gap is a real
   data-quality finding.
2. **Split by `status` before any aggregate.** On the reference instance
   `closed_pending_swap` (71) outnumbered `realized` (48); summing them without
   the split reports +21.20 USD net when settled cash was **−2.65 USD**.
3. For `closed_pending_swap`, effective cash =
   `cash_realized_usd + unrealized_residual_usd`. Report the residual
   **separately** and never present it as realized. Confirm the swap actually
   landed via `swap_finish` / `tx_state` in `structured-*.jsonl`, and cross-check
   `state.pendingLiquidations`.
4. `abandoned_loss` = residual written off. Count it as a **loss** regardless of
   a zero net figure.
5. `close_reason` is parameterised (`take profit (pnl=0.23% threshold=0.2%)`,
   `pumped far above range (active_bin=-331 upper_bin=-343 threshold=+10 bins)`,
   `stop loss: pnl -29.51% <= -20%`). Group on the **family** before `(` or `:` —
   otherwise the exit histogram shatters into hundreds of one-off buckets.

### `lessons[]` (the derived-rule list)

`{id, rule, tags[], outcome, created_at}` with `outcome` in
`good | bad | poor | neutral | manual | evolution | failed | worked`. `tags`
often carries `evolution` / `config_change` for Darwinian adjustments. Use it to
explain *why* the config's thresholds look the way they do, not as a PnL source.

## 2. `state.json` — `StateData`

`{positions: Record<address, PositionRecord>, recentEvents: StateEvent[],
lastUpdated, _lastBriefingDate?, _consecutiveSwapFailures?,
pendingLiquidations: Record<mint, PendingLiquidation>}`

`PositionRecord` (the fields the review uses): `position`, `pool`, `pool_name`,
`strategy`, `bin_range`, `amount_sol`, `amount_x`, `active_bin_at_deploy`,
`bin_step`, `volatility`, `fee_tvl_ratio`, `initial_fee_tvl_24h`,
`organic_score`, `initial_value_usd`, `entry_*`, `signal_snapshot`,
`deployed_at`, `out_of_range_since`, `last_claim_at`,
`total_fees_claimed_usd`, `rebalance_count`, `closed`, `closed_at`,
`close_reason`, `notes[]`, `peak_pnl_pct`, `pending_peak_*`, `pending_exit_*`,
`trailing_active`.

`StateEvent`: `{ts, action, position?, pool_name?, reason?}`

`PendingLiquidation`: `{mint, symbol?, amount, usd?, pool_address?, position?,
added_at, last_attempt_at, attempts, status: pending|liquidated|abandoned,
last_error?, last_error_code?}`. **Non-empty means the sweeper still has unsold
tokens to swap** — cross-check it against the `closed_pending_swap` count in
`performance[]`; a disagreement is a reconciliation finding.

> `state.positions` includes closed positions, so `len(positions)` is **not** the
> open-position count. Filter on `closed`/`closed_at`.

## 3. `decision-log.json` — `{decisions: Decision[]}`

`type` ∈ `deploy | close | skip | no_deploy | note`; `actor` is a free string
(`SCREENER`, `MANAGER`, `GENERAL`). Fields: `id`, `ts`, `type`, `actor`, `pool`,
`pool_name`, `position`, `summary`, `reason`, `risks[]`, `metrics{}`,
`rejected[]`. Use it for the *narrative* of why a deploy or close happened —
especially `skip` / `no_deploy`, which never reach `performance[]`.

## 4. `signal-weights.json` — `SignalWeightsData`

`{weights: Partial<Record<SignalName, number>>, last_recalc, recalc_count,
history: SignalWeightHistory[]}`. Signals: `organic_score`, `fee_tvl_ratio`,
`volume`, `mcap`, `holder_count`, `smart_wallets_present`, `narrative_quality`,
`study_win_rate`, `hive_consensus`, `volatility`, `entry_mcap`, `entry_tvl`,
`entry_volume`. `history[]` items carry
`changes[{signal,from,to,lift,action: boosted|decayed}]`, `window_size`,
`win_count`, `loss_count`.

## 5. `pool-memory.json` — `PoolMemoryEntry`

Keyed by pool address. `{name, base_mint, deploys: PoolMemoryDeploy[],
total_deploys, avg_pnl_pct, win_rate, adjusted_win_rate,
adjusted_win_rate_sample_count, last_deployed_at, last_outcome,
cooldown_until?, cooldown_reason?, base_mint_cooldown_until?,
base_mint_cooldown_reason?, notes[{note,addedAt}], snapshots?}`

`PoolMemoryDeploy`: `deployed_at`, `closed_at`, `pnl_pct`, `pnl_usd`,
`price_pnl_usd`, `price_pnl_pct`, `net_pnl_usd`, `fees_earned_usd`,
`fees_earned_sol`, `fee_earned_pct`, `range_efficiency`, `minutes_held`,
`close_reason`, `strategy`, `volatility_at_deploy`, `entry_*`, `exit_*`.

`PoolSnapshot`: `{ts, position, pnl_pct, pnl_usd, in_range,
unclaimed_fees_usd, minutes_out_of_range, age_minutes}`.

Use `cooldown_until` / `cooldown_reason` to explain why a pool the screener
liked was never redeployed.

## 6. `hivemind-cache.json` — `HiveMindCache`

`{sharedLessons: HiveMindSharedLesson[], presets: unknown[], pulledAt}`;
shared lesson: `{id, rule, tags[], outcome, agentId?, createdAt?}`.

## 7. Logs

Read these through `scripts/_dialects.py` only — see `log-analysis.md` for the
analysis recipes, the measured component/category census, the liveness recipe
and the tool-counting trap. This section is the field-name authority only:

- `logs/agent-*.log`: `[timestamp] [tag] [agentId] message`. Tags include
  `screening`, `deploy`, `close`, `swap`, `claim`, `positions`, `pnl_tick`,
  `cron`, `cron_error`, `SmartWallets`, `startup`, `state`, `executor`,
  `pool-metrics`, `lessons`, `agent`, `price_warn`, `wallet_warn`. The bracket
  is a **component tag, not a severity level** — this file carries essentially no
  error signal.
- `logs/actions-*.jsonl`: `{ts, agentId, dryRun, tool, args, result}` — plus
  `success`/`error` on failure. `success` is **often absent**, so only an
  explicit `false` is a failure.
- `logs/structured-*.jsonl`: `{ts, category, agentId, dryRun, message,
  correlationId, metadata}`. The first entry of a cycle has
  `category=agent_loop_start` and `metadata.goal` with the **resolved screening
  prompt**. **Error categories live here**: `api_error`, `swap_error`,
  `tx_error`.

## 8. Tool names

Use these exact names when filtering `actions-*.jsonl`:

`add_smart_wallet`, `remove_smart_wallet`, `list_smart_wallets`,
`check_smart_wallets_on_pool`, `sweep_unsold_tokens`.

**Never use a tool name as a raw count filter.** Some tools are logged twice
under two spellings — `sweepUnsoldTokens` (summary) and `sweep_unsold_tokens`
(per-token detail) — measured on the reference instance at 425 + 425 records for
only **604** distinct invocations. Deduplicate by `ts`. Details:
`log-analysis.md`.
