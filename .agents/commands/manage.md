---
description: Review all open positions and take management actions
---
Run a full management cycle:

1. Check all positions — run via Bash:
```
node --import tsx packages/cli/src/Cli.ts positions
```

2. For each position, get PnL — the output now includes `strategy` and `instruction` from state:
```
node --import tsx packages/cli/src/Cli.ts pnl ADDRESS
```
Replace ADDRESS with the position address string from step 1.

3. Note the `strategy` field from the pnl output. Apply **strategy-specific** management rules:

**`custom_ratio_spot` (default):**
- OOR upside + profitable (PnL > 10%) → close immediately to lock gains: `node --import tsx packages/cli/src/Cli.ts close --position <addr>`
- OOR downside > 10 min, no volume recovery → close: `node --import tsx packages/cli/src/Cli.ts close --position <addr>`
- In range, fees > $5 → claim: `node --import tsx packages/cli/src/Cli.ts claim --position <addr>`
- In range, total return >= 10% → close and take profit: `node --import tsx packages/cli/src/Cli.ts close --position <addr>`

**`fee_compounding`:**
- In range, unclaimed fees > $5 → claim fees (`node --import tsx packages/cli/src/Cli.ts claim --position <addr>`) and redeploy the claimed SOL amount back to the pool (`node --import tsx packages/cli/src/Cli.ts deploy --pool <pool> --amount <claimed_sol> --allow-duplicate-pool`)
- OOR → close normally: `node --import tsx packages/cli/src/Cli.ts close --position <addr>`

**`single_sided_reseed`:**
- OOR downside + token still has volume → close position (`node --import tsx packages/cli/src/Cli.ts close --position <addr>`), swap base token to SOL if needed, and redeploy single-sided SOL bid_ask strategy at new lower price (`node --import tsx packages/cli/src/Cli.ts deploy --pool <pool> --amount <sol_bal> --strategy bid_ask`)
- OOR + no volume / token dead → close normally: `node --import tsx packages/cli/src/Cli.ts close --position <addr>`

**`partial_harvest`:**
- In range, total return (fees + PnL) >= 10% of deployed capital → since partial close is not supported, close position entirely (`node --import tsx packages/cli/src/Cli.ts close --position <addr>`), swap to SOL, and redeploy 50% of the capital (`node --import tsx packages/cli/src/Cli.ts deploy --pool <pool> --amount <50%_sol_bal>`), keeping the other 50% as profit.
- OOR → close normally: `node --import tsx packages/cli/src/Cli.ts close --position <addr>`

**`multi_layer`:**
- Manage each sub-position independently using custom_ratio_spot rules above

4. **Instruction override (highest priority):** If `instruction` is set (e.g. "close at 5% profit"), check it first and execute if the condition is met.

**Global close rules (override strategy defaults when data is clear):**
- OOR upside + PnL > 10% → close IMMEDIATELY regardless of strategy: `node --import tsx packages/cli/src/Cli.ts close --position <addr>`
- PnL < -25% with no volume recovery → close: `node --import tsx packages/cli/src/Cli.ts close --position <addr>`
- Position age > 2h and OOR downside with no recovery → close: `node --import tsx packages/cli/src/Cli.ts close --position <addr>`

Execute any actions with the appropriate CLI commands. Explain each decision.

**Important:** Run all commands sequentially via Bash, never in background. Wait for each command to complete before running the next. Do not use background tasks or parallel execution.
