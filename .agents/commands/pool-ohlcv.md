---
description: Fetch price and volume history for a specific Meteora pool
argument-hint: [pool_address]
---
Fetch recent price action and volume trends for this pool:

1. OHLCV price data (last 24 candles, 1h timeframe):
```
!`curl -s "https://dlmm.datapi.meteora.ag/pools/$ARGUMENTS/ohlcv?timeframe=1h"`
```

2. Volume history:
```
!`curl -s "https://dlmm.datapi.meteora.ag/pools/$ARGUMENTS/volume/history?timeframe=1h"`
```

Analyse and summarise:
- Overall price trend (up/down/sideways)
- Volume trend (rising, falling, spike)
- Whether volume has been consistent or bursty
- Whether now is a good time to enter (rising volume + stable/rising price = good; falling volume = avoid)
