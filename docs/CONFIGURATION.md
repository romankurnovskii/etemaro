# Meridian — Configuration Guide

Meridian uses a layered configuration system combining environment variables, a user-specific JSON configuration file, and fallback defaults.

```
                  ┌────────────────────────┐
                  │          .env          │ ─── API keys, Wallet Private Key,
                  └───────────┬────────────┘     Global default LLM_MODEL
                              ▼
                  ┌────────────────────────┐
                  │    user-config.json    │ ─── Risk rules, screening filters,
                  └───────────┬────────────┘     model-specific overrides
                              ▼
                  ┌────────────────────────┐
                  │    src/config/Config.ts│ ─── Fallback defaults & Zod validation
                  └────────────────────────┘
```

---

## 1. Environment Variables (`.env`)

Used strictly for private credentials, API keys, and global overrides. Kept out of JSON config files to avoid accidental code commits:
* `WALLET_PRIVATE_KEY`: Your Solana wallet's base58 private key.
* `RPC_URL`: Main Solana RPC endpoint.
* `HELIUS_API_KEY`: API key for Helius (used for wallet balances and token holders).
* `OPENROUTER_API_KEY`: OpenRouter API key for LLM calls.
* `LLM_MODEL`: Acts as the default LLM model for all three agent roles (`SCREENER`, `MANAGER`, `GENERAL`) unless overridden individually.
* `DRY_RUN`: Set to `true` (default) for safe simulation, `false` for live on-chain operations.

---

## 2. User Configuration (`user-config.json`)

Created automatically by the setup wizard (`npm run setup`) or manually. Used to override default behaviors and screening filters:

### Hierarchy & Priority
If you define `LLM_MODEL` in `.env`, it will be used for all agent loops. However, if you explicitly configure model overrides in `user-config.json`, the JSON configuration takes priority:
```json
{
  "llmModel": "openrouter/hunter-alpha", // default for all loops
  "generalModel": "openai/gpt-4o",       // overrides LLM_MODEL specifically for ad-hoc chats
  "screeningModel": "anthropic/claude-3" // overrides LLM_MODEL specifically for screening
}
```

### Main Parameters
* **`deployAmountSol`**: The SOL amount deployed per position (e.g. `0.1` or `0.5`).
* **`maxPositions`**: Maximum concurrent open positions.
* **`minFeeActiveTvlRatio`**: Screening threshold for pool yield quality (fees/active TVL).
* **`maxBotHoldersPct`**: Maximum allowed percentage of snipers/bot wallets holding the token.
* **`stopLossPct`**: Close position deterministically if PnL drops below this percentage (e.g., `-50`).
* **`outOfRangeWaitMinutes`**: Minutes to wait before closing an out-of-range position (e.g., `30`).

---

## 3. Config Parsing & Reloading (`Config.ts`)

* **Zod validation**: Configuration values are verified at startup against Zod schemas in [types.ts](file:///Users/r/dev/poc/meridian/src/shared/types.ts).
* **Dynamic Reloading**: When `reloadScreeningThresholds()` is called (at the start of every screening cycle), the bot re-reads `user-config.json` from the filesystem. This allows you to edit screening filters and risk parameters without restarting the daemon process.
* **Darwinian Auto-Evolution**: When the evolution logic runs (`npm run evolve`), it evaluates closed position logs, automatically updates the thresholds (like `minOrganic`) to perform better, and writes the updated values directly into `user-config.json`.
