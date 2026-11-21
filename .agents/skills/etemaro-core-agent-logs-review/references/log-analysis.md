# Reference: Reading the Etemaro Core-Agent Logs

**Read this before any incident, liveness or performance analysis.** It is the
analysis companion to `data-stores.md` (the field-name authority) and to
`scripts/_dialects.py` (the executable reader). Every number below was measured
on this repo's own data, not copied from another project.

Reference measurement — `data/remote-server/data/instances/agent-config.smart-wallet-follow.v260922-003`,
2026-09-22 → 2026-09-27 (18 files, 25,983 lines, agent `agt_260922v1`):

```
coverage: files=18 total_lines=25983 parsed=25746 continuations=169 skipped=0
          dialects={coreagent_runtime: 6, coreagent_actions: 6, coreagent_structured: 6}
```

## Hard rule

Read logs **only** through `scripts/_dialects.py`. Never hand-write a
`python3 -c` one-liner and never raw-grep a log file. The three streams are
mutually incompatible, and reading the wrong one with the right probe fails
**silently** — a swallowed `json.loads` plus a `"ts"` regex returning `None`
produces an empty result indistinguishable from "nothing happened".

```python
import sys
sys.path.insert(0, '<skill>/scripts')
from _dialects import (coverage, iter_events, ts_key, component_census,
                       structured_categories, structured_errors, failed_actions,
                       action_calls, cron_cycles, agent_ids)

coverage(instance_dir)            # ALWAYS look at this first
for ev in iter_events(instance_dir, window=(frm, to)):
    ...  # ev.ts, ev.dialect, ev.component, ev.agent_id, ev.msg, ev.fields, ev.continuation
```

Run `coverage()` first, always. `parsed: 0` with `total_lines > 0` means
ingestion is broken — not that the agent was idle. Say so rather than reporting
"no activity".

## The three dialects

| Dialect | Path | Shape | Gives you |
| --- | --- | --- | --- |
| `coreagent_runtime` | `logs/agent-<agentId>-<date>.log` | text `[ts] [component] [agentId] msg` | operational narrative, cycle cadence |
| `coreagent_actions` | `logs/actions-<agentId>-<date>.jsonl` | JSONL `{ts,agentId,dryRun,tool,args,result,success?}` | per-tool audit trail |
| `coreagent_structured` | `logs/structured-<agentId>-<date>.jsonl` | JSONL `{ts,category,agentId,dryRun,message,correlationId,metadata}` | **where the errors are** |
| `jsonl_unclassified` | anywhere | JSONL with `ts`, unknown signature | an unhandled dialect — a gap to close, not data to use |

### Where the errors actually are

**A forensics pass that greps `agent-*.log` for errors finds nothing and
falsely concludes the run was clean.** The text log's bracket is a *component
tag*, not a severity level — there is no severity field at all.

On the reference instance the only error signal outside the JSONL streams was
zero. Errors live here:

- `structured-*.jsonl` → `category` in `api_error` / `swap_error` / `tx_error`
  (observed: 6 / 7 / 1, i.e. 14 total).
- `actions-*.jsonl` → `success: false` (observed: **0** on this instance — the
  key is often absent entirely, so only an explicit `false` is a failure).

Always run both. Report "no errors" only after `structured_errors()` and
`failed_actions()` both come back empty.

### Component census (`agent-*.log`)

Observed frequency on the reference instance:

`cron` 11,219 · `positions` 9,311 · `state` 1,183 · `deploy` 621 · `close` 595 ·
`agent` 192 · `swap` 178 · `pool-metrics` 136 · `lessons` 109 · `executor` 93

`cron` and `positions` alone are ~79% of the file. Never read these logs
linearly.

### Structured categories (`structured-*.jsonl`)

Observed frequency:

`tx_state` 380 · `swap_start` 92 · `swap_finish` 85 · `tool_start` 47 ·
`tool_finish` 47 · `agent_loop_start` 41 · `agent_loop_end` 41 ·
`swap_error` 7 · `api_error` 6 · `anti_hallucination_reject` 3 · `tx_error` 1

`agent_loop_start` carries `metadata.goal` with the **resolved screening
prompt** — use it to confirm what the agent was actually configured to do,
rather than trusting the config file alone.

## Liveness — cluster before you measure

`cron` emits **many lines per cycle**, so consecutive-cron gaps are meaningless:
the raw median gap on the reference instance is **0.4 s** while the configured
management interval is **3 min**. Cluster first, then measure.

```python
starts, gaps_min = cron_cycles(instance_dir, gap_seconds=30)
```

| Merge window | Cycles found | Median gap | Max gap |
| --- | --- | --- | --- |
| 30 s | 3,663 | 2.0 min | 6.0 min |
| 60 s | 3,078 | 2.7 min | 6.0 min |
| 120 s | 1,995 | 3.9 min | 12.0 min |

30 s is the default and matches a `managementIntervalMin: 3` config: median
2.0 min against a 3 min interval, with **0 stalls** beyond 2.5× (7.5 min).

A stall is a cycle gap far beyond the configured interval while the process is
still alive. Correlate every stall against `structured-*.jsonl` timestamps:
a stall with `api_error` next to it is upstream; a stall with nothing next to it
is a hang.

## Tool-call counting trap (summary/detail pairs)

`actions-*.jsonl` logs some tools **twice under two spellings**, and they are
**not** interchangeable aliases. On the reference instance:

| Tool spelling | Distinct timestamps | Role |
| --- | --- | --- |
| `sweepUnsoldTokens` | 425 | summary (`result.total/skipped/successful/failed/abandoned`) |
| `sweep_unsold_tokens` | 425 | per-token detail (`result.results[]` with `mint`/`symbol`/`reason`) |

Shared timestamps: **246**. Union: **604 distinct invocations**.

Counting either spelling alone undercounts by ~30% (425/604); summing both
double-counts by ~29% (850/604). Use `action_calls()` → `distinct_by_tool`
(distinct timestamps), and use the snake_case record when you need per-token
detail. The renderer prints this correction automatically.

## Cross-checks that catch silent errors

- **Settlement.** `closed_pending_swap` rows are **not** closed cash. On the
  reference instance 71 of 119 trades were `closed_pending_swap`, carrying
  **+296.83 USD** of unrealized residual against a +21.20 USD headline — while
  realized-only net was **−2.65 USD**. Quote the split, never the headline alone.
  Confirm the residual actually swapped by checking `swap_finish` / `tx_state`
  in `structured-*.jsonl`, and cross-check `state.pendingLiquidations`.
  `abandoned_loss` counts as a loss.
- **Accounting.** `net_pnl_usd = price_pnl_usd + fees_earned_usd`, persisted
  **rounded to cents**. Compare with a 0.011 USD tolerance; anything larger is a
  real data-quality break.
- **Config.** `schedule.managementIntervalMin` is what the liveness numbers are
  measured against; `risk.maxPositions` is what deploy counts are checked
  against. Read the config, do not assume defaults.
- **Smart-wallet runs.** See `smart-wallets-verification.md`. The
  `metadata.goal` on `agent_loop_start` shows the resolved prompt actually used.

## Coverage statement (required in every report)

Report `log_coverage`: files, total lines, parsed, continuations, skipped,
dialects. It is what makes "the agent was quiet" provable instead of assumed.
`coreagent_runtime` files are always 1:1 with distinct days — a count of 6 means
six daily text logs, not six events.
