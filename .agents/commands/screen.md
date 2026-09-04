---
description: Full screening cycle — find best pool and deploy if wallet has funds
---
Run a full screening cycle. Use the Bash tool for all commands sequentially (never background, never parallel).

**Step 1 — Read config:**
```
cat user-config.json
```
Note `deployAmountSol`, `gasReserve`, and `maxPositions`. Minimum wallet needed = deployAmountSol + gasReserve.

**Step 2 — Wallet balance:**
```
node --import tsx packages/cli/src/Cli.ts balance
```
If SOL < (deployAmountSol + gasReserve): stop here — insufficient funds.

**Step 2b — Read memory:**
```
node --import tsx packages/cli/src/Cli.ts lessons
node --import tsx packages/cli/src/Cli.ts blacklist list
```
Note any rules that apply to this cycle. Never deploy to blacklisted tokens.

**Step 3 — Fetch candidates:**
```
node --import tsx packages/cli/src/Cli.ts candidates --limit 5
```

**Step 4 — OKX smart money signals:**
```
onchainos signal list --chain solana --wallet-type 1
```

**Step 5 — Deep research on top 2 candidates:**

For each of the top 2 candidates by fee_active_tvl_ratio, run all of the following:

```
node --import tsx packages/cli/src/Cli.ts token-info --query <mint>
node --import tsx packages/cli/src/Cli.ts token-holders --mint <mint>
node --import tsx packages/cli/src/Cli.ts token-narrative --mint <mint>
node --import tsx packages/cli/src/Cli.ts pool-detail --pool <pool_address>
node --import tsx packages/cli/src/Cli.ts active-bin --pool <pool_address>
node --import tsx packages/cli/src/Cli.ts study --pool <pool_address>
node --import tsx packages/cli/src/Cli.ts pool-memory --pool <pool_address>
```
If pool-memory shows previous deploys with poor range efficiency or repeated OOR closes, penalise this candidate heavily.

**Step 6 — Analyse and decide:**

Rank candidates using all gathered data:
- Hard reject: bot% > 30%, top10 > 60%, organic < 60, fee/TVL < 0.2
- Score by: smart money signal > fee_active_tvl_ratio > organic_score > top LPer win rate > low bundlers_pct
- Check study output: if top LPers have <50% win rate on this pool, reduce confidence
- Check active bin: confirm pool is active and price is stable
- Cross-reference mints against OKX smart money signals

Pick the best candidate and deploy:
```
node --import tsx packages/cli/src/Cli.ts deploy --pool <pool_address> --amount <sol_amount>
```

Always explain your full reasoning (candidates scored, deep research findings, why winner chosen, deploy amount) before executing any deploy.

**Execution rules:** Run all commands sequentially via Bash, wait for each to complete. Never background. Never parallel.
