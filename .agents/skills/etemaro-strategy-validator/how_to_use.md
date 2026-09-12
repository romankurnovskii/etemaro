# How to Use: Etemaro Strategy Validator

## What This Skill Does

Validates Etemaro strategy (and config) JSON through the Etemaro CLI, reporting whether it is
valid and which fields are unknown or wrongly named, so you know what the agent will actually use.

## When to Use

- You edited `config/shared/strategy-library.json` and want to confirm it is valid.
- A strategy field "does nothing" and you suspect a naming/schema problem.
- You pasted or generated a strategy object and want it checked before adding it.
- You need to know which fields are ignored by the runtime.
- You changed `config/agent-config.json` and want the same report for it.

## Prompt Examples

```text
validate config/shared/strategy-library.json
```

```text
is this strategy valid? { "id": "my_strat", "name": "My Strat", "lpStrategy": "bid_ask" }
```

```text
check this strategy JSON schema: is takeProfitPct placed in exit correctly?
```

```text
validate the user config too, and run the active-strategy check
```

```text
does this strategy have any unknown fields that won't be used?
```

## What the Skill Runs

```bash
etemaro strategy validate <file...> [--active] [--strict] [--json]
etemaro config validate [<file>] [--env-optional] [--json]
# or from this repo, without a global install:
npm run validate:strategy -- <file...>
npm run validate:config --env-optional
```

To target a specific instance config:

```bash
AGENT_CONFIG_PATH=config/instances/agent-config.copy_trade_lag.v260830-1.json \
  etemaro strategy validate --active config/shared/strategy-library.json
```

## What You Get

The same report format for config and strategy:

```
File: config/shared/strategy-library.json
  Validation: copy_trade_lag
  Status:     VALID
  Warnings:
    - unknown field "foo" is not part of the Strategy schema — will be ignored
  Unknown (unused) fields: foo
  Field usage:
    smartWalletListId    USED (startup validation + smart-wallet screening)
    lpStrategy           stored/descriptive (deploy uses config.strategy.strategyMeteora)
    ...
Totals: 1 valid, 0 invalid
```

Exit code `0` = valid, `1` = invalid. Use `--json` for machine-readable output.

## Canonical Schema Rules

- All fields are strictly **camelCase**.
- Required top-level keys: `id`, `name`.
- Canonical top-level keys: `id`, `name`, `author`, `smartWalletListId`, `lpStrategy`, `tokenCriteria`, `entry`, `range`, `exit`, `bestFor`, `raw`, `addedAt`, `updatedAt`.
- Canonical nested keys:
  - `entry`: `condition`, `price_change_threshold_pct`, `singleSide`, `notes`
  - `range`: `type`, `binsBelowPct`, `notes`
  - `exit`: `takeProfitPct`, `notes`
  - `tokenCriteria`: `min_mcap`, `min_age_days`, `requires_kol`, `notes`
- `--active` enforces active strategy requirements (e.g. `smartWalletListId` when `screening.entrySource=smart_wallets`).
- `config validate --env-optional` checks structure without requiring deployment secrets.
- Pre-commit (husky) runs both validators; commits with invalid fields are blocked.
