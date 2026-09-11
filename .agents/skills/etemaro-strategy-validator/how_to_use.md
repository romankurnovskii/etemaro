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
is this strategy valid? { "id": "my_strat", "name": "My Strat", "lp_strategy": "bid_ask" }
```

```text
why is my strategy's takeProfitPct ignored — check this strategy JSON
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

## Tips

- Prefer canonical camelCase. Snake_case keys (`lp_strategy`, `best_for`, `single_side`, ...)
  do not throw — they are silently dropped, which is why the validator reports them as errors.
- `--active` catches the "entrySource=smart_wallets but no smartWalletListId" failure before boot.
- `config validate --env-optional` checks structure without requiring deployment secrets;
  without the flag, unset `env.*` references are errors (matching boot).
- "stored/descriptive" fields are valid but do not change deploy decisions.
- Pre-commit (husky) already runs both validators; a blocked commit prints the same report.
