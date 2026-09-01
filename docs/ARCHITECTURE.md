# Etemaro — Architecture Guide

## Codebase Organization (Hexagonal Design)

The codebase is a pnpm monorepo. Config and runtime data live at the repository root; application code is split across three packages under `packages/`:

```
  config/
    agents.json
    user-config.json           # Active user configuration (generated via `pnpm cli init` or core defaults)
    templates/
      ecosystem.config.example.cjs # Multi-agent PM2 configuration template
data/
  state.json                 # Registry of open/closed positions
  lessons.json               # Historical performance lessons
  pool-memory.json           # Snapshotted pool activity caching
  signal-weights.json        # Darwinian signal adjustments
  decision-log.json          # Decisional records log
  smart-wallets.json         # KOL wallet tracking list
  strategy-library.json      # Saved LP strategy profiles
  token-blacklist.json       # Hard-blocked token mints
  telegram_queue.json        # Persisted pending Telegram messages queue
  hivemind-cache.json        # Cached shared HiveMind lessons + presets
data/logs/
  agent-YYYY-MM-DD.log       # Rotating application logs
  actions-YYYY-MM-DD.jsonl   # Structured audit trail
packages/
  cli/src/
    Cli.ts                   # CLI entrypoint: one-shot command runner
  daemon/src/
    Daemon.ts                # Daemon entrypoint: cron orchestration + REPL + Telegram bot
  core/src/
    application/
      agent-loop.ts          # Core ReAct loop: LLM reasoning → tool calling → execution
      prompt-builder.ts      # Dynamic system prompt builder (Screener, Manager, General roles)
    adapters/
      blockchain/
        MeteoraAdapter.ts    # Meteora DLMM SDK wrapper (lazy loaded, caching)
        WalletAdapter.ts     # Wallet balances (Helius) + Jupiter swap
        ScreeningAdapter.ts  # Pool candidates scorer and discovery filters
        TokenDataAdapter.ts  # Token holder audits and narratives from Jupiter API
        StudyAdapter.ts      # Top LPer performance study via Relays
      indicators/
        ChartIndicatorsAdapter.ts # Price chart technical analysis indicators
      notifications/
        TelegramAdapter.ts   # Telegram bot interaction & notification handler
      external/
        HivemindAdapter.ts   # HiveMind collective intelligence agent sync
        AgentMeridianClient.ts # Agent Etemaro API client
        GmgnClient.ts        # GMGN token tracking API client
      BriefingAdapter.ts     # Daily plain-text briefing generator
      PnLAdapter.ts          # Closed positions PnL tracker
      ToolDefinitions.ts     # ReAct agent tools JSON schemas (source of truth for LLM)
      ToolExecutor.ts        # ReAct agent tools execution router & safety checks
    domain/
      state.ts               # Position state manager
      decision-log.ts        # Decisional state manager
      lessons.ts             # Lessons state manager
      pool-memory.ts         # Pool memory state manager
      strategy-library.ts    # LP strategies state manager
      token-blacklist.ts     # Token blacklist state manager
      dev-blocklist.ts       # Dev blocklist state manager
      smart-wallets.ts         # Smart wallets state manager
      signal-weights.ts        # Darwinian signal weight state manager
      signal-tracker.ts        # Signal performance tracker state manager
    config/
      Config.ts              # Configuration parser (loads config/ files + .env)
    shared/
      utils.ts               # Timeframe, normalization, and math utilities
      logger.ts              # Daily rotating file logger
      constants.ts           # Default limits, paths (dataPath, configPath), and constants
      types.ts               # Shared TypeScript types and Zod schemas
```

---

## The ReAct Loop & Tools Logic

Etemaro relies on a **ReAct loop** (`agent-loop.ts`) to let the LLM autonomously inspect live data and call tools.

### 1. Tool Definitions (`ToolDefinitions.ts`)

Exposes Zod schemas converted to OpenAI-format JSON schemas. These schemas are what the LLM sees to understand available actions (e.g. `deploy_position`, `close_position`, `swap_token`, `get_position_pnl`, `get_top_candidates`).

### 2. Tool Executor (`ToolExecutor.ts`)

Routes the tool call from the LLM to the corresponding adapter implementation. It enforces crucial safety checks:

- **Pre-deploy checks**: Verifies the pool metrics are still valid on-chain immediately before executing a deploy transaction.
- **Auto-swap base→SOL**: After successfully executing a `close_position` tool call, the executor automatically swaps the returned base token back to SOL via Jupiter Swap.
- **Notifications**: Emits Telegram notifications for all key transactions.

---

## Strategy Library (`strategy-library.ts`)

The strategy library defines preset configurations for Meteora DLMM pool deployments. These presets define:

- **Bin Distribution**: How liquidity is distributed across the bins (e.g. `spot`, `bid_ask`, or `curve`).
- **Bins Below/Above**: How many bins are placed below and above the active price bin.
- **SOL/Token Ratio**: For screening-driven deployments, the bot hardcodes single-sided SOL-only deposits (`bins_above = 0`, `amount_x = 0`).

---

## Dry-Run Mode & Transaction Interception

When `DRY_RUN=true` is set in the environment:

- **Interceptors**: Inside `MeteoraAdapter.ts`, the functions `deployPosition`, `claimFees`, and `closePosition` check for the dry-run flag.
- **Mock Responses**: Instead of submitting a transaction payload to the Solana blockchain, the adapter intercepts the call and returns a mock object containing `dry_run: true` and a mock transaction ID.
- _Note:_ Mock positions are only saved to the local `state.json` registry during the deploy step; they are not simulated dynamically by the management loop since they do not exist on the Solana blockchain.

---

## Configuration Lifecycle & State Isolation

1. **Singleton Pattern**: The configuration is parsed once at application start into an immutable-by-convention `config` singleton exported by `@etemaro/core`.
2. **In-Place Runtime Mutations**: Dynamic parameter modifications (such as screening threshold reloads via `reloadScreeningThresholds()` or active strategy switching via `setActiveStrategy()`) mutate fields directly on the shared `config` instance, ensuring that all consumers maintain synchronized view without stale module cache references.
3. **Environment Propagation**: User-defined credentials and URLs in `user-config.json` are conditionally populated into `process.env` using `||=` fallback assignment, ensuring that environment variables passed explicitly via CLI or `.env` take precedence.
4. **Test Isolation**: Test suites that mutate `process.env` or mock file system configs must snapshot and restore `process.env` in `beforeEach`/`afterEach`, and use `resetConfig()` from `@etemaro/core` to cleanly re-initialize the singleton state between test cases.

---

## RPC & API Efficiency Architecture

Etemaro separates state-read workflows from transaction-write workflows to prevent runaway RPC credit usage:

- **Free REST Datapis for Monitoring**: Active DLMM positions, range status, and real-time PnL/fees are monitored through Meteora's REST Datapi (`dlmm.datapi.meteora.ag`), avoiding expensive on-chain `getProgramAccounts` RPC calls.
- **Jupiter for Valuation**: Token prices and USD conversions use Jupiter Free Price API v2 (`api.jup.ag/price/v2`) and Token list (`tokens.jup.ag`).
- **RPC Exclusivity**: On-chain RPC calls (`simulateTransaction`, `sendAndConfirmTransaction`, `getLatestBlockhash`) are reserved strictly for pre-flight transaction simulations and execution.
- See [RPC_AND_API_OPTIMIZATION.md](RPC_AND_API_OPTIMIZATION.md) for the complete decision matrix and caching blueprint.

---

## Daemon Lifecycle, Concurrency & Telegram Command Queue

### 1. Single Unified Telegram Command Queue
- **Queue Count**: There is **one single FIFO queue** (`telegramQueue`, bounded to `MAX_TELEGRAM_QUEUE = 5`) per running `Daemon` agent process.
- **Persistence**: Persisted to `data/telegram_queue.json` (or `<agent_data_dir>/telegram_queue.json` in custom data dirs).
- **Enqueue Trigger**: When the agent is busy executing autonomous cycles (`managementBusy`, `screeningBusy`, `pnlPollBusy`, `opportunityPollBusy`, `busy`), incoming Telegram messages are enqueued and persisted to disk.
- **Drain Trigger**: Drained sequentially whenever the daemon transitions to idle or via a 5-second periodic autonomous timer (`startTelegramDrainTimer()`).
- **Restart Safety Filter**: On daemon restart (`loadTelegramQueue()`), only safe, read-only commands (`/status`, `/config`, `/help`, `/positions`, `/briefing`, `/candidates`, `/screen`, `/pool <n>`) are restored. `/stop` and mutating commands (`/close`, `/deploy`, `/set`, `/pause`, `/resume`, free-form chat) are discarded to prevent infinite restart boot-loops and execution against changed on-chain positions.

### 2. Autonomous Cycles Do Not Use Queues (Mutex Guards)
- Autonomous cron tasks (position management, pool screening, PnL polling) **do not have message queues**.
- They use non-blocking mutex guards: if a cron cycle fires while another cycle is already in progress, the cycle simply skips that tick (single-flight execution).

### 3. Multi-Agent Topologies
- In multi-agent setups (e.g. via PM2 or Desktop), each agent process runs an independent `Daemon` instance with its own isolated `DATA_DIR`.
- Each agent maintains exactly **one isolated queue file** in its respective data folder.



