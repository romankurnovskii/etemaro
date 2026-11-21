# How to Use: Etemaro Core-Agent Run Review

## What this does

Reviews an Etemaro **core agent** run (`packages/core`) and produces a
self-contained, email-ready HTML report: performance and settlement, exit
reasons, strategy correlations, incident forensics and liveness, smart-wallet
gate verification, and a rule-generated Recommendations block.

Not for the copy-trader CLI bot — use `etemaro-copy-trader-logs-review`.

## When to use

- "review the agent logs", "how did agent X perform", "why did the agent lose money",
  "analyse the run", "check for errors in the agent logs", "make a report from the data dir".
- Any directory containing `state.json` / `lessons.json` / `decision-log.json` /
  `logs/agent-*.log`.

## The one thing to remember

**Errors are not in `agent-*.log`.** Its bracket is a component tag, not a
severity. Errors live in `structured-*.jsonl` (`api_error` / `swap_error` /
`tx_error`) and `actions-*.jsonl` (`success: false`). Grepping the text log finds
nothing and falsely reports a clean run.

Never hand-write a `python3 -c` one-liner over a log file — the three streams are
different and reading the wrong one fails silently:

```python
from _dialects import coverage, iter_events, cron_cycles
coverage(instance_dir)   # ALWAYS first — parsed:0 with lines>0 means broken ingestion
```

## Run the pipeline

```bash
cd <skill>/scripts

python3 01_inventory.py [<target-dir>]        # stores, log coverage, suggested window
python3 02_performance.py <target-dir> [--from ISO --to ISO]
python3 03_incidents.py   <target-dir> [--from ISO --to ISO] [--cycle-gap 30]
python3 04_render_report.py <target-dir> [--from ISO --to ISO] [--only-instance ID]

# optional, required for smart-wallet-driven runs (picked up automatically by step 4)
python3 fetch-smart-wallet-positions.py <target-dir>
```

With no argument, step 1 searches `./.data` → `./data/remote-server/data/instances`
→ `./data/instances`, treating a directory of instances as a dataset root.

## Three numbers that decide the verdict

1. **Settlement split.** `closed_pending_swap` is not realized cash. On the
   reference run: 71 pending of 119 trades, +296.83 USD unrealized residual
   against a +21.20 USD headline, while realized-only net was **−2.65 USD**.
   Report the split, never the headline alone.
2. **Accounting tolerance.** `net_pnl_usd = price_pnl_usd + fees_earned_usd`
   rounded to cents — flag only drift > 0.011 USD.
3. **Tool dedup.** `sweepUnsoldTokens` and `sweep_unsold_tokens` log the same
   invocations twice (425 + 425 records, **604** distinct). Count distinct
   timestamps, never one spelling.

## Liveness

`cron` emits many lines per cycle, so raw consecutive gaps are ~0.4 s while the
configured interval is 3 min. Cluster first, then compare to
`schedule.managementIntervalMin`:

```python
starts, gaps_min = cron_cycles(instance_dir, gap_seconds=30)
```

## Outputs

```
<target>/reports/
├── REPORT-<YYYY-MM-DD>-<HH>-<HH>.html     # the report (self-contained, inline CSS)
├── inventory.json  02-performance.json  03-incidents.json
└── REPORT-<date>.smart-wallets.json        # optional smart-wallet verification
```

Tell the user the absolute path and offer to email the HTML.

## Run logs

Each script appends `scripts/.logs/<tool>_<UTC stamp>.log` (gitignored). Console
stays at WARNING so stdout summaries remain the agent-facing contract.

## Tips

- Keep every section header even when data is missing; write "Not present in this
  run directory".
- `anti_hallucination_reject` in `structured-*.jsonl` is a guardrail working, not
  an incident.
- Never print secrets — mask any `*Key` / `*Token` / `*Secret`, and never open
  `.env*`, `*.prod` or `.credentials/*`.
