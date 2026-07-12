---
description: Check all open DLMM positions with PnL
---
Fetch all open positions:

```
!`node --import tsx packages/cli/src/Cli.ts positions`
```

For each position, show: pair, in-range status, age, and whether action is needed (claim fees, close if OOR, etc).
