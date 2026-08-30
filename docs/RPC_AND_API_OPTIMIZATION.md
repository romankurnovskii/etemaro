# Solana RPC & API Optimization Guide

## Executive Summary

Continuous autonomous LP trading requires regular state synchronization: wallet balance checks, position tracking, PnL evaluation, screening, and transaction execution. When these read loops query paid RPC endpoints or Enhanced API endpoints (such as Helius `/v1/wallet/.../balances` or on-chain `getProgramAccounts`) without caching, API credit consumption explodes.

Running an agent that polls every 15–45 seconds can consume **1,000,000+ Helius credits in a few days**, even with very few actual trades executed.

This guide details:
1. **Root cause analysis** of RPC and API credit consumption in Etemaro.
2. **The Strict Decision Matrix**: When on-chain RPC calls are strictly required vs. when they can be replaced by free, stable REST APIs or cached.
3. **Available stable alternatives** (Meteora REST Datapi, Jupiter Free Price & Token APIs, standard Solana RPC + in-memory cache).
4. **Architecture and implementation roadmap** to reduce RPC credit consumption by >95%.

---

## 1. Credit Consumption Audit & Root Cause Analysis

### 1.1 The Uncached Balance Polling Problem
In `packages/core/src/adapters/blockchain/WalletAdapter.ts:getWalletBalances()`, wallet balances (SOL, USDC, and SPL tokens with USD valuation) are fetched via Helius's proprietary Enhanced Wallet API:
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
Because Helius Enhanced APIs are weighted at higher credit costs per request (10–50 credits/call vs 1 credit for standard RPC), this burns **1,000,000 to 10,000,000+ Helius credits monthly** with zero trade volume.

### 1.2 The On-Chain Position Queries (`config.pnl.source: "rpc"`)
If `config.pnl.source` is set to `"rpc"` (or used as fallback), `computePositions()` invokes `DLMM.getAllLbPairPositionsByUser()` which issues `getProgramAccounts` on the Meteora DLMM program (`LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo`).
- `getProgramAccounts` is heavily throttled and costs **100+ credits per call** on Helius and standard RPC providers.
- Bypassing the local cache via `{ force: true }` in fast background loops (such as the opportunity poller) amplifies this waste.

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
   GET https://dlmm.datapi.meteora.ag/portfolio/open?user={walletAddress}
   ```
   *Returns*: Active pools, list of position addresses, out-of-range flags (`outOfRange`, `positionsOutOfRange`), token mints, bin dimensions.

2. **Real-time Position PnL & Unclaimed Fees**:
   ```http
   GET https://dlmm.datapi.meteora.ag/pool/{poolAddress}/pnl/{walletAddress}
   ```
   *Returns*: Exact lower/upper/active bins, unclaimed fees in both tokens (and USD/SOL converted), realized PnL, unrealized PnL, total yield percentage.

3. **Pool Candidate Metrics & Discovery**:
   ```http
   GET https://dlmm.datapi.meteora.ag/pools/{poolAddress}
   GET https://pool-discovery-api.datapi.meteora.ag/pools
   ```

*Reliability*: Hosted directly on Cloudflare and Meteora's dedicated indexing infrastructure. Handles high throughput with no API key requirement.

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

### 4.4 Centralized RPC & Wallet Connection Manager (`packages/core/src/shared/connection.ts`)
Instead of reading `process.env.RPC_URL` or `process.env.WALLET_PRIVATE_KEY` in multiple ad-hoc places, `packages/core/src/shared/connection.ts` serves as the single source of truth:
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
- `GetMyPositionsResult`: `{ wallet: string | null; total_positions: number; positions: OnChainPosition[]; error?: string; }`
- `WalletBalancesResult`: `{ wallet: string | null; sol: number; sol_price: number; sol_usd: number; usdc: number; tokens: Array<{ mint: string; symbol: string; balance: number; usd: number | null }>; total_usd: number; error?: string; }`

---

## 5. Expected Performance & Cost Impact

| Metric | Before Optimization | After Optimization | Improvement |
| :--- | :--- | :--- | :--- |
| **Monthly Helius Credits** | **1,000,000 – 10,000,000+** | **0** (Balance queries) / **< 10,000** (Tx simulation & broadcast only) | **> 99% Savings** |
| **Daily External HTTP Calls** | ~15,000 / agent | ~500 / agent (via TTL cache & deferred checks) | **96% Reduction** |
| **Daemon Event Loop Latency** | High (waiting on un-cached HTTP on every tick) | Instantaneous (served from memory) | **~10x Faster Polling Cycle** |
| **Free Tier Feasibility** | Exceeds free Helius plan in 2–3 days | Operates indefinitely within free tiers | **100% Free-tier Sustainable** |

