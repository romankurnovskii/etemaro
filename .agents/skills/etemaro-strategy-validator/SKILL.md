---
name: etemaro-strategy-validator
description: >
  Validate Etemaro strategy JSON files through the Etemaro CLI and report whether each
  strategy is valid or invalid, plus which fields are unknown/legacy and will therefore be
  ignored by the runtime. Use this skill whenever the user asks to validate, lint, check, or
  sanity-check a strategy JSON file (config/shared/strategy-library.json, an agent strategy
  entry, or a pasted strategy object), asks "is this strategy valid?", "why is my strategy
  field ignored?", "check the strategy schema", or "does this strategy have unknown fields?".
  Also trigger when a strategy behaves as if a field is missing — that is usually a silently
  dropped snake_case key. Trigger even without the word "validate": pointing at a strategy JSON
  and asking what is wrong or what will be used is this skill.
metadata:
  version: 1.2.0
---

# Etemaro Strategy Validator

Validates strategy JSON against the canonical `Strategy` schema using the **Etemaro CLI** as
the single source of truth. Never re-implement the schema in a script — call the command.
User config uses the same CLI and the same report format (`etemaro config validate`).

Why this matters: `StrategyLibraryManager.loadMerged()` casts the JSON straight to `Strategy`
with no normalisation. A snake_case key like `lp_strategy` does not throw; it is silently
dropped and code reading `strategy.lpStrategy` sees `undefined`. The command surfaces that.

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
| `--active` | strategy | Enforce the active-strategy gate: error when `screening.entrySource=smart_wallets` and the strategy lacks `smartWalletListId`; warn when `smartWalletScoreBonus>0` without a list (optional boost) |
| `--strict` | strategy | Treat unknown top-level fields as errors |
| `--env-optional` | config | Downgrade unset `env.*` references to warnings (structure-only validation) |
| `--json` | both | Machine-readable report |

To target a specific instance config:

```bash
USER_CONFIG_PATH=config/instances/user-config.copy_trade_lag.v260830-1.json \
  etemaro strategy validate --active config/shared/strategy-library.json
```

(Use the env var, not `--config <path>`, when you also need positional file arguments —
`--config` is a global flag resolved before subcommand parsing.)

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
- **Errors** — missing required fields, wrong types, legacy snake_case keys, unknown config
  keys, broken `smartWalletListId`.
- **Warnings** — unknown strategy fields ("will be ignored"), bad enums, unparsable dates, or
  unset env refs under `--env-optional`.
- **Unknown (unused) fields** — the explicit answer to "what will not be in use?".
- **Field usage** — for each strategy field, whether current code consumes it or it is
  descriptive only.

Exit code is `0` when valid, `1` otherwise.

Report back to the user with: file, entry id, VALID/INVALID, errors first, then the
unknown/unused fields, then one line noting that descriptive-only fields do not affect deploy
decisions. Keep it terse; do not restate the whole field-usage table unless asked.

## Accepted input shapes

- A strategy library `{ "strategies": { "<id>": { ... } } }` — validates every entry.
- A single strategy object `{ "id": "...", "name": "...", ... }`.
- A config JSON file (for `config validate`).

## Canonical schema (for interpreting the report)

Required strategy keys: `id`, `name`.

| Key | Type | Consumed? |
|-----|------|-----------|
| `id` | string | yes — library key + active pointer |
| `name` | string | yes — logs, lists, LLM strategy context |
| `author` | string | stored/descriptive |
| `smartWalletListId` | string | **yes** — startup validation + smart-wallet screening |
| `lpStrategy` | string (`bid_ask`/`spot`/`curve`/`mixed`/`any`) | descriptive — deploy uses `config.strategy.strategyMeteora` |
| `tokenCriteria` | object | descriptive — not read by screening |
| `entry` | object | partial — `condition`/`notes` feed the LLM context; `singleSide` is not consumed |
| `range` | object | descriptive — not read at deploy |
| `exit` | object | partial — `notes` feed the LLM context; `takeProfitPct` is not consumed |
| `bestFor` | string | yes — LLM strategy context + lists |
| `raw` | string | stored/descriptive |
| `addedAt` / `updatedAt` | ISO date string | stored/descriptive |

Known nested subfields: `tokenCriteria` (`min_mcap`, `min_age_days`, `requires_kol`, `notes`),
`entry` (`condition`, `price_change_threshold_pct`, `singleSide` `sol|token`, `notes`),
`range` (`type`, `binsBelowPct`, `notes`), `exit` (`takeProfitPct`, `notes`).

## Legacy snake_case → camelCase

These keys silently do nothing; the command reports each as an error:

| Legacy (ignored) | Canonical |
|------------------|-----------|
| `lp_strategy` | `lpStrategy` |
| `token_criteria` | `tokenCriteria` |
| `best_for` | `bestFor` |
| `added_at` | `addedAt` |
| `updated_at` | `updatedAt` |
| `entry.single_side` | `entry.singleSide` |
| `range.bins_below_pct` | `range.binsBelowPct` |
| `exit.take_profit_pct` | `exit.takeProfitPct` |

## Pre-commit

`.husky/pre-commit` runs both validators before every commit:
`validate:config --env-optional`, the private strategy library with `--active`, and the shared
strategy library. If a commit is blocked, run the same commands locally and fix the reported
errors.

## Keeping the schema current

The strategy schema lives in `packages/core/src/domain/strategy-validation.ts`; the config
validator wraps `UserConfigSchema` in `packages/core/src/config/config-validation.ts`. Both are
exported through `@etemaro/core` and surfaced by the CLI. Update those files when
`shared/types.ts` (`Strategy`), `strategy-library.ts`, `config/schema.ts`, or
`ToolDefinitions.ts` changes — never fork the schema into a skill script.
