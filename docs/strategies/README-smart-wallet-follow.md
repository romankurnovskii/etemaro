# Strategy: Smart Wallet Follow (bin 50–200)

**Config:** `config/instances/agent-config.smart-wallet-follow.v260913-1.json`
**Library id:** `smart_wallet_follow`
**Created:** 2026-09-13 · **Author:** custom

A copy-trade-lag variant that reproduces what the tracked smart wallets actually do on-chain, with the
bin-step filter widened to match their measured behavior. Everything else is inherited unchanged from
`copy_trade_lag`.

## Why this strategy exists

The original `copy_trade_lag` (bin_step 80–125) under-triggered. During a review of its run logs we
reconciled every screened candidate against the smart wallets' live on-chain positions: of the wallets'
pools, ~77% sit at bin_step 80/100/125 and another ~14% at bin_step 50 and 200. The old 80–125 gate
silently skipped a whole class of pools the wallets actively LP in — e.g. HODL, Tulip/TULIP,
LEVERSTONK (all bin_step 200) were vetoed purely on bin_step, and PERPSPAD (bin_step 400) was outside
the window entirely.

This strategy widens `screening.minBinStep`/`maxBinStep` to **50–200** so the bot enters the same pools
the wallets do, while still refusing the illiquid 250+/400 tail.

## Measured smart-wallet pattern (grounding data)

Distribution of bin steps across Alpha2's **1,194** pools (2026-09-13 snapshot):

| bin_step | # pools | % | note |
|---|---|---|---|
| 100 | 618 | 52% | core home |
| 125 | 152 | 13% | at old max |
| 80 | 138 | 12% | at old min |
| 200 | 113 | 9.5% | previously vetoed |
| 50 | 53 | 4.4% | previously vetoed |
| 20 | 51 | 4.3% | tail, kept excluded |
| 250 | 28 | 2.3% | tail, kept excluded |
| 400 | 15 | 1.3% | tail, kept excluded |

Coverage pick: `50–200` ≈ 91% of the wallet's pools (vs 77% under the old 80–125 window).

## Key mechanics (inherited)

- `opportunity.minScore=9999` + `smartWalletScoreBonus=10000` → **smart wallet presence is the only
  entry path**. No wallet in pool = no deploy. That gate is unchanged.
- Entry via opportunity poller on the wallet list `copy_trade_lag` (Alpha1 `4oJxLx…sv8e`, Alpha2
  `5VY2B7…kSS`), LP-type wallets only.
- `bid_ask` shape, bins placed 1–30 below the active price (`defaultBinsBelow: 30`), single-sided SOL.
- Quick take-profit scalp: `takeProfitPct: 0.2%`, trailing after +3%, OOR close after 10 bins / 20 min.
- `maxPositions: 1`, `deployAmountSol: 0.1`, `positionSizePct: 0.35`.

## What changed vs `copy_trade_lag`

| Field | copy_trade_lag | smart_wallet_follow |
|---|---|---|
| `screening.minBinStep` | 80 | **50** |
| `screening.maxBinStep` | 125 | **200** |
| `strategy.activeStrategyId` | copy_trade_lag | **smart_wallet_follow** |
| defaultBinsBelow / settings | unchanged | unchanged |
| management / exit rules | unchanged | unchanged |

Note: `defaultBinsBelow: 30` with wider bins (50|200) now spans a much larger price range per bin-cluster —
range math is `bins × bin_price`. At bin_step 200 each step is ~2%, so 30 bins ≈ 60%+ downside coverage;
feasible and intentional given `maxBinsBelow: 30`.

## Thoughts / open questions

1. **bin_step 400 (PERPSPAD) left excluded on purpose** — 15/1194 pools (1.3%). The open PERPSPAD
   position was already flagged as a bad-fit candidate (huge ~3.9%/bin width). Keep excluded until the
   wallet shows durability there.
2. **The bin 50 lower bound is a judgment call.** Tighter bins (50 = ~0.5%/bin) are *safer* LP behavior,
   so including them slightly increases trigger count without much added tail risk. 20/25/10 steps stay
   excluded — they're mostly degen micro-pools.
3. **Match the wallet, not just its bins.** Biggest veto block was token age <5h (Tulip/TULIP ×8,
   TWINE) and TVL >300k (baton ×5). This strategy leaves those gates unchanged; if you want even closer
   reproduction, consider a variant with `minTokenAgeHours: 1–2` and/or `maxTvl: 500000`. Bias: TVL cap
   is a real safety valve for wide-bin pools — don't raise it without surveillance.
4. **maxPositions=1 remains the binding constraint.** The wallet cycles in/out on a ~10-min cadence; the
   single slot is what actually throttles deploy count, not the filters. If you want to ride several
   wallet positions at once, raise this to 2–3 first and watch risk.
5. **Volatility-0 veto is a honeypot guard, not a filter to relax.** Keep it.

## Activation

```bash
# dry-run first
AGENT_CONFIG_PATH=config/instances/agent-config.smart-wallet-follow.v260913-1.json npm run dev

# live
AGENT_CONFIG_PATH=config/instances/agent-config.smart-wallet-follow.v260913-1.json npm start
```

The strategy gets its own instance isolation (different `agentId`, separate `data/instances/…` dir), so
snapshot/decision-log state stays fully independent of the running `copy_trade_lag` instance.