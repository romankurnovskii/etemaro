---
name: etemaro-strategy-validator
description: >
  Validate Etemaro strategy JSON files through the Etemaro CLI and report whether each
  strategy is valid or invalid, plus which fields are unknown and will therefore be
  ignored by the runtime. Use this skill whenever the user asks to validate, lint, check, or
  sanity-check a strategy JSON file (config/shared/strategy-library.json, an agent strategy
  entry, or a pasted strategy object), asks "is this strategy valid?", "why is my strategy
  field ignored?", "check the strategy schema", or "does this strategy have unknown fields?".
  Trigger even without the word "validate": pointing at a strategy JSON and asking what is
  wrong or what will be used is this skill.
metadata:
  version: 2.0.0
---

# Etemaro Strategy Validator

Validates strategy JSON against the canonical `Strategy` schema using the **Etemaro CLI** as
the single source of truth. Never re-implement the schema in a script — call the command.
User config uses the same CLI and the same report format (`etemaro config validate`).

Why this matters: `StrategyLibraryManager.loadMerged()` casts the JSON straight to `Strategy`
with no normalisation. Unknown fields or misplaced keys are silently dropped and code reading
them sees `undefined`. The command surfaces that.

## Run it

Prefer the global binary; fall back to the project scripts. Run from the repository root.

```bash
# strategy library / single strategy
etemaro strategy validate config/shared/strategy-library.json
npm run validate:strategy -- config/shared/strategy-library.json

# active-strategy check (requires smartWalletListId when the loaded config needs it)
etemaro strategy validate --active config/shared/strategy-library.json

# user config (same report format)
etemaro config validate
etemaro config validate --env-optional
npm run validate:config --env-optional

# machine-readable / strict
etemaro strategy validate config/shared/strategy-library.json --json
etemaro strategy validate config/shared/strategy-library.json --strict
```

Flags:

| Flag | Command | Effect |
|------|---------|--------|
| `--active` | strategy | Enforce active-strategy gate: error when `screening.entrySource=smart_wallets` and strategy lacks `smartWalletListId`; warn when `smartWalletScoreBonus>0` without a list |
| `--strict` | strategy | Treat unknown top-level fields as errors |
| `--env-optional` | config | Downgrade unset `env.*` references to warnings (structure-only validation) |
| `--json` | both | Machine-readable report |

To target a specific instance config:

```bash
AGENT_CONFIG_PATH=config/instances/agent-config.copy_trade_lag.v260830-1.json \
  etemaro strategy validate --active config/shared/strategy-library.json
```

## Reading the report

Both commands use this format:

```
File: <path>
  Validation: <config | strategy-id>
  Status:     VALID|INVALID
  Errors:     ...
  Warnings:   ...
  Notes:      ...
  Unknown (unused) fields: <comma list>
  Field usage: <field → consumed/descriptive>   (strategy only)
Totals: N valid, M invalid
```

- **Status** — INVALID means at least one error (fix before deploying).
- **Errors** — missing required fields, wrong types, unknown config keys, broken `smartWalletListId`.
- **Warnings** — unknown strategy fields ("will be ignored"), bad enums, unparsable dates, or
  unset env refs under `--env-optional`.
- **Unknown (unused) fields** — the explicit answer to "what will not be in use?".
- **Field usage** — for each strategy field, whether current code consumes it or it is
  descriptive only.

Exit code is `0` when valid, `1` otherwise.

Report back to the user with: file, entry id, VALID/INVALID, errors first, then unknown/unused fields, then notes on descriptive fields. Keep it terse.

## Accepted input shapes

- A strategy library `{ "strategies": { "<id>": { ... } } }` — validates every entry.
- A single strategy object `{ "id": "...", "name": "...", ... }`.
- A config JSON file (for `config validate`).

## Exact Canonical Schema

All keys are strictly **camelCase**.

Required strategy keys: `id`, `name`.

| Key | Type | Consumed by Runtime? |
|-----|------|----------------------|
| `id` | string | **yes** — library key + active pointer |
| `name` | string | **yes** — logs, lists, LLM strategy context |
| `author` | string | stored/descriptive |
| `smartWalletListId` | string | **yes** — startup validation + smart-wallet screening |
| `lpStrategy` | string (`bid_ask`\|`spot`\|`curve`\|`mixed`\|`any`) | stored/descriptive (deploy uses `config.strategy.strategyMeteora`) |
| `tokenCriteria` | object | stored/descriptive (not read by screening) |
| `entry` | object | partial — `condition`/`notes` feed LLM context; `singleSide` not consumed |
| `range` | object | stored/descriptive (not read at deploy) |
| `exit` | object | partial — `notes` feed LLM context; `takeProfitPct` not consumed |
| `bestFor` | string | **yes** — LLM strategy context + lists |
| `raw` | string | stored/descriptive |
| `addedAt` / `updatedAt` | ISO date string | stored/descriptive |

### Exact Nested Field Specifications

- **`entry`**:
  - `condition`: string (describes entry logic)
  - `singleSide`: `"sol"` | `"token"` | null
  - `price_change_threshold_pct`: number
  - `notes`: string
- **`range`**:
  - `type`: `"tight"` | `"default"` | `"wide"` | `"panda"` | `"custom"`
  - `binsBelowPct`: number
  - `notes`: string
- **`exit`**:
  - `takeProfitPct`: number
  - `notes`: string
- **`tokenCriteria`**:
  - `min_mcap`: number
  - `min_age_days`: number
  - `requires_kol`: boolean
  - `notes`: string

## Pre-commit

`.husky/pre-commit` runs both validators before every commit:
`validate:config --env-optional`, private strategy library with `--active`, and shared strategy library. Blocked commits must be corrected to follow canonical camelCase schema.

## Source of Truth

The strategy schema lives in `packages/core/src/domain/strategy-validation.ts`; config validator wraps `UserConfigSchema` in `packages/core/src/config/config-validation.ts`. Both are exported through `@etemaro/core` and surfaced by the CLI.
