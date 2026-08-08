---
description: Review all open positions and take management actions
---
Run a full management cycle:

1. Check all positions — run via Bash:
```
node cli.js positions
```

2. For each position, get PnL — the output now includes `strategy` and `instruction` from state:
```
node cli.js pnl ADDRESS
```
Replace ADDRESS with the position address string from step 1.

3. Note the `strategy` field from the pnl output. Apply **strategy-specific** management rules:

**`custom_ratio_spot` (default):**
- OOR upside + profitable (PnL > 10%) → close immediately to lock gains
- OOR downside > 10 min, no volume recovery → close
- In range, fees > $5 → claim
- In range, total return >= 10% → close and take profit

**`fee_compounding`:**
- In range, unclaimed fees > $5 → `node cli.js claim-fees --position <addr> --pool <pool>` then `node cli.js add-liquidity --position <addr> --pool <pool> --amount-y <claimed_sol>` to re-add fees back
- OOR → close normally

**`single_sided_reseed`:**
- OOR downside + token still has volume → do NOT close. Instead: `node cli.js withdraw-liquidity --position <addr> --pool <pool> --bps 10000 --no-claim` then `node cli.js add-liquidity --position <addr> --pool <pool> --amount-x <token_bal> --strategy bid_ask` to re-seed at new price
- OOR + no volume / token dead → close normally

**`partial_harvest`:**
- In range, total return (fees + PnL) >= 10% of deployed capital → `node cli.js withdraw-liquidity --position <addr> --pool <pool> --bps 5000` to pull 50% off, then swap harvested tokens to SOL. Let remaining 50% keep running.
- OOR → close normally

**`multi_layer`:**
- Manage each sub-position independently using custom_ratio_spot rules above

4. **Instruction override (highest priority):** If `instruction` is set (e.g. "close at 5% profit"), check it first and execute if the condition is met.

**Global close rules (override strategy defaults when data is clear):**
- OOR upside + PnL > 10% → close IMMEDIATELY regardless of strategy
- PnL < -25% with no volume recovery → close
- Position age > 2h and OOR downside with no recovery → close

Execute any actions with the appropriate CLI commands. Explain each decision.

**Important:** Run all commands sequentially via Bash, never in background. Wait for each command to complete before running the next. Do not use background tasks or parallel execution.
