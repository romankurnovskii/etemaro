---
description: Full screening cycle — find best pool and deploy if wallet has funds
---
Run a full screening cycle. Use the Bash tool for all commands sequentially (never background, never parallel).

**Step 0 — Check discord signal queue:**
```
node cli.js discord-signals
```
If any signals show `status: "pending"`:
- Use the newest pending signal as the **priority candidate** for this cycle
- Note its pool_address, base_symbol, discord_author, channel, and **token_age_minutes**
- Skip Step 3 (regular candidates scan) — go directly to Step 5 (deep research) on this pool
- Label it "Discord signal from @<author> in #<channel>"
- **Token age rule:** If `token_age_minutes <= 30` (brand new token), favor **2-sided Spot** strategy regardless of other signals. New tokens need uniform distribution during price discovery — Bid-Ask is too risky this early.
- If this signal fails deep research (hard reject), add its mint to blacklist: `node cli.js blacklist add --mint <mint> --reason "discord signal — failed screening"`

If no pending signals: proceed with normal cycle (Steps 1–6 as written).

**Step 1 — Read config:**
```
cat user-config.json
```
Note `deployAmountSol`, `gasReserve`, and `maxPositions`. Minimum wallet needed = deployAmountSol + gasReserve.

**Step 2 — Wallet balance:**
```
node cli.js balance
```
If SOL < (deployAmountSol + gasReserve): stop here — insufficient funds.

**Step 2b — Read memory:**
```
node cli.js lessons
node cli.js blacklist list
```
Note any rules that apply to this cycle. Never deploy to blacklisted tokens.

**Step 3 — Fetch candidates:**
```
node cli.js candidates --limit 5
```

**Step 4 — OKX smart money signals:**
```
onchainos signal list --chain solana --wallet-type 1
```

**Step 5 — Deep research on top 2 candidates:**

For each of the top 2 candidates by fee_active_tvl_ratio, run all of the following:

```
node cli.js token-info --query <mint>
node cli.js token-holders --mint <mint>
node cli.js token-narrative --mint <mint>
node cli.js pool-detail --pool <pool_address>
node cli.js active-bin --pool <pool_address>
node cli.js study --pool <pool_address>
node cli.js pool-memory --pool <pool_address>
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
node cli.js deploy --pool <pool_address> --amount <sol_amount>
```

Always explain your full reasoning (candidates scored, deep research findings, why winner chosen, deploy amount) before executing any deploy.

**Execution rules:** Run all commands sequentially via Bash, wait for each to complete. Never background. Never parallel.
