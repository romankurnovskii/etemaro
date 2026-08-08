---
description: Fetch and analyse top pool candidates with OKX smart money signals
---
Fetch top 5 enriched pool candidates and cross-reference with OKX signals:

1. Get pool candidates:
```
!`node cli.js candidates --limit 5`
```

2. Get OKX smart money signals on Solana:
```
!`onchainos signal list --chain solana --wallet-type 1`
```

3. Get OKX trending tokens:
```
!`onchainos token trending --chains solana`
```

Cross-reference: if a candidate token appears in OKX smart money signals with low soldRatioPercent (<20%), that's a strong conviction signal. If smart money has already sold (soldRatioPercent >80%), skip it.

Analyse each candidate and give a deploy recommendation (yes/no) with reasoning. Consider:
- fee/TVL ratio (higher is better, aim for >0.1)
- organic score (min 60, prefer 70+)
- bot % (reject if >30%)
- top10 holder concentration (reject if >60%)
- price trend (prefer stable or uptrending)
- volume vs TVL (higher activity is better)
- smart money conviction (OKX signal soldRatioPercent)
- narrative strength

Rank them and suggest which (if any) to deploy into.
