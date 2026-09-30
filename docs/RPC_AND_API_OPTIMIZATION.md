# Solana RPC & API Optimization Guide

## Executive Summary

Continuous autonomous LP trading requires regular state synchronization: wallet balance checks, position tracking, PnL evaluation, screening, and transaction execution. When these read loops query paid RPC endpoints or metered REST APIs (such as the Helius Wallet API `/v1/wallet/.../balances`, billed at **100 credits per request**, or on-chain `getProgramAccounts`) without caching, API credit consumption explodes.

Running an agent that polls every 15–45 seconds can consume **1,000,000+ Helius credits in a few days**, even with very few actual trades executed.

This guide details:
1. **Root cause analysis** of RPC and API credit consumption in Etemaro.
2. **The Strict Decision Matrix**: When on-chain RPC calls are strictly required vs. when they can be replaced by free, stable REST APIs or cached.
3. **Available stable alternatives** (Meteora REST Datapi, Jupiter Free Price & Token APIs, standard Solana RPC + in-memory cache).
4. **Architecture and implementation roadmap** to reduce RPC credit consumption by >95%.

---

## 1. Credit Consumption Audit & Root Cause Analysis

### 1.1 The Uncached Balance Polling Problem
In `packages/core/src/adapters/blockchain/WalletAdapter.ts:getWalletBalances()`, wallet balances (SOL, USDC, and SPL tokens with USD valuation) are fetched via the Helius Wallet API (beta):
```text
https://api.helius.xyz/v1/wallet/${walletAddress}/balances?api-key=${HELIUS_API_KEY}
```

#### Calling Frequency Analysis (per single agent instance):
- **Opportunity Poller** (`Daemon.ts:627`): Polls every `pollIntervalSec` (default **45s**, min **15s**) -> **~1,920 – 5,760 calls/day**.
- **Position Management Cycle** (`Daemon.ts:709`): Runs every **60s** -> **~1,440 calls/day**.
- **Screening Cycle** (`Daemon.ts:1047`): Runs every **5m** -> **~288 calls/day**.
- **Agent ReAct Loop** (`agent-loop.ts`): Builds system prompt with live balances on each screening/management turn.
- **Telegram Commands** (`/status`, `/balance`, `/briefing`): On-demand invocations.
- **Multi-Agent Setup**: Running 3–5 agents in PM2 or Desktop multiplies this by 3x–5x.

#### Total API Requests:
A standard 3-agent setup makes **~10,000 to 25,000 calls per day**. Over 30 days, that is **300,000 to 750,000 HTTP requests**.
Because the Helius Wallet API `balances` endpoint is billed at **100 credits per request** (versus 1 credit for a standard RPC call), a 3-agent setup making ~10,000–25,000 calls/day would burn **1–2.5 million Helius credits per day** with zero trade volume. That is the cost this guide exists to avoid: the default `meteora_api` PnL source and the cached/deferred balance paths below mean those calls are not made at all, and the Wallet API is only reached as a conditional fallback.

### 1.2 The Two PnL Source Options (`meteora_api` vs `rpc`)
Etemaro supports two explicit PnL tracking and position valuation modes under `config.pnl.source`:

1. **`meteora_api` (Default & Recommended)**:
   - Queries the official Meteora REST Datapi (`https://dlmm.datapi.meteora.ag/portfolio/open` and `/positions/{poolAddress}/pnl?user={walletAddress}&status=open|closed`).
   - **Cost**: **0 Solana RPC credits** (100% free).
   - **Latency**: ~5–15s indexing lag behind real-time blocks.
   - **Resilience**: Automatically falls back to on-chain RPC computation if Meteora REST API experiences a network outage.

2. **`rpc` (High-Precision / Volatile Pool Mode)**:
   - Invokes `DLMM.getAllLbPairPositionsByUser()` directly on-chain via `getProgramAccounts` on the Meteora DLMM program (`LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo`).
   - **Cost**: **100+ Helius credits per call** (~2,880,000 credits/day on 3s polling).
   - **Latency**: Sub-second real-time on-chain precision.
   - **Use Case**: Strictly reserved for high-risk, ultra-volatile meme pools where every second counts for stop-loss execution and the operator can afford elevated RPC credit consumption.

---

## 2. Strict Decision Matrix: When RPC is Required vs. When It Can Be Avoided

| Operation | Current Method | Is On-Chain RPC Strictly Required? | Free / Low-Cost Alternative | Savings |
| :--- | :--- | :--- | :--- | :--- |
| **SOL Balance Check** (Gas & Deploy check) | Helius `/v1/wallet/.../balances` | ❌ **NO** (Only needed when preparing to submit a tx) | In-memory TTL Cache (30s) + Standard RPC `connection.getBalance()` or Jupiter API | **98% reduction in calls** |
| **SPL Token Balances & USD Value** | Helius `/v1/wallet/.../balances` | ❌ **NO** | Standard RPC `getParsedTokenAccountsByOwner` + Jupiter Price API v2 (`api.jup.ag/price/v2`) | **Eliminates Helius Enhanced API credits** |
| **Meteora DLMM Open Positions** | DLMM SDK via RPC (`getProgramAccounts`) | ❌ **NO** | **Meteora REST Datapi** (`https://dlmm.datapi.meteora.ag/portfolio/open?user=...`) | **100% Free** (Zero RPC credits) |
| **Meteora Position PnL & Fees** | DLMM SDK on-chain bin simulation | ❌ **NO** | **Meteora PnL API** (`https://dlmm.datapi.meteora.ag/pool/{poolAddress}/pnl/{user}`) | **100% Free** (Zero RPC credits) |
| **Token Safety / Anti-Rug / Holders** | RPC parsed token accounts | ❌ **NO** | Jupiter Search API (`datapi.jup.ag`), GMGN API, RugCheck API | **100% Free** |
| **Price Chart Indicators (EMA, RSI, ATR)** | RPC historical blocks | ❌ **NO** | DexScreener / GeckoTerminal / Birdeye public APIs | **100% Free** |
| **Tx Pre-Flight Simulation** | `simulateTransaction` | ✅ **YES** (Must test actual node state) | Standard RPC (Helius / Dedicated RPC) immediately before broadcast | Essential (Keep) |
| **Tx Broadcast (Deploy, Close, Claim)** | `sendAndConfirmTransaction` / Jito Relay | ✅ **YES** (Must reach block engine / validators) | Helius Staked RPC or Jito Block Engine bundle | Essential (Keep) |
| **Recent Blockhash** | `getLatestBlockhash` | ✅ **YES** (Required to sign transactions) | Standard RPC immediately before signing | Essential (Keep) |

---

## 3. Available Stable & Free Alternatives

### 3.1 Meteora REST Datapi (100% Free, Official)
Meteora provides a dedicated, highly reliable, low-latency REST API indexed directly from Solana blocks:

1. **Open Positions & Range Status**:
   ```http
   GET https://dlmm.datapi.meteora.ag/portfolio/open?user={walletAddress}&page={page}&page_size=50
   ```
   *Returns*: Active pools, list of position addresses, out-of-range flags (`outOfRange`, `positionsOutOfRange`), token mints, bin dimensions, plus `hasNext`, `total`/`totalCount` and `totalPositions`.
   *Pagination*: `page_size` defaults to **20** (maximum 50) and the parameter is **snake_case** — `pageSize` is silently ignored. Follow `hasNext` and cross-check the assembled position count against `totalPositions`.

2. **Real-time Position PnL & Unclaimed Fees**:
   ```http
   GET https://dlmm.datapi.meteora.ag/positions/{poolAddress}/pnl?user={walletAddress}&status={open|closed}&page={page}&page_size=100
   ```
   *Returns*: Exact lower/upper/active bins, unclaimed fees in both tokens (and USD/SOL converted), realized PnL, unrealized PnL, total yield percentage. Same pagination rules as above (`page_size` default **20**).
   *Note*: the closed-position list is sorted most-recent-first, so a just-closed position appears on page 1 — this is why the close path polls page 1 rather than walking pages.

3. **Pool Candidate Metrics & Discovery**:
   ```http
   GET https://dlmm.datapi.meteora.ag/pools/{poolAddress}
   GET https://dlmm.datapi.meteora.ag/pools?page_size=100&timeframe=5m&sort_by=tvl:desc
   GET https://pool-discovery-api.datapi.meteora.ag/pools   # undocumented — see below
   ```

   **Undocumented dependency:** `pool-discovery-api.datapi.meteora.ag` is **not** part of the published DLMM Data API (it appears in neither the docs index nor the OpenAPI spec) and its schema differs from the documented `/pools` — it alone exposes `organic_score`, `pvp_rival_holders` and `active_tvl`, while the documented endpoint uses `address` (not `pool_address`), `token_x.holders` and `pool_config.bin_step`. Treat it as an unversioned internal API: it can change without notice, so it is isolated in `ScreeningAdapter` / `deploySafety` and worth revisiting deliberately rather than opportunistically. Listed as a known risk in §7.4.

*Rate limit*: **30 requests/second** across the DLMM Data API (documented), with no API key requirement. Our observed 429s on 2026-09-30 were not quota-driven — the instance made ~197 portfolio calls for the whole day — so they are treated as transient and retried with backoff.
*Environments*: production `https://dlmm.datapi.meteora.ag`, development `https://dlmm.dev.metdev.io`, both with a Swagger UI.
*Reliability*: Hosted directly on Cloudflare and Meteora's dedicated indexing infrastructure, with no API key requirement.

---

### 3.2 Jupiter Free APIs (100% Free, High Rate Limits)
Jupiter provides free public developer APIs that eliminate the need for paid token pricing or balance valuation services:

1. **Jupiter Price API v2**:
   ```http
   GET https://api.jup.ag/price/v2?ids=So11111111111111111111111111111111111111112,EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
   ```
   *Returns*: Real-time USD prices for SOL, USDC, and any SPL token mint with liquidity on Solana.

2. **Jupiter Token List API**:
   ```http
   GET https://tokens.jup.ag/token/{mint}
   GET https://tokens.jup.ag/tokens?tags=verified
   ```
   *Returns*: Decimals, token symbol, name, and verification status without calling `getParsedAccountInfo` on Solana RPC.

3. **Jupiter Ultra Swap V2**:
   ```http
   GET https://api.jup.ag/swap/v2/order?...
   POST https://api.jup.ag/swap/v2/execute
   ```
   *Returns*: Unsigned transaction orders and managed transaction broadcast.

---

### 3.3 Solana Standard RPC + Multi-Tier Fallback Strategy

Instead of routing simple read queries through expensive Helius Enhanced APIs:

1. **Standard `connection.getBalance(pubkey)`**:
   - Costs only 1 credit on RPC providers or 0 cost on free RPCs (e.g. Triton, QuickNode free tier, Alchemy free tier, Ankr).
2. **In-Memory TTL Caching (30s – 60s)**:
   - For background daemon loops (Opportunity Poller, Management loop), return the cached balance if the last fetch was within the TTL.
3. **Transaction-Driven Cache Invalidation**:
   - Automatically bust the balance cache when a transaction is executed (`deployPosition`, `closePosition`, `swapToken`, `claimFees`).
4. **Multi-Tier Endpoint Routing & Fallback (`RPC_URL_2` / `connection.rpcUrl2`)**:
   - **Primary (`RPC_URL` / `connection.rpcUrl`)**: Fast premium/staked RPC (e.g. Helius) for simulation and execution.
   - **Fallback (`RPC_URL_2` / `connection.rpcUrl2`)**: Secondary RPC (e.g. Ankr, QuickNode, Triton, or public Solana RPC) used automatically on 429 rate-limits or transient node errors.

---

## 4. Implementation Blueprint

### 4.1 Wallet Balance Caching & RPC Fallback in `WalletAdapter.ts`
```typescript
interface CachedBalances {
  data: WalletBalancesResult;
  timestamp: number;
}

let _balanceCache: CachedBalances | null = null;
const BALANCE_CACHE_TTL_MS = 30_000; // 30 seconds

export function invalidateBalanceCache(): void {
  _balanceCache = null;
}

export async function getWalletBalances(options?: { force?: boolean }): Promise<WalletBalancesResult> {
  if (!options?.force && _balanceCache && Date.now() - _balanceCache.timestamp < BALANCE_CACHE_TTL_MS) {
    return _balanceCache.data;
  }

  // 1. Fetch native SOL balance via standard RPC (1 credit)
  // 2. Fetch SPL token accounts via getParsedTokenAccountsByOwner (1 credit)
  // 3. Fetch token prices via Jupiter Price API v2 (0 credits / free)
  // 4. Update cache and return
}
```

### 4.2 Caching Enforcement in `Daemon.ts`
In `Daemon.ts:631` (Opportunity Poller):
```typescript
// BEFORE:
this.adapters.meteora.getMyPositions({ force: true, silent: true })
this.adapters.wallet.getWalletBalances() // Uncached Helius fetch every 45s

// AFTER:
this.adapters.meteora.getMyPositions({ silent: true }) // Uses 30s TTL cache
this.adapters.wallet.getWalletBalances({ force: false }) // Uses 30s TTL cache
```

### 4.3 PnL Polling Cadence & Risk Trade-Off (`pollIntervalSec` & `confirmTicks`)
In `config/agent-config.json` and template:
```json
"pnl": {
  "source": "meteora_api",
  "rpcUrl": "env.PNL_RPC_URL",
  "pollIntervalSec": 15,
  "depositCacheTtlSec": 300,
  "confirmTicks": 2
}
```

- **`pollIntervalSec` (Default: 15s)**: Seconds between PnL checks in the background daemon poller.
  - **Standard Operation (15s)**: Combined with `confirmTicks: 2`, exit latency is 30 seconds (`15s × 2`), protecting against transient price spikes while saving >90% of poller CPU/network overhead.
  - **High-Risk / Fast-Dump Pools (3s)**: When trading risky meme coins where dumps occur in seconds and every second matters, reduce `pollIntervalSec: 3` (and optionally `confirmTicks: 1` or `2`). Note: frequent polling in conjunction with `"source": "rpc"` increases RPC credit usage by 5x (~2.88M Helius credits/day).
- **`confirmTicks` (Default: 2)**: Number of consecutive polling ticks that must confirm an exit signal (stop-loss, trailing take-profit, out-of-range) before triggering a close transaction. Prevents false exits caused by single-block liquidity wicks. Total exit detection latency = `pollIntervalSec × confirmTicks`.

### 4.4 Centralized RPC & Wallet Connection Manager (`packages/core/src/shared/connection.ts`)
Instead of reading `process.env.RPC_URL` in multiple ad-hoc places, `packages/core/src/shared/connection.ts` serves as the single source of truth:
- Reads credentials from `config.connection` (with env var fallback).
- Automatically initializes and manages primary `getConnection(false)` and fallback `getConnection(true)` connection instances based on `config.connection.rpcUrl` and `config.connection.rpcUrl2`.
- Provides `getWalletKeypair()` and `getWalletAddress()` consistently.

### 4.5 Deferred Balance Checking in Opportunity Poller (`Daemon.ts`)
Instead of polling wallet balances unconditionally on every 45-second poller tick:
1. Fast local / cached check: `getMyPositions({ silent: true })`. If positions >= max, stop immediately.
2. Check candidates: `getTopCandidates()`. If 0 candidates, stop immediately.
3. Only when valid candidates exist and a position deployment is ready to be evaluated, query `getWalletBalances()`.

### 4.6 Strict Typed Interfaces
Exported across `@etemaro/core`:
- `GetMyPositionsResult`: `{ wallet: string | null; total_positions: number; positions: OnChainPosition[]; source?: 'rpc' | 'meteora_api'; error?: string; degraded?: boolean; }` — `degraded: true` means the position set could not be determined (Datapi and RPC fallback both failed); callers must fail closed rather than treat the wallet as flat.
- `WalletBalancesResult`: `{ wallet: string | null; sol: number; sol_price: number; sol_usd: number; usdc: number; tokens: Array<{ mint: string; symbol: string; balance: number; usd: number | null }>; total_usd: number; error?: string; }`

---

## 5. Expected Performance & Cost Impact

> **These figures are modelled, not measured.** They come from the calling-frequency arithmetic in §1.1 and were not validated against provider billing. Measured values from production logs are given in §7.

| Metric | Before Optimization | After Optimization | Improvement |
| :--- | :--- | :--- | :--- |
| **Monthly Helius Credits** | **1,000,000 – 10,000,000+** | **0** (Balance queries) / **< 10,000** (Tx simulation & broadcast only) | **> 99% Savings** |
| **Daily External HTTP Calls** | ~15,000 / agent | ~500 / agent (via TTL cache & deferred checks) | **96% Reduction** |
| **Daemon Event Loop Latency** | High (waiting on un-cached HTTP on every tick) | Instantaneous (served from memory) | **~10x Faster Polling Cycle** |
| **Free Tier Feasibility** | Exceeds free Helius plan in 2–3 days | Operates indefinitely within free tiers | **100% Free-tier Sustainable** |

---

## 6. Upstream Capability Review (2026-09-30)

Verified against the upstream documentation and live endpoints. Dependency versions are current (`@meteora-ag/dlmm` `1.9.14` = npm `latest`, DLMM program `0.12.0`); the items below are capabilities we do not use yet, not defects. Listed so the next optimisation pass starts from facts.

### Helius

| Capability | Why it matters here | Reference |
| :--- | :--- | :--- |
| **Priority Fee API** | We attach no compute-unit *price*, so our transactions pay no priority fee. Note `@meteora-ag/dlmm` already sets the compute-unit *limit* on every DLMM instruction it builds (10 call sites), which is the part that prevents CU-exceeded failures; only the congestion-priced price is missing. Six priority levels, real-time estimates. | https://www.helius.dev/docs/priority-fee-api |
| **Sender** | Credit-free transaction submission (`https://sender.helius-rpc.com/fast`) that routes across Helius/Jito/Harmonic/Rakurai simultaneously. Two tiers: Sender Max (0.001 SOL minimum tip, priority buffer) and SWQOS-only (0.000005 SOL). Replaces plain `sendAndConfirmTransaction` for latency-sensitive closes. | https://www.helius.dev/docs/sending-transactions/sender |
| **Preconfirmations** | `preconfSubscribe` gives sub-second confirmation signals — directly relevant to exit latency, which today is bounded by `pollIntervalSec × confirmTicks`. | https://www.helius.dev/docs/pre-confirmations/overview |
| **LaserStream / Parsed Streams** | Event-driven position and pool tracking instead of our polling cycles. | https://www.helius.dev/docs/laserstream |
| **Gatekeeper (beta)** | `https://beta.helius-rpc.com/?api-key=…` — lower latency on the same key. | https://www.helius.dev/docs/gatekeeper/overview |
| **Admin API** | `get-project-usage` for credit monitoring. | https://www.helius.dev/docs/api-reference/admin |

Notes: RPC endpoints are `mainnet.` / `beta.` / `devnet.helius-rpc.com`; paid plans use staked connections by default. The **Enhanced Transactions API is legacy/maintenance-mode** (we use neither it nor its replacement, Parsed Events). The Wallet API is its own beta product: 100 credits per request, `limit` defaults to 100 (we now send it explicitly and follow `pagination.hasMore`), `showNative` defaults to `true`.

### Meteora

Documented endpoints we do not consume yet: `/positions/{address}/historical` (exact add/remove/claim-fee events — a stronger basis for fee accounting than derived values), `/wallets/{wallet}/pools/{pool_address}/total_claims` (exact claimed fees and rewards), `/portfolio/total` (all-time PnL), `/stats/protocol_metrics`, `/pools/{address}/ohlcv` and `/pools/{address}/volume/history`, and the limit-order endpoints (the program now supports limit orders and `collect_fee_mode`).

SDK guidance from the 0.12.0 changelog: v2 liquidity operations (`addLiquidity2`, `removeLiquidity2`, `claimFee2`) and `getBinArraysRequiredByPositionRange2` are the forward path; we currently use the v1 helpers (`addLiquidityByStrategyChunkable`, `removeLiquidity`, `claimSwapFee`), which remain valid and manage their own bin arrays. Swap quote math changed with 0.12.0 and the per-instruction bin cap dropped from 280 to 260 — both handled inside the pinned SDK.

---

## 7. Verified Operational Facts and Known Risks (2026-09-30)

Everything below was checked against the code, the pinned dependency internals, provider documentation and production logs (`data/remote-server/data/instances/*/logs`, 2026-09-12 → 09-30). Where a number is measured, the source is named.

### 7.1 What is genuinely mandatory

Checked by parsing the shipped default config through `AgentConfigSchema` with one variable removed at a time:

| Env var | Status |
| :--- | :--- |
| `RPC_URL` | **Required** — the shipped config now carries a literal public default, so this only fails if you point `connection.rpcUrl` at `env.RPC_URL` and leave it empty |
| `LLM_MODEL` | **Required** while `llm.defaultModel` is an env ref |
| `JUPITER_API_KEY` | Not needed to start, **required to execute a swap** (live mode). `swapToken` throws without it; dry-run is unaffected |
| `HELIUS_API_KEY` | **Never required** — optional price/symbol enrichment and a balance fallback only |
| `RPC_URL_2`, Telegram, HiveMind, Meridian | Optional |

Per transaction the protocol requires only the base fee (5,000 lamports per signature), a recent blockhash and a valid signature. A priority fee is optional.

### 7.2 Priority fees: not required

Measured over ~10 days of production logs:

| Signal | Count |
| :--- | :--- |
| Deploy transactions succeeded | ~162 |
| Close transactions succeeded | ~162 |
| `has expired: block height exceeded` (the symptom a priority fee mitigates) | **3** |

Those runs paid no priority fee and landed. The clustered "deploy failed" lines on 09-24 and 09-26 (3 and 15) were `Cannot read properties of undefined (reading 'position')` — a response-shape bug fixed by #339; the signature has not recurred since 09-26.

Cost if we ever want the insurance: ~10,000 µLamports/CU × ~400k CU ≈ 4,000 lamports ≈ **0.000004 SOL (~$0.0005) per transaction**, against a base fee of 5,000 lamports/signature. This is not a material spend. Note that **Helius Sender Max is a different proposition** — a 0.001 SOL minimum tip per transaction is ~$0.12, which is a real cost and not justified by the current landing rate.

### 7.3 Provider tiers versus measured usage

**Helius free tier: 1M credits/month, no card, 10 RPS RPC, 2 RPS Enhanced/DAS, Wallet API included** (`docs/billing/plans`, checked 2026-09-30; no LaserStream gRPC, no Preconfirmations).

| Cost driver | Weight | Observed |
| :--- | :--- | :--- |
| Wallet API `balances` | 100 credits/call | attempted **once** in the whole log history |
| Position fallback via `getProgramAccounts` | ~100 credits/call | 18 occurrences in ~19 days |
| Standard RPC reads / send / confirm | 1 credit/call | dominant, but bounded |

Measured cycle rates on 09-30 (6.85 h window, `agent-config.smart-wallet-follow.v260928-004` → per 24 h): management ~480, smart-wallet screening ~287, sweeper ~98, Datapi portfolio fetches ~690 (0 credits). Even at a generous 3 RPC calls per cycle that is ~2,600 credits/day ≈ 78k/month per instance — roughly 10× headroom inside the free tier, and 2–3 instances still fit under one key (credits and 10 RPS are shared per account).

This holds only while two conditions do, both now covered by tests: `pnl.source` stays `meteora_api`, and the Wallet API call stays conditional on unpriced tokens.

**Jupiter**: keyless access is 0.5 RPS and explicitly aimed at prototyping; a free key gives 1 RPS, which is far above our swap volume (`/swap/v2/execute` has its own, much higher bucket). No paid tier is needed.

### 7.4 Known risks

1. **Undocumented Meteora dependency.** `pool-discovery-api.datapi.meteora.ag` (used by `ScreeningAdapter`, `deploySafety` and the close path) appears in neither the Meteora docs index nor the published OpenAPI. Its schema is not interchangeable with the documented `/pools`: it alone exposes `organic_score`, `pvp_rival_holders` and `active_tvl`, while the documented endpoint uses `address` (not `pool_address`), `token_x.holders` and `pool_config.bin_step`. **Impact:** screening signals depend on an unversioned internal API that can change without notice; a silent schema change would degrade candidate scoring rather than fail loudly. **Mitigation:** isolated in two modules, flagged here, and a deliberate migration decision is still open.
2. **Cost/performance figures are modelled.** The §5 table is arithmetic from §1.1, not provider billing. Treat only §7.3's measured numbers as evidence.
3. **No priority fee.** Exposure is limited to congestion spikes (measured: 3 blockhash expiries in ~10 days); see §7.2 for the trade-off and the negligible cost of adding a small one.
4. **Screening quality depends on LLM output** for candidate ranking, with mechanical rules only for exits. A degraded LLM changes what gets deployed, though not how open positions are managed.
