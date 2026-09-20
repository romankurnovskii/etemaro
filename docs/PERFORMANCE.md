# Etemaro — Performance & Reliability

> Operational envelope for the Etemaro daemon: latency budget, RPC/cost footprint, memory characteristics, and fault-tolerance mechanisms.
>
> Looking for the flow itself? See [FULL_FLOW.md](FULL_FLOW.md) and [ARCHITECTURE.md](ARCHITECTURE.md). For RPC optimization details (TTL caches, deferred checks, connection manager) see [RPC_AND_API_OPTIMIZATION.md](RPC_AND_API_OPTIMIZATION.md).

---

## 1. Latency Budget

Exit detection is **deterministic and configurable** — it is the product of the polling interval and the confirmation ticks:

```
exit_detection_latency = pollIntervalSec × confirmTicks
```

| Profile | `pollIntervalSec` | `confirmTicks` | Exit detection latency | Typical use |
| :--- | :--- | :--- | :--- | :--- |
| Default | `15s` | `2` | **30s** | Standard pools; filters transient wicks, saves >90% poller CPU/network |
| Fast-dump | `3s` | `2` | **6s** | High-risk meme pools where dumps occur in seconds |
| Aggressive | `3s` | `1` | **3s** | Fastest reaction; highest RPC credit burn |

Other cycle timings:

| Cycle | Default interval | Config |
| :--- | :--- | :--- |
| Management (position evaluation) | 10 min | `managementIntervalMin` / cron |
| Screening (pool discovery + deploy) | 30 min | `screeningIntervalMin` / cron |
| PnL poller (exit signals) | 15 s | `pnl.pollIntervalSec` |
| Opportunity poller (deferred, candidate-gated) | 45 s (min 15 s) | `opportunity.pollIntervalSec` |

> ⚠️ `confirmTicks` protects against single-block liquidity wicks: a signal must repeat on N consecutive ticks before a close is submitted. Lowering it to `1` trades false-exit protection for reaction speed.

---

## 2. RPC & Cost Footprint

State reads are separated from transaction writes. Monitoring uses free REST Datapis; on-chain RPC is reserved for transaction simulation and broadcast.

| Metric | Before optimization | After optimization | Improvement |
| :--- | :--- | :--- | :--- |
| Monthly Helius credits | 1,000,000 – 10,000,000+ | **0** (balance/monitoring) / **< 10,000** (tx simulate + broadcast) | **> 99% savings** |
| Daily external HTTP calls | ~15,000 / agent | ~500 / agent (TTL cache + deferred checks) | **96% reduction** |
| Daemon event-loop latency | High (un-cached HTTP every tick) | Instantaneous (served from memory) | **~10× faster polling cycle** |
| Free-tier feasibility | Exceeds free Helius plan in 2–3 days | Operates indefinitely within free tiers | **100% free-tier sustainable** |

Key design points:

- **Free REST Datapis for monitoring** — positions, range status, and real-time PnL/fees come from Meteora's Datapi (`dlmm.datapi.meteora.ag`); no `getProgramAccounts`.
- **Jupiter for valuation** — token prices/USD via Jupiter Free Price API v2 (`api.jup.ag/price/v2`).
- **RPC exclusivity** — `simulateTransaction`, `sendAndConfirmTransaction`, `getLatestBlockhash` only.
- **Deferred balance checks** — the opportunity poller short-circuits on "max positions reached" or "no candidates" before querying balances.
- **In-memory TTL caches** — e.g. SOL balance check cached 30s (~98% reduction in that call path).

---

## 3. Memory Characteristics

Etemaro is a single long-lived Node.js process per agent (CLI, daemon, or desktop-spawned). Runtime state is held in memory and persisted to small JSON files under `data/`.

| Area | Characteristic |
| :--- | :--- |
| Process model | One daemon process per agent; multi-agent setups isolate via `DATA_DIR` |
| State stores | Small JSON files (`state.json`, `lessons.json`, `pool-memory.json`, `signal-weights.json`, `decision-log.json`, `telegram_queue.json`) |
| Log rotation | Daily files (`data/logs/agent-YYYY-MM-DD.log`, `actions-YYYY-MM-DD.jsonl`) — bounded growth by day |
| Heavy on-chain scans | **Avoided** — no bulk account fetches; monitoring is REST-based and cached |
| Telegram queue | Bounded to `MAX_TELEGRAM_QUEUE = 5`, persisted and drained — cannot grow unbounded |

**Baseline status:** a formal RSS/heap measurement is not yet published. To capture one on your machine:

```bash
# 1. Start the daemon
pnpm run dev          # or: etemaro start --dry-run

# 2. In another shell, sample RSS + heap over 60s
node -e '
const pid = process.argv[1];
let n = 0;
const t = setInterval(() => {
  try { process.kill(pid, 0); } catch { clearInterval(t); process.exit(0); }
  require("node:child_process").exec(`ps -o rss= -p ${pid}`, (e, out) => {
    if (!e) console.log(new Date().toISOString(), "RSS_KB=" + out.trim(), "sample=" + (++n));
  });
}, 1000);
setTimeout(() => clearInterval(t), 60000);
' "$(pgrep -f 'etemaro start' | head -1)"
```

Record the p50/p99 RSS across samples in this table once measured:

| Metric | p50 | p95 | p99 | Notes |
| :--- | :--- | :--- | :--- | :--- |
| Daemon RSS | _TBD_ | _TBD_ | _TBD_ | Single agent, dry-run |
| Heap used | _TBD_ | _TBD_ | _TBD_ | `process.memoryUsage().heapUsed` |
| Exit-detection wall time | 30s (model) | — | — | `pollIntervalSec × confirmTicks` |

---

## 4. Fault Tolerance

The agent is designed to survive provider errors, transient RPC failures, and restarts without duplicate or unsafe execution.

### Execution safety

| Mechanism | Behavior |
| :--- | :--- |
| **Once-per-session lock** | `deploy_position`, `close_position`, `swap_token` fire at most once per cycle |
| **No-retry lock** | `deploy_position` is locked after the first attempt regardless of outcome (no double-deploy) |
| **Pre-deploy on-chain re-check** | Pool metrics are re-validated immediately before submitting a deploy |
| **Dry-run interception** | Deploy/claim/close return mock objects; no transaction is broadcast |

### Provider & RPC resilience

| Mechanism | Behavior |
| :--- | :--- |
| **RPC fallback** | Centralized connection manager keeps a primary and a fallback (`rpcUrl` / `rpcUrl2`) connection |
| **LLM provider fallback** | Falls back to `stepfun/step-3.5-flash:free` on provider errors |
| **System-role fallback** | Embeds the system prompt in the user message if a provider rejects `role: system` |
| **Tool-choice fallback** | Retries without `tool_choice: required` if the provider rejects it |
| **JSON repair** | Malformed tool arguments auto-repaired via `jsonrepair` |
| **Rate-limit handling** | Waits 30s and retries on HTTP 429 |
| **Tool-required enforcement** | Rejects answer-only responses for action intents (up to 2 retries) |

### Concurrency & restart safety

| Mechanism | Behavior |
| :--- | :--- |
| **Single-flight mutex guards** | Autonomous cycles skip a tick if the previous cycle is still running (management/screening/PnL/opportunity) |
| **Bounded Telegram queue** | One FIFO queue per agent, max 5, persisted to disk and drained sequentially |
| **Restart safety filter** | On restart only read-only commands are restored; mutating commands (`/close`, `/deploy`, `/set`, `/pause`, `/resume`, free chat) are discarded |
| **Fail-fast config** | Missing required env var aborts boot with a precise error instead of running half-configured |
| **Keystore enforcement** | Wallet files auto-tightened to `0600`; FATAL if permissions cannot be set |

---

## 5. Reproducing These Numbers

```bash
# Tests + lint + architecture boundaries (same gates as CI)
pnpm run build && pnpm run lint && pnpm run lint:boundaries && pnpm run test

# Inspect runtime logs and structured audit trail
tail -f data/logs/agent-$(date +%F).log
tail -f data/logs/actions-$(date +%F).jsonl
```

CI runs the full gate on every PR via [`.github/workflows/on-pr.yml`](../.github/workflows/on-pr.yml).
