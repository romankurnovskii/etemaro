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

When `config.connection.dryRun` is `true` (resolved at config boundary, not via env var):

- **Interceptors**: Inside `MeteoraAdapter.ts`, the functions `deployPosition`, `claimFees`, and `closePosition` check for the dry-run flag.
- **Mock Responses**: Instead of submitting a transaction payload to the Solana blockchain, the adapter intercepts the call and returns a mock object containing `dry_run: true` and a mock transaction ID.
- _Note:_ Mock positions are only saved to the local `state.json` registry during the deploy step; they are not simulated dynamically by the management loop since they do not exist on the Solana blockchain.

---

## Configuration Lifecycle & State Isolation

1. **Singleton Pattern**: The configuration is parsed once at application start into an immutable-by-convention `config` singleton exported by `@etemaro/core`.

2. **Config-as-Contract**: The JSON configuration file is the explicit contract of requirements; all `env.*` references are resolved once at the boundary (via `Config.ts`). If a variable is missing, the application fails immediately on boot with a clear error:
   `[config] Error: Missing required environment variable "LLM_API_KEY" referenced in config.llm.apiKey`.

3. **Strict Schema & Unknown Field Handling**:
   - The Zod configuration schema (`schema.ts`) uses `.strict()` — unknown fields are **rejected with a parse error** rather than silently dropped. This ensures the user is notified if they've pasted a secret into the wrong field.
   - The `wallet` field in `connection` is `z.string().optional()` — only an alias (e.g. `"main-scalp"`) is allowed; raw private keys are not stored in config.

4. **Key Segregation / Keystore Architecture** (recommended):
   - Private keys are **never** stored in the general `config` dictionary that LLM agents or decision loggers read.
   - Keys are loaded in memory only by `WalletAdapter` / `SolanaAdapter`, and only referenced by alias: `"wallet": "main-scalp"`.
   - Files are stored in a dedicated, secure directory (`~/.config/etemaro/.credentials/wallets/`) with Unix file permissions locked to owner-only (`chmod 0600`).

5. **Zero `process.env` in Business Logic**:
   - `applyUserConfigToEnv()` was removed. The `config` object is the single source of truth.
   - Downstream adapters (TelegramAdapter, WalletAdapter, GmgnClient) read directly from `config` only — no `process.env` fallbacks.
   - The only remaining `process.env` reads are infrastructure-tier (`USER_CONFIG_PATH`, `ETEMARO_DATA_DIR`, `HOME`, PM2 `pm_id`).

6. **Test Isolation**: Test suites that modify `process.env` or invoke config reloads must snapshot `process.env` in `beforeEach` and restore it in `afterEach` to prevent test pollution.

---

## Keystore & Wallet Management

The wallet architecture separates public config metadata from the raw private key:

```
~/.config/etemaro/
├── config/
│   └── user-config.json          # PUBLIC — references wallet by alias only:
│                                  #   "connection": { "wallet": "main-scalp" }
└── .credentials/                 # SECURE — gitignored, chmod 700
    └── wallets/
        └── main-scalp.json       # PRIVATE — keypair (Base58 or Solana CLI array), chmod 0600
```

### Resolution Flow

1. `connection.ts:getWalletKeypair()` reads `config.connection.wallet` (alias).
2. Loads `~/.config/etemaro/.credentials/wallets/<alias>.json` (or `config/.credentials/wallets/<alias>.json` for repo-local configs).
3. Enforces `chmod 0600` on POSIX systems (auto-tightens; FATAL if it cannot).
4. Supports Base58 secret strings and standard Solana CLI 64-byte JSON arrays.

### CLI Wallet Commands

| Command | Description |
|--------|-------------|
| `etemaro wallet generate --name <alias>` | Generate fresh keypair, save to keystore, `0600` |
| `etemaro wallet import --name <alias> --file <path>` | Import from Solana CLI keypair JSON |
| `etemaro wallet import --name <alias> --prompt` | Import Base58 key interactively (no shell history) |
| `etemaro wallet list` | List wallet aliases + public keys (never private) |
| `etemaro wallet export --name <alias>` | Print private key on explicit request |

### First-Run Onboarding

`etemaro start` (or `etemaro init`) detects no wallet config and interactively prompts:
- Generate a new wallet
- Import existing private key (Base58 / file)
- Select existing wallet alias



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



