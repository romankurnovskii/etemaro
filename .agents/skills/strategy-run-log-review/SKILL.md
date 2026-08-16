---
name: strategy-run-log-review
description: Comprehensive log and performance review for data servers and production log directories. Use this skill whenever the user asks to review logs, analyze data server output, inspect trading performance, review data-server-prod, or generate comprehensive outcome reports from log directories.
metadata:
  version: 1.0.0
---

# Data Server Log Review Skill

Perform an exhaustive, multi-dimensional review of data server logs, performance stores, state snapshots, decision logs, and action streams.

## Output Naming & Single File Rule

- **Always Output a Single File:** Save the report as `REVIEW-YYYY-MM-DD.md` directly inside the target directory.
- **Do Not Add Suffixes:** Do NOT append `-COMPREHENSIVE`, `-DETAILED`, `-DRAFT`, or any other suffix to the filename. The file name must strictly be `REVIEW-YYYY-MM-DD.md`.

---

## Target Directory Resolution

When triggered, determine the target log/data directory:

1. **User-Provided Path:** If the user specifies a directory (e.g. `data/data-server-prod` or `/path/to/logs`), use that path.
2. **Default Path:** If no path is explicitly provided, check `./.data`. If `./.data` does not exist, check `./data/data-server-prod` or `./data`.

---

## Review Workflow

### 1. Data Store Discovery & Inventory

Inspect all data stores in the target directory:

- `lessons.json`: Extract total performance records (`performance[]`) and total derived rules (`lessons[]`).
- `state.json`: Count active positions (`positions`) and review `recentEvents`.
- `pool-memory.json`: Count tracked pools and verify outcome ratios (`profit` vs `loss`).
- `decision-log.json`: Inspect screener filter reasons and ring-buffer bounds.
- `logs/actions-*.jsonl`: Parse daily action files to aggregate tool execution counts (`close_position`, `deploy_position`, `rebalance`).
- `logs/agent-*.log`: Parse daily runtime log files for errors, warnings, simulation failures, and API issues.

### 2. Financial & Performance Metrics Audit

Calculate financial metrics with explicit separation of Price PnL and Fees:

- **Price PnL (USD):** `final_value_usd - initial_value_usd`
- **Fees Earned (USD):** `fees_earned_usd`
- **Net Total Return (USD):** `stored pnl_usd` (which equals `Price PnL + Fees Earned`). Note: Do NOT add `fees_earned_usd` to `pnl_usd`, as `pnl_usd` already includes fees!
- Categorize trades for Net Outcome and Price-Only Outcome:
  - **Win:** PnL > +0.1%
  - **Loss:** PnL < -0.1%
  - **Neutral:** -0.1% <= PnL <= +0.1%
- Compute Win Rate %, Loss %, Neutral %.
- Group exit reasons (`pumped far above range`, `take profit`, `Low yield`, `Stop loss`, `Out of range for 30m`).

### 3. Log & Error Incident Forensics

Analyze `agent-*.log` and `actions-*.jsonl`:

- Identify error volume spikes by date.
- Extract Anchor program errors (e.g. Anchor Error 3007 `AccountOwnedByWrongProgram`), RPC errors (Helius 502 Bad Gateway), and API errors (Telegram 429 rate limit).
- Isolate zombie positions (closed on-chain but remaining in state) or infinite cron loop retries.

### 4. Strategy & Signal Execution Review

Evaluate trading strategy effectiveness:

- Compare `bid_ask` vs `spot` vs wide-range strategies.
- Analyze correlations between `volatility`, `organic_score`, `fee_tvl_ratio`, and win rate.
- Check bin range efficiency % across positions.

### 5. Report Generation

Write a comprehensive review markdown report saved as `REVIEW-YYYY-MM-DD.md` inside the target directory following the exact structure in `references/template.md`.

Refer to the reference template:

- [template.md](file:///Users/r/dev/github/etemaro/.agents/skills/data-server-log-review/references/template.md)

---
