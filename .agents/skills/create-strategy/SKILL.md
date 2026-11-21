---
name: create-strategy
description: >
  Guide for creating a new Etemaro LP strategy from scratch or adapting an existing preset.
  Use this skill whenever a user asks to "create a strategy", "add a new strategy", "set up a strategy",
  "configure LP strategy", "what strategy should I use", "tweak my strategy", "change my strategy", or any
  variant involving Etemaro strategy setup, customization, or deployment configuration. Also trigger when the
  user describes a trading goal (e.g. "I want to go bullish on SOL", "I want to earn fees on a stable pair",
  "I have a volatile token") and needs it translated into a concrete config. Strategies are immutable by
  default: this skill always creates a NEW strategy (new id) and a NEW config file, and never edits or
  overwrites an existing strategy without explicit user confirmation.
metadata:
  version: 2.0.0
  author: etemaro
license: MIT
---

# Create Strategy — Etemaro

This skill walks an agent through creating or selecting an LP strategy for the Etemaro trading daemon,
then generates a ready-to-use config patch and (when needed) a new strategy-library entry.

---

## Strategy Immutability (Non-Negotiable)

Strategies and their config files are **immutable by default**.

- **"Create a strategy" ⇒ always create a NEW strategy.** New unique library `id`, new versioned config
  file. Never rename, overwrite, or edit an existing entry or config.
- Applies to: entries in `config/shared/strategy-library.json`, and config files under
  `config/instances/`.
- **Bundled presets are read-only.** `config/shared/strategy-library.shared.json` (and its source of truth
  `packages/core/src/domain/strategy-library-shared.ts`) ship with the repo. Never edit them in place —
  copy to a new private entry instead.
- **If the agent believes an existing strategy needs to change** (market conditions shifted, performance is
  bad, a filter is wrong):
  1. **STOP.** Do not edit.
  2. State the exact field(s), current value(s), and proposed value(s).
  3. Give the reason and evidence (logs, metrics, `file:line`).
  4. **Ask for explicit user confirmation.**
  5. Recommend creating a **new variant** (copy the old entry/config → new id + new config file) so the
     original stays intact and comparable. This is the default suggestion, even with confirmation.

### Only exception: missing / malformed required data

When a strategy or config is **missing required data or is malformed**, fix the minimum needed to restore
validity — no separate confirmation gate, but report exactly what changed:

- Missing required string `id` or `name`.
- Invalid JSON / a parse error.
- `strategy.activeStrategyId` pointing at a non-existent library id.
- Active strategy missing `smartWalletListId` while the smart-wallet entry source is active.
- Legacy snake_case keys (`lp_strategy`, `token_criteria`, `exit.take_profit_pct`, …).
- Missing `screening.market.enabled` / `screening.smartWallets.enabled` so no entry source resolves.

While fixing, **do not change intent or behavior** — only restore the missing/broken data.

### Decision flow

```text
User asks to change an existing strategy/config?
  ├─ missing or invalid required data?  → fix in place (minimal), report the change
  └─ otherwise                          → propose change → ask confirmation → recommend NEW variant

User asks to create or tune a strategy?
  → always create a NEW library id + a NEW config file
```

### Why this matters

Library entries are mostly **metadata** — see the next section. Editing an entry in place usually does not
change bot behavior; behavior lives in the agent config. So "changing" a strategy means shipping a new
config + a new entry, which also preserves the ability to compare runs.

---

## What Actually Controls Runtime Behavior

Read this before "adjusting a strategy" — it determines where a change has to go.

| Setting | Where | Effect |
| --- | --- | --- |
| `strategy.activeStrategyId` | agent config | Selects the active library entry (context + smart-wallet list). **USED** |
| `strategy.strategyMeteora` | agent config | Actual deploy shape: `spot` \| `curve` \| `bid_ask`. **USED** |
| `strategy.minBinsBelow` / `maxBinsBelow` / `defaultBinsBelow` / `minSafeBinsBelow` | agent config | Bin range below active bin. **USED** |
| `management.*` | agent config | Stop-loss, take-profit, trailing, sizing, cooldowns. **USED** |
| `screening.common` / `market` / `smartWallets` | agent config | Pool filters and entry source. **USED** |
| `opportunity.*` | agent config | Opportunity poller + smart-wallet score bonus. **USED** |
| `risk.maxPositions` / `maxDeployAmount` | agent config | Global capital caps. **USED** |
| `smartWalletListId` | library entry | Startup validation + smart-wallet screening. **USED** |
| `lpStrategy`, `tokenCriteria`, `range`, `exit.takeProfitPct`, `bestFor`, `raw` | library entry | Stored / descriptive. `condition`, `notes`, `bestFor` feed the LLM strategy context; the rest are **not** read at deploy. |

There is **no `bins_above` config field** and no ratio field: directional bias is expressed through
`strategyMeteora` (shape) plus the `*BinsBelow` counts.

---

## Phase 1: Gather Minimum Required Information

Collect the following from the user. Ask as a single, concise message — don't split into separate turns
unless an answer is ambiguous. Extract anything already given in the conversation and ask only for what is
missing.

### Checklist (all required)

1. **Directional view** — bullish, bearish, or neutral on the token?
2. **Token type** — volatile/narrative, stable/high-volume pool, or blue-chip (SOL, ETH)?
3. **Risk tolerance** — conservative (tight stop-loss, quick exits), moderate, aggressive (hold through
   dips, re-seed)?
4. **Capital per position (SOL)** — how much SOL per position? (Drives `deployAmountSol` / `positionSizePct`.)
5. **Exit preference** — take profit at a %/threshold, trail the price, or let it run and re-seed?
6. **Smart-wallet tracking** — gate entry on smart-wallet presence (KOL/alpha wallets)? Affects
   `opportunity.smartWalletScoreBonus` and the opportunity poller.

---

## Phase 2: Review the Strategy Library

The library is **two files, merged at runtime**:

| File | Contents | Editable? |
| --- | --- | --- |
| `config/shared/strategy-library.shared.json` | Bundled open-source presets (5) | **Read-only** |
| `config/shared/strategy-library.json` | Private/user strategies (where new entries go) | New entries only |

Merged by `StrategyLibraryManager.loadMerged()` (`packages/core/src/domain/strategy-library.ts:76-108`):
private **overrides** shared on an id collision and logs a warning. Prefer private entries first, then
shared presets; only create something new if nothing fits.

Read both files. Bundled presets:

| ID | Name | LP Shape | Best For |
| --- | --- | --- | --- |
| `custom_ratio_spot` | Custom Ratio Spot | spot | Directional bias, earn fees both ways |
| `single_sided_reseed` | Single-Sided Bid-Ask + Re-seed | bid_ask | Volatile tokens, DCA-out on dip |
| `fee_compounding` | Fee Compounding | any | Stable volume pools, compounding yield |
| `multi_layer` | Multi-Layer | mixed | Custom distributions, one position |
| `partial_harvest` | Partial Harvest | any | High-fee pools, incremental profit-taking |

Private examples already present: `copy_trade_lag`, `smart_wallet_follow`
(see `docs/strategies/README-smart-wallet-follow.md` for a worked example).

### Recommendation Logic

Map the user's intent to an existing strategy **first**. Only propose a new one if no existing strategy
fits.

| User Intent | Recommended Strategy |
| --- | --- |
| Bullish / bearish directional view | `custom_ratio_spot` |
| Volatile token, exit on dump | `single_sided_reseed` |
| Stable pair, maximize yield | `fee_compounding` |
| Custom bin distribution | `multi_layer` |
| Lock in gains incrementally | `partial_harvest` |
| Neutral / range-bound | `fee_compounding` or `multi_layer` |

Present the recommendation with a one-sentence rationale. Example:

> "Based on your bullish view, I'd recommend `custom_ratio_spot` — it places more liquidity below the
> current price so you earn fees as the token rises, with a shape that leans into the move."

Then state the immutability rule and ask: **"Use this existing strategy in a new config, or create a new
strategy entry from scratch?"** Either way a **new config file** is produced.

---

## Phase 3: Smart-Wallet Decision

Ask (if not already answered in Phase 1):

> "Do you want to track smart wallets (KOL/alpha wallets) for this strategy? If enabled, the opportunity
> poller gives a score bonus to pools where tracked wallets are LPs, letting the agent enter pools it
> would otherwise skip."

Canonical config fields (nested under `opportunity` — the flat `opportunityPollEnabled` /
`opportunitySmartWalletBonus` / `opportunityMinScore` names are legacy aliases only):

```json
"opportunity": {
  "enabled": true,
  "minScore": 40,
  "smartWalletScoreBonus": 20
}
```

- **Yes** → `opportunity.enabled: true`, `opportunity.smartWalletScoreBonus: 20` (or higher). Set
  `smartWalletListId` on the new library entry and make sure that list exists in
  `config/shared/smart-wallets.json`. Populate via Telegram:
  `add smart wallet <address> name=<label> category=alpha type=lp`.
- **No** → `opportunity.smartWalletScoreBonus: 0`.

**Entry source** is derived, not set directly: `Config.ts:96` computes
`entrySource = screening.market.enabled ? 'market' : 'smart_wallets'`. Exactly one of
`screening.market.enabled` / `screening.smartWallets.enabled` must be `true`.

- `entrySource: market` → smart wallets are an optional boost; a missing `smartWalletListId` only skips the
  bonus.
- `entrySource: smart_wallets` → the active strategy **must** define `smartWalletListId`, or startup
  validation fails.

---

## Phase 4: Build the Config Patch

### Document reading order

Read these **in this order** before generating config — each layers on the previous:

1. `docs/ARCHITECTURE.md` — how the strategy library feeds deploy decisions
2. `docs/CONFIGURATION.md` — full field reference (types, defaults, env vars)
3. `config/templates/agent-config.example.json` — canonical template

### How to generate

**Copy the entire `config/templates/agent-config.example.json` first**, then change only the fields that
differ. This guarantees no required field is missed. The schema is strict:
`packages/core/src/config/schema.ts` — unknown keys fail validation.

Sections you will normally change:

#### `strategy` (required)

```json
"strategy": {
  "activeStrategyId": "<new_or_existing_id>",
  "strategyMeteora": "bid_ask|spot|curve",
  "minBinsBelow": 35,
  "maxBinsBelow": 69,
  "defaultBinsBelow": 69,
  "minSafeBinsBelow": 10
}
```

- `activeStrategyId` selects the library entry (must exist in the merged library).
- `strategyMeteora` is the deploy shape: `spot` (centered), `bid_ask` (edge-weighted / below),
  `curve` (curve).
- Bias: bullish/bearish is shaped by `strategyMeteora` + the `*BinsBelow` counts (and, for
  `single_sided_reseed`, token-only entry). There is no `bins_above` field.

#### `management` (risk / exit)

| Risk Level | `stopLossPct` | `takeProfitPct` | `trailingTakeProfit` | `outOfRangeWaitMinutes` |
| --- | --- | --- | --- | --- |
| Conservative | -15 | 3 | true | 15 |
| Moderate | -30 | 5 | true | 30 |
| Aggressive | -50 | 10 | false | 60 |

Also set: `deployAmountSol` (from capital-per-position), `positionSizePct` (deployAmountSol /
available SOL), and trailing fields `trailingTriggerPct` / `trailingDropPct` when trailing is on.

#### `opportunity` (smart-wallet gating)

```json
"opportunity": { "enabled": true, "minScore": 40, "smartWalletScoreBonus": 20 }
```

#### `screening` (token-type filters)

Filters live under **`screening.common`** (plus the `market` / `smartWallets` source blocks):

```json
"screening": {
  "common": { "minOrganic": 60, "minHolders": 500, "minBinStep": 80, "maxBinStep": 125,
              "minTvl": 10000, "maxTvl": 150000 },
  "market": { "enabled": true },
  "smartWallets": { "enabled": false }
}
```

| Token Type | `minOrganic` | `minHolders` | `minBinStep` | `maxBinStep` | `minTvl` | `maxTvl` |
| --- | --- | --- | --- | --- | --- | --- |
| Volatile/narrative | 60 | 500 | 80 | 125 | 10000 | 150000 |
| Stable/high-volume | 70 | 2000 | 1 | 50 | 100000 | 5000000 |
| Blue-chip (SOL/ETH) | 80 | 5000 | 1 | 25 | 500000 | 10000000 |

#### `risk` (global caps)

```json
"risk": { "maxPositions": 1, "maxDeployAmount": 50 }
```

### New strategy-library entry (only when creating)

Add a **new** entry under `strategies` in `config/shared/strategy-library.json`. Canonical schema
(`packages/core/src/domain/strategy-validation.ts:56-97`):

```json
{
  "id": "<new_snake_case_id>",
  "name": "<Human Readable Name>",
  "author": "custom",
  "smartWalletListId": "<list id — omit when unused>",
  "lpStrategy": "bid_ask|spot|curve|mixed|any",
  "tokenCriteria": { "notes": "<when to use>" },
  "entry": { "condition": "<entry trigger>", "singleSide": "sol|token", "notes": "<deployment notes>" },
  "range": { "type": "tight|default|wide|panda|custom", "binsBelowPct": 100, "notes": "<range notes>" },
  "exit": { "takeProfitPct": 10, "notes": "<exit rules>" },
  "bestFor": "<one-line summary>",
  "raw": "<optional source text>",
  "addedAt": "<ISO timestamp>",
  "updatedAt": "<ISO timestamp>"
}
```

Rules:

- The library **key must equal `id`** (lookup uses the key).
- `id` is slugified on save (lowercase, `_`, alphanumeric) — use `snake_case`.
- Nested allowed keys — `tokenCriteria`: `min_mcap`, `min_age_days`, `requires_kol`, `notes`;
  `entry`: `condition`, `price_change_threshold_pct`, `singleSide`, `notes`;
  `range`: `type`, `binsBelowPct`, `notes`; `exit`: `takeProfitPct`, `notes`.
- Snake_case top-level keys are **ignored** (`lp_strategy`, `added_at`, …) — always camelCase.
- Do **not** modify existing entries.

---

## Phase 5: Output

Present the result as clearly labeled blocks.

### Block A — Config patch file

Write a **new** file (never overwrite an existing one):

`config/instances/agent-config.<major-strategy-short-idea>.v<YYMMDD>-<counter>.json`

e.g. `config/instances/agent-config.smart-wallet-follow.v260913-1.json`. If the counter already exists, bump it.

The file must be a complete valid JSON config (all template fields, overrides applied). Run it with:

```bash
# safe dry-run first
AGENT_CONFIG_PATH=config/instances/<file> npm run dev
# live (after dry-run verification)
AGENT_CONFIG_PATH=config/instances/<file> npm start
```

### Block B — Strategy library entry (only if new)

Show the full JSON entry to append under `strategies` in `config/shared/strategy-library.json`. The
new strategy is activated by setting `strategy.activeStrategyId` to its id in the new config file (or via
the `set_active_strategy` tool). There is no `set-active-strategy` CLI command.

### Block C — Verification checklist

```text
[ ] Config validates:  AGENT_CONFIG_PATH=config/instances/<file> npm run validate:config
[ ] Strategy validates: npm run validate:strategy -- config/shared/strategy-library.json
[ ] Env vars: HELIUS_API_KEY (wallet/valuation), JUPITER_API_KEY (swaps), RPC_URL (optional),
              LLM_API_KEY / LLM_MODEL (or a direct llm.defaultModel)
[ ] dryRun: true  <- test before going live
[ ] Smart wallets: <populated list ID / not needed>
[ ] activeStrategyId: <id>
[ ] Original strategy/config left untouched (immutability)
```

---

## Reference Quick Map

| Need | Read |
| --- | --- |
| All config fields + types + env vars | `docs/CONFIGURATION.md` |
| Field defaults / canonical template | `config/templates/agent-config.example.json` |
| Bundled presets (read-only) | `config/shared/strategy-library.shared.json` |
| Private strategies (new entries go here) | `config/shared/strategy-library.json` |
| Strategy schema + validation rules | `packages/core/src/domain/strategy-validation.ts` |
| Merge / active-pointer behavior | `packages/core/src/domain/strategy-library.ts` |
| Worked strategy example | `docs/strategies/README-smart-wallet-follow.md` |
| Smart-wallet tracking setup | `docs/QA.md` → Smart Wallets section |
| Architecture (strategy at deploy) | `docs/ARCHITECTURE.md` → Strategy Library section |
| CLI strategy commands | `docs/USAGE_GUIDE.md` → Strategy management; `etemaro strategy validate` |
| Validate a strategy JSON | `etemaro-strategy-validator` skill |
