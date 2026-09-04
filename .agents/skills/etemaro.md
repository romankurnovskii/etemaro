```markdown
# etemaro — Solana DLMM LP Agent CLI

Data dir: ~/.config/etemaro/

## Commands

### etemaro balance
Returns wallet SOL and token balances.
```
Output: { wallet, sol, sol_usd, usdc, tokens: [{mint, symbol, balance, usd_value}], total_usd }
```

### etemaro positions
Returns all open DLMM positions.
```
Output: { positions: [{position, pool, pair, in_range, age_minutes, ...}], total_positions }
```

### etemaro pnl <position_address>
Returns PnL for a specific position.
```
Output: { pnl_pct, pnl_usd, unclaimed_fee_usd, all_time_fees_usd, current_value_usd, lower_bin, upper_bin, active_bin }
```

### etemaro screen [--dry-run] [--silent]
Runs one AI screening cycle to find and deploy new positions.
```
Output: { done: true, report: "..." }
```

### etemaro manage [--dry-run] [--silent]
Runs one AI management cycle over open positions.
```
Output: { done: true, report: "..." }
```

### etemaro deploy --pool <addr> --amount <sol> [--bins-below 69] [--bins-above 0] [--strategy bid_ask|spot] [--dry-run]
Deploys a new LP position. All safety checks apply.
```
Output: { success, position, pool_name, txs, price_range, bin_step }
```

### etemaro claim --position <addr>
Claims accumulated swap fees for a position.
```
Output: { success, position, txs, base_mint }
```

### etemaro close --position <addr> [--skip-swap] [--dry-run]
Closes a position. Auto-swaps base token to SOL unless --skip-swap.
```
Output: { success, pnl_pct, pnl_usd, txs, base_mint }
```

### etemaro swap --from <mint> --to <mint> --amount <n> [--dry-run]
Swaps tokens via Jupiter. Use "SOL" as mint shorthand.
```
Output: { success, tx, input_amount, output_amount }
```

### etemaro candidates [--limit 5]
Returns top pool candidates fully enriched: pool metrics, token audit, holders, smart wallets, narrative, active bin, pool memory.
```
Output: { candidates: [{name, pool, bin_step, fee_pct, volume, tvl, organic_score, active_bin, smart_wallets, token: {holders, audit, global_fees_sol, ...}, holders, narrative, pool_memory}] }
```

### etemaro study --pool <addr> [--limit 4]
Studies top LPers on a pool. Returns behaviour patterns, hold times, win rates, strategies.
```
Output: { pool, patterns: {top_lper_count, avg_hold_hours, avg_win_rate, ...}, lpers: [{owner, summary, positions}] }
```

### etemaro token-info --query <mint_or_symbol>
Returns token audit, mcap, launchpad, price stats, fee data.
```
Output: { results: [{mint, symbol, mcap, launchpad, audit, stats_1h, global_fees_sol, ...}] }
```

### etemaro token-holders --mint <addr> [--limit 20]
Returns holder distribution, bot %, top holder concentration.
```
Output: { mint, holders, top_10_real_holders_pct, bundlers_pct_in_top_100, global_fees_sol, ... }
```

### etemaro token-narrative --mint <addr>
Returns AI-generated narrative about the token.
```
Output: { mint, narrative }
```

### etemaro pool-detail --pool <addr> [--timeframe 5m]
Returns detailed pool metrics for a specific pool.
```
Output: { pool, name, bin_step, fee_pct, volume, tvl, volatility, ... }
```

### etemaro search-pools --query <name_or_symbol> [--limit 10]
Searches pools by name or token symbol.
```
Output: { pools: [{pool, name, bin_step, fee_pct, tvl, volume, ...}] }
```

### etemaro active-bin --pool <addr>
Returns the current active bin for a pool.
```
Output: { pool, binId, price }
```

### etemaro wallet-positions --wallet <addr>
Returns DLMM positions for any wallet address.
```
Output: { wallet, positions: [...], total_positions }
```

### etemaro config get
Returns the full runtime config.

### etemaro config set <key> <value>
Updates a config key. Parses value as JSON when possible.
```
Valid keys: minTvl, maxTvl, minVolume, maxPositions, deployAmountSol, managementIntervalMin, screeningIntervalMin, managementModel, screeningModel, generalModel, autoSwapAfterClaim, autoSwapRetryAttempts, autoSwapRetryDelayMs, autoSwapInterSwapDelayMs, minClaimAmount, outOfRangeWaitMinutes
```

### etemaro lessons [--limit 50]
Lists all lessons from lessons.json. Shows rule, tags, pinned status, outcome, role.
```
Output: { total, lessons: [{id, rule, tags, outcome, pinned, role, created_at}] }
```

### etemaro lessons add <text>
Adds a manual lesson with outcome=manual, role=null (applies to all roles).
```
Output: { saved: true, rule, outcome, role }
```

### etemaro pool-memory --pool <addr>
Returns deploy history for a specific pool from pool-memory.json.
```
Output: { pool_address, known, name, total_deploys, win_rate, avg_pnl_pct, last_outcome, notes, history }
```

### etemaro evolve
Runs evolveThresholds() over all closed position data and updates user-config.json.
```
Output: { evolved, changes, rationale }
```

### etemaro blacklist add --mint <addr> --reason <text>
Permanently blacklists a token mint so it is never deployed into.
```
Output: { blacklisted, mint, reason }
```

### etemaro blacklist list
Lists all blacklisted token mints with reasons and timestamps.
```
Output: { count, blacklist: [{mint, symbol, reason, addedAt}] }
```

### etemaro performance [--limit 200]
Shows all closed position performance history with summary stats.
```
Output: { summary: { total_positions_closed, total_pnl_usd, avg_pnl_pct, win_rate_pct, total_lessons }, count, positions: [...] }
```

### etemaro start [--dry-run]
Starts the autonomous agent with cron jobs (management + screening).

## Flags
--dry-run     Skip all on-chain transactions
--silent      Suppress Telegram notifications for this run

```

