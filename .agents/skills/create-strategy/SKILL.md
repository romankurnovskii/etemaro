---
name: create-strategy
description: >
  Guide for creating a new Etemaro LP strategy from scratch or selecting and adapting an existing one.
  Use this skill whenever a user asks to "create a strategy", "add a new strategy", "set up a strategy",
  "configure LP strategy", "what strategy should I use", or any variant involving Etemaro strategy setup,
  customization, or deployment configuration. Also trigger when the user describes a trading goal (e.g.
  "I want to go bullish on SOL", "I want to earn fees on a stable pair", "I have a volatile token")
  and needs it translated into a concrete config.
metadata:
  version: 1.0.0
---

# Create Strategy — Etemaro

This skill walks an agent through creating or selecting an LP strategy for the Etemaro trading daemon,
then generates a ready-to-use config patch.

---

## Phase 1: Gather Minimum Required Information

Before looking at any existing strategies, collect the following from the user.
Ask as a single, concise message — don't split into separate turns unless the user's answer is ambiguous.

### Checklist (all required)

1. **Directional view** — Is the user bullish, bearish, or neutral on the token?
2. **Token type** — Is this a volatile/narrative token, a stable/high-volume pool, or a blue-chip (SOL, ETH)?
3. **Risk tolerance** — Conservative (tight stop-loss, quick exits), moderate, or aggressive (hold through dips, re-seed)?
4. **Capital per position (SOL)** — How much SOL to deploy per position? (Relevant for fee/risk math.)
5. **Exit preference** — Take profit at a specific % gain? Trail the price? Let it run and re-seed?
6. **Smart-wallet tracking** — Should the strategy be gated by smart-wallet presence (KOL/alpha wallets)?
   This affects `opportunitySmartWalletBonus` and the opportunity poller.

> If the user already gave some of these in their request, extract answers from the conversation and only
> ask for what is missing. Don't ask for things you already know.

---

## Phase 2: Review Strategy Library

Read `data/strategy-library.json` now. It contains the canonical list of LP strategy presets:

| ID                    | Name                           | LP Shape | Best For                                  |
| --------------------- | ------------------------------ | -------- | ----------------------------------------- |
| `custom_ratio_spot`   | Custom Ratio Spot              | spot     | Directional bias, earn fees both ways     |
| `single_sided_reseed` | Single-Sided Bid-Ask + Re-seed | bid_ask  | Volatile tokens, DCA-out on dip           |
| `fee_compounding`     | Fee Compounding                | any      | Stable volume pools, compounding yield    |
| `multi_layer`         | Multi-Layer                    | mixed    | Custom distributions, one position        |
| `partial_harvest`     | Partial Harvest                | any      | High-fee pools, incremental profit-taking |

### Recommendation Logic

Map the user's intent to an existing strategy **first**. Only propose a new one if no existing strategy fits.

| User Intent                          | Recommended Strategy                                     |
| ------------------------------------ | -------------------------------------------------------- |
| Bullish / bearish directional view   | `custom_ratio_spot` (adjust bins_below:bins_above ratio) |
| Volatile token, want to exit on dump | `single_sided_reseed`                                    |
| Stable pair, maximize yield          | `fee_compounding`                                        |
| Want custom bin distribution         | `multi_layer`                                            |
| Want to lock in gains incrementally  | `partial_harvest`                                        |
| Neutral / range-bound                | `fee_compounding` or `multi_layer`                       |

Present your recommendation to the user with a one-sentence rationale. Example:

> "Based on your bullish view, I'd recommend `custom_ratio_spot` — it places more bins below the
> current price so you earn fees as the token rises, and auto-closes if it breaks out of range."

Ask: "Would you like to use this existing strategy, adjust it, or create a new one from scratch?"

---

## Phase 3: Smart Wallet Decision

Ask (if not already answered in Phase 1):

> "Do you want to track smart wallets (KOL/alpha wallets) for this strategy?
> If enabled, the opportunity poller gives a score bonus to pools where tracked wallets are LPs,
> letting the agent enter pools it would otherwise skip."

- **Yes** → set `opportunityPollEnabled: true`, `opportunitySmartWalletBonus: 20` (or higher).
  Remind the user to populate `data/smart-wallets.json` via:
  ```
  Telegram: add smart wallet <address> name=<label> category=alpha type=lp
  ```
- **No** → set `opportunitySmartWalletBonus: 0` or leave `opportunityPollEnabled: false`.

---

## Phase 4: Build the Config Patch

### Document reading order

Read these docs **in this order** before generating config — each one layers on the previous:

1. `docs/ARCHITECTURE.md` — understand the strategy library's role in deploy decisions
2. `docs/CONFIGURATION.md` — full field reference (all categories, types, defaults)
3. `config/templates/user-config.example.json` — canonical template; every field that must be present

### Config sections to populate

When generating a new config file, **first copy the entire content of `config/templates/user-config.example.json`**. Then, modify only the specific fields that differ based on the user's requirements. This ensures no required fields are missed. Cover these sections:

#### `strategy` section (always required)

```json
"strategy": {
  "strategy": "<bid_ask|spot|curve>",
  "minBinsBelow": <int>,
  "maxBinsBelow": <int>,
  "defaultBinsBelow": <int>,
  "minSafeBinsBelow": <int>
}
```

**Directional bias rules** (for `custom_ratio_spot`):

- 75% bullish → `bins_below : bins_above ≈ 52:17` → set high `defaultBinsBelow`, low `maxBinsBelow`
- 75% bearish → flip: mostly bins above (use single-sided or flip ratio)
- Neutral → equal split (35 below, 35 above)

#### `management` section (risk/exit fields)

Populate based on user's risk tolerance and exit preference:

| Risk Level   | `stopLossPct` | `takeProfitPct` | `trailingTakeProfit` | `outOfRangeWaitMinutes` |
| ------------ | ------------- | --------------- | -------------------- | ----------------------- |
| Conservative | -15           | 3               | true                 | 15                      |
| Moderate     | -30           | 5               | true                 | 30                      |
| Aggressive   | -50           | 10              | false                | 60                      |

Also set:

- `deployAmountSol` — from user's capital-per-position answer
- `positionSizePct` — deployAmountSol / available_sol (ask user for wallet SOL if unknown)

#### `opportunity` section (smart wallet gating)

```json
"opportunity": {
  "opportunityPollEnabled": true|false,
  "opportunitySmartWalletBonus": 0|20,
  "opportunityMinScore": 40
}
```

#### `screening` section (token-type filters)

Adjust based on token type:

| Token Type          | `minOrganic` | `minHolders` | `minBinStep` | `maxBinStep` | `minTvl` | `maxTvl` |
| ------------------- | ------------ | ------------ | ------------ | ------------ | -------- | -------- |
| Volatile/narrative  | 60           | 500          | 80           | 125          | 10000    | 150000   |
| Stable/high-volume  | 70           | 2000         | 1            | 50           | 100000   | 5000000  |
| Blue-chip (SOL/ETH) | 80           | 5000         | 1            | 25           | 500000   | 10000000 |

#### `strategy-library.json` entry (if new or customized strategy)

If the user wants a new or customized strategy, generate a new entry for `data/strategy-library.json`:

```json
{
  "id": "<snake_case_id>",
  "name": "<Human Readable Name>",
  "author": "<user or custom>",
  "lp_strategy": "<spot|bid_ask|curve|mixed|any>",
  "token_criteria": { "notes": "<when to use this>" },
  "entry": {
    "condition": "<entry trigger>",
    "single_side": null,
    "notes": "<deployment notes>"
  },
  "range": {
    "type": "<default|custom>",
    "bins_below_pct": 100,
    "notes": "<range notes>"
  },
  "exit": {
    "take_profit_pct": 10,
    "notes": "<exit rules>"
  },
  "best_for": "<one-line summary>",
  "added_at": "<ISO timestamp>",
  "updated_at": "<ISO timestamp>"
}
```

Then set it as active with:

```bash
npm run cli set-active-strategy -- --id <your_id>
```

---

## Phase 5: Output

Present the result as three clearly labeled blocks:

### Block A — Config patch file

Generate the patch as a separate configuration file. Unless the user specifically requests another name, use the following pattern:
`config/user-config.<major-strategy-short-idea>.<?minor-desc>.v<YYMMDD>-<counter-number>.json`
(e.g., `config/user-config.copy-trade.v260817-1.json`).

The generated config MUST be a complete JSON file containing all fields from the example config, with the relevant overrides applied.

Tell the user they can run the bot with this config using:
`USER_CONFIG_PATH=<filename> npm start`

### Block B — Strategy library entry (if new/customized)

Show the full JSON entry to append into `data/strategy-library.json` → `strategies` object.
Provide the CLI command to activate it.

### Block C — Verification checklist

```
✅ Env vars assumed set: WALLET_PRIVATE_KEY, LLM_API_KEY, LLM_MODEL, RPC_URL
✅ dryRun: true  ← test first before going live
✅ Smart wallets: <populated / not needed>
✅ Active strategy ID: <id>
✅ Run: npm run dev  ← safe dry-run verification
✅ When ready for live: set dryRun: false and npm start
```

---

## Reference Quick Map

| Need                                          | Read                                                |
| --------------------------------------------- | --------------------------------------------------- |
| All config fields + types                     | `docs/CONFIGURATION.md`                             |
| Field defaults                                | `config/templates/user-config.example.json`         |
| Existing strategy presets                     | `data/strategy-library.json`                        |
| Smart wallet tracking setup                   | `docs/QA.md` → Smart Wallets section                |
| Architecture (how strategy is used at deploy) | `docs/ARCHITECTURE.md` → Strategy Library section   |
| CLI strategy commands                         | `docs/USAGE_GUIDE.md` → Strategy management section |
| Full agent flow                               | `docs/FULL_FLOW.md`                                 |
