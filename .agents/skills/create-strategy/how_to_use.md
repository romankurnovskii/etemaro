# How to Use: Create Strategy

## What This Skill Does

Guides an agent through creating a new Etemaro LP strategy — picking a preset or defining a new one, then
producing a complete, validated agent config plus (when needed) a new strategy-library entry.

Strategies are **immutable by default**: the skill always creates a **new** strategy id and a **new**
config file. It never edits or overwrites an existing strategy unless the user explicitly confirms, and it
recommends a new variant even then. The only in-place fix is restoring missing/malformed required data.

## When to Use

- "Create a strategy", "add a new strategy", "set up a strategy", "configure LP strategy".
- "What strategy should I use?" / "I want to go bullish on SOL" / "earn fees on a stable pair".
- "Tweak my strategy" / "change my strategy" — the skill proposes and asks before touching anything.

## Prompt Examples

```text
create a strategy: bullish on SOL, moderate risk, 0.1 SOL per position
```

```text
set up an LP strategy for a volatile narrative token, conservative, smart-wallet gated
```

```text
my copy_trade_lag strategy under-triggers — should we change it?
```

```text
which strategy fits a stable, high-volume pair with fee compounding?
```

## What You Get

1. **A new config file** `config/instances/agent-config.<idea>.v<YYMMDD>-<n>.json` (never overwrites an
   existing one).
2. **A new strategy-library entry** under `strategies` in `config/shared/strategy-library.json` (only when
   creating a new strategy).
3. **A verification checklist** with the exact validation commands.

## Immutability in Practice

| Situation | Action |
| --- | --- |
| User wants a strategy | Create new id + new config |
| Agent thinks an existing strategy is wrong | Stop → propose → ask → recommend new variant |
| Existing strategy missing required data / malformed | Minimal in-place fix, reported |
| Bundled preset needs changes | Copy to a new private entry; never edit the preset |

## Related

- Validate generated JSON with the `etemaro-strategy-validator` skill.
- Field reference: `docs/CONFIGURATION.md`; template: `config/templates/agent-config.example.json`.
- Worked example: `docs/strategies/README-smart-wallet-follow.md`.
