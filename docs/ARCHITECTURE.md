# Meridian — Architecture Guide

## Codebase Organization (Hexagonal Design)

The codebase is structured under the repository root, with configurations separated into `/config`, runtime databases in `/data`, logs in `/logs`, and core code in `/src`:

```
config/
  user-config.json          # Active user configuration
  user-config.example.json  # Template user configuration
  gmgn-config.json          # GMGN fee provider config
data/
  state.json                # Registry of open/closed positions
  lessons.json              # Historical performance lessons
  pool-memory.json          # Snapshotted pool activity caching
  signal-weights.json       # Darwinian signal adjustments
  decision-log.json         # Decisional records log
  smart-wallets.json        # KOL wallet tracking list
  strategy-library.json     # Saved LP strategy profiles
  token-blacklist.json      # Hard-blocked token mints
  dev-blocklist.ts          # Hard-blocked developer addresses
logs/
  agent-YYYY-MM-DD.log      # Rotating application logs
src/
  interfaces/
    Daemon.ts               # Daemon entrypoint: cron orchestration + REPL + Telegram bot
    Cli.ts                  # CLI entrypoint: command line runner
  application/
    agent-loop.ts           # Core ReAct loop: LLM reasoning → tool calling → execution
    prompt-builder.ts       # Dynamic system prompt builder (Screener, Manager, General roles)
  adapters/
    blockchain/
      MeteoraAdapter.ts     # Meteora DLMM SDK wrapper (lazy loaded, caching)
      WalletAdapter.ts      # Wallet balances (Helius) + Jupiter swap
      ScreeningAdapter.ts   # Pool candidates scorer and discovery filters
      TokenDataAdapter.ts   # Token holder audits and narratives from Jupiter API
      StudyAdapter.ts       # Top LPer performance study via Relays
    indicators/
      ChartIndicatorsAdapter.ts # Price chart technical analysis indicators
    notifications/
      TelegramAdapter.ts    # Telegram bot interaction & notification handler
    external/
      HivemindAdapter.ts    # HiveMind collective intelligence agent sync
      AgentMeridianClient.ts # Agent Meridian API client
      GmgnClient.ts         # GMGN token tracking API client
    BriefingAdapter.ts      # Daily HTML/text briefing generator
    PnLAdapter.ts           # Closed positions PnL tracker
    ToolDefinitions.ts      # ReAct agent tools JSON schemas (source of truth for LLM)
    ToolExecutor.ts         # ReAct agent tools execution router & safety checks
  domain/
    state.ts                # Position state manager
    decision-log.ts         # Decisional state manager
    lessons.ts              # Lessons state manager
    pool-memory.ts          # Pool memory state manager
    strategy-library.ts     # LP strategies state manager
    token-blacklist.ts      # Token blacklist state manager
    dev-blocklist.ts        # Dev blocklist state manager
    smart-wallets.ts        # Smart wallets state manager
  config/
    Config.ts               # Configuration parser (loads config/ files + .env)
  shared/
    utils.ts                # Timeframe, normalization, and math utilities
    logger.ts               # Daily rotating file logger
    constants.ts            # Default limits, paths (dataPath, configPath), and constants
    types.ts                # Shared TypeScript types and Zod schemas
```

---

## The ReAct Loop & Tools Logic

Meridian relies on a **ReAct loop** (`agent-loop.ts`) to let the LLM autonomously inspect live data and call tools. 

### 1. Tool Definitions (`ToolDefinitions.ts`)
Exposes Zod schemas converted to OpenAI-format JSON schemas. These schemas are what the LLM sees to understand available actions (e.g. `deploy_position`, `close_position`, `swap_token`, `get_position_pnl`, `get_top_candidates`).

### 2. Tool Executor (`ToolExecutor.ts`)
Routes the tool call from the LLM to the corresponding adapter implementation. It enforces crucial safety checks:
* **Pre-deploy checks**: Verifies the pool metrics are still valid on-chain immediately before executing a deploy transaction.
* **Auto-swap base→SOL**: After successfully executing a `close_position` tool call, the executor automatically swaps the returned base token back to SOL via Jupiter Swap.
* **Notifications**: Emits Telegram notifications for all key transactions.

---

## Strategy Library (`strategy-library.ts`)

The strategy library defines preset configurations for Meteora DLMM pool deployments. These presets define:
* **Bin Distribution**: How liquidity is distributed across the bins (e.g. `spot`, `bid_ask`, or `curve`).
* **Bins Below/Above**: How many bins are placed below and above the active price bin.
* **SOL/Token Ratio**: For screening-driven deployments, the bot hardcodes single-sided SOL-only deposits (`bins_above = 0`, `amount_x = 0`).

---

## Dry-Run Mode & Transaction Interception

When `DRY_RUN=true` is set in the environment:
* **Interceptors**: Inside `MeteoraAdapter.ts`, the functions `deployPosition`, `claimFees`, and `closePosition` check for the dry-run flag.
* **Mock Responses**: Instead of submitting a transaction payload to the Solana blockchain, the adapter intercepts the call and returns a mock object containing `dry_run: true` and a mock transaction ID.
* *Note:* Mock positions are only saved to the local `state.json` registry during the deploy step; they are not simulated dynamically by the management loop since they do not exist on the Solana blockchain.
