---
name: etemaro-core-agent-logs-review
description: Review the Etemaro core agent's run directory (packages/core — state.json, lessons.json, decision-log.json, logs/agent-*.log, logs/actions-*.jsonl, logs/structured-*.jsonl) and deliver a self-contained HTML performance, strategy and stability report. Use whenever the user asks to review, analyse, audit or report on an Etemaro agent run or an instance under data/instances/ or data/remote-server/data/instances/ — "review the agent logs", "how did agent X perform", "why did the agent lose money", "analyse the run", "check for errors in the agent logs", "make a report from the data dir", "pull the logs and analyse them", "review remote-server". Also triggers on a handed-over agent data directory, on questions about settlement status, win rate, exit reasons, liveness or smart-wallet gate integrity, and when only the words "agent", "instance" or "run" plus a directory are given. Does NOT cover the copy-trader CLI bot — that is etemaro-copy-trader-logs-review.
metadata:
  version: 1.0.0
---

# Etemaro Core-Agent Run Review → HTML Report

Produce an exhaustive review of an Etemaro **core agent** run and deliver a
self-contained HTML report (inline CSS, email-safe) that mirrors
`references/report-template.html`.

Scope is deliberately narrow: this skill reads **only** the core-agent family
written by `packages/core`. The copy-trader CLI bot
(`apps/bot-copy-trader`, streams `copytrader_runtime` / `copytrader_wallet`) is a
different family with different dialects — use
`etemaro-copy-trader-logs-review` for it. Reading one family's log with the
other's probe fails **silently** and yields an empty report.

## The one rule that matters most

**Errors are not in `agent-*.log`.** The text log's bracket is a *component tag,
not a severity level*; it carries essentially no error signal. Errors live in
`structured-*.jsonl` (`api_error` / `swap_error` / `tx_error`) and
`actions-*.jsonl` (`success: false`). A forensics pass that greps the text log
finds nothing and falsely reports a clean run.

Read every stream through `scripts/_dialects.py`. Never hand-write a
`python3 -c` one-liner over a log file and never raw-grep one.

```python
from _dialects import coverage, iter_events, cron_cycles, action_calls
coverage(instance_dir)                      # ALWAYS first
for ev in iter_events(instance_dir, window=(frm, to)):
    ...  # ev.ts, ev.dialect, ev.component, ev.agent_id, ev.msg, ev.fields
```

`parsed: 0` with `total_lines > 0` is a **broken ingestion, not a quiet run** —
report it as such. Every report must state its coverage (files, lines, parsed,
continuations, skipped, dialects).

## Pipeline

Run the steps in order. Every tool writes a run log to
`scripts/.logs/<tool>_<UTC stamp>.log` (gitignored; stdout stays the
agent-facing contract).

```bash
cd <skill>/scripts

# 1 — discover instances, stores, log coverage, suggested window
python3 01_inventory.py [<target-dir>]            # -> <target>/reports/inventory.json

# 2 — financial metrics from the closed-trade ledger
python3 02_performance.py <target-dir> [--from ISO --to ISO]
                                                  # -> <target>/reports/02-performance.json

# 3 — incident, liveness and telemetry forensics
python3 03_incidents.py <target-dir> [--from ISO --to ISO] [--cycle-gap 30]
                                                  # -> <target>/reports/03-incidents.json

# 4 — render the HTML report
python3 04_render_report.py <target-dir> [--from ISO --to ISO] [--only-instance ID]
                                                  # -> <target>/reports/REPORT-<tag>.html
```

With no argument, `01_inventory.py` searches `./.data` →
`./data/remote-server/data/instances` → `./data/instances`, and treats a
directory of instances as a dataset root. Instance ids look like
`agent-config.smart-wallet-follow.v260922-003`; the `agentId` inside the logs is
different (e.g. `agt_260922v1`) — the report shows both.

### Smart-wallet runs (optional step, required when applicable)

Required whenever the config has `screening.entrySource == "smart_wallets"`, a
strategy-library `smartWalletListId`, or `opportunity.smartWalletScoreBonus > 0`:

```bash
python3 fetch-smart-wallet-positions.py <target-dir> [--report-date YYYY-MM-DD]
# -> <target>/reports/REPORT-<date>.smart-wallets.json  (picked up by step 4)
```

Recipes and the per-position veto forensic workflow: `references/smart-wallets-verification.md`.

## What each step must establish

| Step | Must establish |
| --- | --- |
| 1 | Instance id, `agentId`(s), which stores exist, log coverage, and the review window |
| 2 | The **settlement split by `status`**, realized vs pending cash, win/loss, daily breakdown, exit-reason families, best/worst trades |
| 3 | Classified errors with counts, liveness (clustered cycles vs configured interval), tool-volume dedup, coverage warnings |
| 4 | The nine report sections plus the rule-generated Recommendations block |

## Reporting standards

- **Split settlement before aggregating.** `closed_pending_swap` rows are not
  realized cash. On the reference instance 71 of 119 trades were pending,
  carrying **+296.83 USD** of unrealized residual against a **+21.20 USD**
  headline, while realized-only net was **−2.65 USD**. Quote the split, never the
  headline alone.
- **Accounting tolerance.** `net_pnl_usd = price_pnl_usd + fees_earned_usd`,
  persisted rounded to cents. Compare with a 0.011 USD tolerance; flag anything
  larger as a data-quality finding.
- **Cluster cron before measuring liveness.** `cron` emits many lines per cycle;
  raw consecutive gaps are ~0.4 s while the configured interval is 3 min. Use
  `cron_cycles()` and report stalls only against the configured interval.
- **Deduplicate tool volume by timestamp.** `sweepUnsoldTokens` and
  `sweep_unsold_tokens` log the same invocations twice: 425 + 425 records for
  **604** distinct calls. Never count a single spelling.
- **Recommendations are rule-generated.** Section 9 is emitted mechanically by
  `04_render_report.py`; every bullet cites an observed count. Do not invent a
  recommendation that has no number behind it.
- **Separate signal from noise.** Say which apparent problems are real incidents
  vs expected behaviour (e.g. `anti_hallucination_reject` is a guardrail working).
- **Don't fabricate.** If a store or dimension is absent, write "Not present in
  this run directory" and keep the section header.
- **Never print secrets.** Render any `*Key` / `*Token` / `*Secret` as `***`, keep
  `env.*` references literal, and never open `.env*`, `*.prod` or
  `.credentials/*`.
- **Attribute a deploy cause from the record, never from the failure's shape.**
  `[deploy] … is on cooldown — skipping` is a **local guard short-circuit**: the
  venue was never contacted and no order was submitted. It is *not* a network
  failure, and `[cron_error] … Deploy failed` does not imply an RPC problem. Take
  every cause from `03-incidents.json` → `deploys.causes`; and only ever write
  "RPC timeout" / "network failure" when `deploys.timeout_by_component` shows a
  timeout token on a deploy record. A report that said *"8 occurrences of
  undefined deploy response on RPC timeout"* about 8 cooldown short-circuits is
  the exact failure this rule exists to prevent — the count was right, the cause
  was invented, and `grep -icE "timeout|timed out"` over the window returned 0.
- **Retry counts come from persisted state, never from the configured budget.**
  Read `state.json` → `pendingLiquidations[].attempts` and the
  `Liquidation abandoned for … (immediately | after N attempts)` line. Quote those.
  `management.sweeperMaxAttempts` is a **budget** (default 10); reporting it as the
  observed retry count is how *"marked dead after 3 retries"* was written about a
  record holding `attempts: 1` and a log line reading *"abandoning immediately
  without further retries"*.
- **An empty deploy address is a logging artefact, not a failed deploy.**
  `Deployed  on <pair>` (`deploys.empty_address_logs`) coexists with `SUCCESS — N
  tx(s)` and is a caller-side bug, not a transient error.

## Output

- **Report:** `<target>/reports/REPORT-<tag>.html` — one file, one section per
  instance. `tag` = `<YYYY-MM-DD>-<HH>-<HH>` (UTC start/end hours) or
  `<date>-<HH>-<date>-<HH>` when the window crosses midnight.
- **Companions:** `inventory.json`, `02-performance.json`, `03-incidents.json`,
  plus `REPORT-<date>.smart-wallets.json` when step 5 ran.
- The HTML must be fully self-contained: all CSS inline, no external assets, no
  `https://` references. When done, tell the user the absolute path and offer to
  email the HTML.

## References

- `references/log-analysis.md` — **read before any incident or liveness work**:
  the three dialects, measured component/category census, the liveness clustering
  recipe, the tool-counting trap, and where the errors actually are.
- `references/data-stores.md` — the store/field authority: `lessons.json`
  `performance[]`, `state.json`, `decision-log.json`, `signal-weights.json`,
  `pool-memory.json`, `hivemind-cache.json`, and the log field names.
- `references/agent-config-strategy-analysis.md` — config model, redaction rule,
  the expected-behavior matrix, and the config-vs-strategy consistency checks.
- `references/smart-wallets-verification.md` — live wallet verification
  (api.etemaro → Meteora Datapi fallback), the gate/timing/liveness verdicts, and
  per-position veto forensics.
- `references/report-template.html` — the exact HTML to mirror (sections 1–9).
- `references/smart-wallets-analysis.template.json` — the saved smart-wallet JSON
  schema.

## Scripts

| Script | Role |
| --- | --- |
| `scripts/01_inventory.py` | instance discovery, store + log inventory, suggested window |
| `scripts/02_performance.py` | closed-trade ledger metrics, settlement split, exit families |
| `scripts/03_incidents.py` | structured/action error forensics, liveness, tool dedup |
| `scripts/04_render_report.py` | renders the nine-section HTML + Recommendations block |
| `scripts/fetch-smart-wallet-positions.py` | live smart-wallet verification JSON |
| `scripts/_dialects.py` | **the single log reader** — 3 core-agent dialects + `jsonl_unclassified` |
| `scripts/_logger.py` | timestamped run logs under `scripts/.logs/` |

Numbering (not `tool.vN.py` symlinks) is deliberate: each tool is standalone and
the numbers are cited across this skill — keep them stable. Extend
`_dialects.py` when a new log dialect appears; never add parsing to the numbered
tools.
