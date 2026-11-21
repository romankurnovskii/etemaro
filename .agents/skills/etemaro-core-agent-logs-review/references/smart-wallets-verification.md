# Reference: Smart Wallet Position Verification

**Purpose.** When a run's market source tracks smart wallets, the review must fetch those wallets' actual positions and use them to confirm the strategy worked as configured — not only report PnL. This closes the biggest gap in a plain performance review: *did the agent enter only on real signals, and did it behave as the config says?*

This analysis is REQUIRED whenever section *2 · Agent Configuration & Expected Strategy Behavior* finds any of:

- `screening.entrySource == "smart_wallets"`, or
- The active strategy-library entry has `smartWalletListId` set (any wallet list), or
- `opportunity.smartWalletScoreBonus > 0`, or
- strategy-library `entry.condition` / `notes` mention smart wallets, or
- the run log contains `[SmartWallets]` or `smart_wallets: N present`.

If none apply, keep the section header and write **"Run is not smart-wallet driven — section not applicable."**

## 1. Local inputs

| Source | What to read |
| --- | --- |
| `config/shared/smart-wallets.json` (repo root, resolved by walking up from the data dir) | `lists.<smartWalletListId>.wallets[]`. Only `type: "lp"` (or missing type) are position-checked; `type: "holder"` is holdings-only and must not be counted as an LP signal |
| agent config | `strategy.activeStrategyId`, `screening.entrySource`, `opportunity.smartWalletScoreBonus`, `risk.maxPositions` |
| strategy-library | `strategies[config.strategy.activeStrategyId].smartWalletListId` — the actual list selector; the agent config has no `smartWalletListId` |
| `.smart-wallets-snapshot.json` | `{ initialized, positions[] }` — the baseline ledger of position addresses the agent had already "seen" |
| `state.json` | agent's own positions: `positions.<addr>.pool`, `deployed_at`, `closed_at`, `notes`; `pendingLiquidations{}` for unsold tokens still awaiting the sweeper |
| `lessons.json` → `performance[]` | closed-trade ledger; split by `status` (`realized`/`closed_pending_swap`/`abandoned_loss`) and never count `unrealized_residual_usd` as realized (see `references/data-stores.md`) |
| `decision-log.json` / `logs/actions-*.jsonl` | deploy/close decisions and `check_smart_wallets*` tool results |
| `logs/structured-*.jsonl` | `category=agent_loop_start`, `metadata.goal` — the resolved screening prompt actually used |
| `logs/agent-*.log` | `[SmartWallets] …` cycle lines (start, baseline init, "No new positions", "Deploying to", "Vetoed", cap reached) |

## 2. Fetch wallet positions

Try sources in order; record which succeeded and the fetch timestamp. Always fetch **fresh** at review time (positions change).

1. **api.etemaro (preferred, no key)**
   - Open: `https://api.etemaro.com/v1/solana/portfolio/open?wallet=<ADDR>&provider=meteora&page_size=100`
   - Closed: `https://api.etemaro.com/v1/solana/portfolio/closed?wallet=<ADDR>&provider=meteora&page_size=100`
   - Shape: `{ page, pageSize, hasNext, totalCount, totalPositions, pools: [...] }`.
2. **Meteora Datapi (the source the agent itself uses, no key)**
   - Open: `https://dlmm.datapi.meteora.ag/portfolio/open?user=<ADDR>` (optional `page_size`, max 50)
   - Closed pools: `https://dlmm.datapi.meteora.ag/portfolio?user=<ADDR>`
   - `MeteoraAdapter.getWalletPositions` uses this endpoint, so it best reflects what the agent actually saw.
3. **Agent Meridian (optional)**
   - `https://api.agentmeridian.xyz/api/positions/open/raw?owner=<ADDR>`; add `x-api-key` only if present in config. Do not fail the review if unavailable.
4. **Apina registry (endpoint discovery / schema)** — use when a URL needs verifying or the provider changes:
   - `https://apina.api.i2b9e.com/api/v1/providers/meteora/endpoints?search=portfolio`
   - `https://apina.api.i2b9e.com/api/v1/providers/{id}/endpoints/{endpoint_id}` for the full parameter/response schema. Apina is a registry, not a proxy: fetch the returned `full_url` directly.
5. **LPAgent (only if `api.lpAgent.enabled` and a key is configured)** — `https://api.lpagent.io/open-api/v1`; otherwise skip and say so.

**Never** put an API key in the report or the saved JSON. Mask it.

**Politeness / failure:** one request per wallet, small delay between wallets (≈300 ms), honor a timeout, and treat a non-200 as a per-wallet error rather than aborting the whole review.

**Field mapping (Meteora-family response).** For each pool in `pools[]`:
- `poolAddress` — pool;
- `listPositions[]` — the wallet's open position addresses in that pool (the signal);
- `outOfRange`, `positionsOutOfRange[]` — whether those positions are out of range;
- `tokenX` / `tokenY`, `binStep`, `feePerTvl24h`, `pnlUsd`, `pnlPctChange` — context.

A wallet's open-position count = `sum(len(pool.listPositions))`. A wallet is "in pool P" when P appears in its `pools[]` with a non-empty `listPositions`.

## 3. Analysis to produce

For each tracked `lp` wallet: shortened address, name, category, fetch status, open-position count, pool addresses/tokens, overlap with the agent's own deployed pools, and the newest position `createdAt`.

Then verify against config:

| Question | Method | Verdict |
| --- | --- | --- |
| **Gate integrity** — did every agent deploy have a tracked wallet in that pool? | agent deployed pools (`state.json` / `recentEvents` / decision-log) ∩ verified wallet pools. For `entrySource=smart_wallets` a deploy with no matching wallet is a FAIL. | PASS / PARTIAL / FAIL |
| **Signal lag** — how long after the wallet opened did the agent deploy? | `deployed_at` − wallet position `createdAt` | report median/range |
| **Snapshot correctness** — was the baseline valid? | compare `.smart-wallets-snapshot.json.positions` against the union of wallet positions; a baseline built on a failed fetch is a finding | PASS / FINDING |
| **Wallet liveness** — are tracked wallets still LPing? | open-position count per wallet | note wallets with 0 / fetch errors |
| **Exit behavior** — did exits match the configured rule (TP/SL/OOR), not an undocumented "follow the wallet out"? | `state.json.notes` / decision-log close reasons vs config | PASS / FINDING |
| **Cap respected** — never more than `maxPositions` open at once? | `state.json` / `recentEvents` timeline | PASS / FAIL |

State limitations honestly: the API returns **now**, not at deploy time; use `createdAt` for timing but treat historical pool membership as approximate. If the API is unreachable, mark the section **UNVERIFIED** and say why — never fabricate positions.

## 4. Save the analysis JSON

Write `<target-dir>/reports/REPORT-YYYY-MM-DD.smart-wallets.json` using `references/smart-wallets-analysis.template.json`. Rules:

- one file per report date; if re-running the same date, overwrite it;
- include `fetched_at`, `source_used` per wallet, and the raw error string on failure;
- keep full addresses in the JSON (machine-readable); shorten only in the HTML.

## 5. Output requirements (HTML section *7 · Smart Wallet Signal Verification*)

1. method + fetch timestamp + which source(s) answered;
2. per-wallet table (name, type, open positions, pools, overlap with agent, status);
3. per-deploy verification table (agent pool, deploy time, wallet present?, wallet(s), new-vs-snapshot, verdict);
4. a verdict box: **PASS / PARTIAL / FAIL / UNVERIFIED** + one sentence;
5. the saved JSON path.

## 6. Per-position veto forensics (report section 6b)

Required whenever the agent log contains `Vetoed` lines (most often `[SmartWallets] Vetoed <pool>: <reason>`, sometimes duplicated). A bare veto reason is a dead end — the review must answer, per rejected signal: which wallet position, which filter check, what the real values, and whether it would pass now.

### 6.1 Map each veto to the wallet's position(s)

- Parse `logs/agent-*.log` for `Vetoed <poolName>: <reason>` and the line timestamp.
- Read the wallet's **per-position** history from **api.etemaro closed**, paginated:
  `https://api.etemaro.com/v1/solana/portfolio/closed?wallet=<ADDR>&provider=meteora&page_size=100&page=<N>`
  Shape: `{ positions: [ { positionAddress, poolAddress, tokenX, tokenY, binStep, createdAt, closedAt, pnlUsd, pnlPctChange, ... } ], hasMore, totalCount, summary }`.
- Match `poolAddress` to the vetoed pool; keep every position whose `createdAt <= vetoTs` (and `closedAt >= vetoTs` when it applies). Meteora Datapi's closed endpoint aggregates by pool and does **not** expose position addresses, which is why api.etemaro is used for this mapping.
- The agent's own `.smart-wallets-snapshot.json` ledger lists position addresses but no pool mapping — use it only to confirm which position the agent had already "seen" (and, critically, that the vetoed position was committed to it).

### 6.2 Reproduce the first failed check

`getRawPoolScreeningRejectReason()` in `packages/core/src/adapters/blockchain/ScreeningAdapter.ts` returns the **first** failing check in a fixed order; that order is what "where exactly it was vetoed" means:

1. high supply concentration → 2. base/quote critical warnings → 3. high single ownership → 4. `pool_type != dlmm` → 5. `mcap` (minMcap..maxMcap) → 6. `holders` → 7. `volume` → 8. `minTvl` → 9. **`maxTvl`** → 10. `bin_step` (min..max) → 11. **`fee_active_tvl_ratio`** → 12. **`volatility` usable** → 13. base/quote `organic_score` → 14. blocked launchpad → 15. **token age** (`created_at` vs `minTokenAgeHours`/`maxTokenAgeHours`).

Report the check name, the value the agent computed, and the threshold.

### 6.3 Fetch the real indicator values

Use the **same source the agent uses** so values are comparable:

- Primary: `https://pool-discovery-api.datapi.meteora.ag/pools?page_size=1&filter_by=pool_address%3D<ADDR>&timeframe=5m` → `data[0]`.
- Fallback: `https://dlmm.datapi.meteora.ag/pools/<ADDR>` (subset of fields).

Read: `tvl`/`active_tvl`, `dlmm_params.bin_step`, `fee_active_tvl_ratio`, `volatility`, `volume`, `base_token_holders`, `token_x.market_cap`, `token_x.organic_score`, `token_y.organic_score`, `token_x.created_at` (ms), and any `base_token_has_*` flags.

**Time honesty.** The API returns *now*, not at veto time. Present both: the value the agent logged at veto (usually embedded in the veto string, e.g. `TVL 426760.4 above maxTvl 300000`, `volatility 0`), and the live value. For token age, compute it exactly from `created_at` at both timestamps.

### 6.4 Classify the finding

- **Static rejects** (bin_step out of range, high supply concentration) — genuinely ineligible; the veto is correct.
- **Transient rejects** (`maxTvl`, `minTokenAgeHours`, `fee_active_tvl_ratio`, `volatility`) — the value can change. If the signal would pass at review time, the permanent snapshot ledger (or missing TTL) is the bug: `updateSnapshotPositions()` commits every vetoed position forever and it is never reconsidered.
- **Silent drops** — tokens filtered before the veto log (e.g. bin-step window) never appear as a veto line; diff the wallet's positions against the config's bin-step range and list them.

### 6.5 Save + render

- Add `per_signal_veto_forensics[]` to `REPORT-YYYY-MM-DD.smart-wallets.json` (schema example in `references/smart-wallets-analysis.template.json`), each item: `signal`, `pool_address`, `bin_step`, `wallet_position(s)`, `position_opened`/`position_closed`, `veto_at`, `failed_check`, `value_at_veto`, `threshold`, `wallet_pnl_usd`, `live{...}`, and a `note` when it would pass now. Record silent drops under a `silent_drops[]` array.
- Render HTML block **6b · Per-position veto forensics** from `references/report-template.html`.