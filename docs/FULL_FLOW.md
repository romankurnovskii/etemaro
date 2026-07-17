# Meridian — Full Application Flow

> **Meridian** is an autonomous Meteora DLMM liquidity management agent for Solana, powered by LLMs. It runs continuous screening and management cycles, deploying capital into high-quality Meteora DLMM pools and closing positions based on live PnL, yield, and range data.
>
> This is the **canonical flow reference** (architecture, startup, screening/management flows, learning, integrations). For day-to-day operation and commands, see [USAGE_GUIDE.md](USAGE_GUIDE.md). For config fields see [CONFIGURATION.md](CONFIGURATION.md); for HiveMind shared learning see [HIVEMIND.md](HIVEMIND.md).

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture](#2-architecture)
3. [Startup & Initialization](#3-startup--initialization)
4. [Configuration System](#4-configuration-system)
5. [The Agent Loop (ReAct)](#5-the-agent-loop-react)
6. [Screening Flow](#6-screening-flow)
7. [Management Flow](#7-management-flow)
8. [State Management](#8-state-management)
9. [Learning & Evolution](#9-learning--evolution)
10. [External Integrations](#10-external-integrations)
11. [User Interfaces](#11-user-interfaces)

---

## 1. System Overview

```mermaid
graph TB
    subgraph "User Interfaces"
        REPL["REPL Terminal"]
        TG["Telegram Bot"]
        CLI["CLI Tool"]
        CC["Claude Code"]
        DISC["Discord Listener"]
    end

    subgraph "Core Agent System"
        SCREEN["Screening Agent<br/>(every 30 min)"]
        MANAGE["Management Agent<br/>(every 10 min)"]
        LLM["LLM via OpenRouter"]
    end

    subgraph "Domain Layer"
        STATE["State Manager<br/>(state.json)"]
        LESSONS["Lessons Engine<br/>(lessons.json)"]
        DECISIONS["Decision Log<br/>(decision-log.json)"]
        WEIGHTS["Signal Weights<br/>(signal-weights.json)"]
        POOL_MEM["Pool Memory<br/>(pool-memory.json)"]
        SMART_W["Smart Wallets<br/>(smart-wallets.json)"]
        STRATEGY["Strategy Library"]
        BLACKLIST["Token Blacklist"]
    end

    subgraph "Adapters (External)"
        METEORA["Meteora DLMM SDK"]
        JUPITER["Jupiter API"]
        GMGN["GMGN API"]
        POOL_DISC["Pool Discovery API"]
        STUDY["LPAgent / Study API"]
        HIVE["HiveMind API"]
    end

    REPL --> SCREEN
    REPL --> MANAGE
    TG --> SCREEN
    TG --> MANAGE
    CLI --> METEORA
    CC --> SCREEN
    CC --> MANAGE
    DISC --> SCREEN

    SCREEN --> LLM
    MANAGE --> LLM
    LLM --> STATE
    LLM --> LESSONS
    LLM --> DECISIONS

    SCREEN --> POOL_DISC
    SCREEN --> JUPITER
    SCREEN --> GMGN
    SCREEN --> STUDY
    MANAGE --> METEORA
    MANAGE --> JUPITER
    MANAGE --> HIVE

    STATE --> LESSONS
    LESSONS --> WEIGHTS
```

---

## 2. Architecture

The codebase follows a **Hexagonal Architecture** (Ports & Adapters) pattern:

```mermaid
graph LR
    subgraph "Interfaces (Ports)"
        CLI_PORT["Cli.ts"]
        DAEMON_PORT["Daemon.ts"]
    end

    subgraph "Application Layer"
        AGENT_LOOP["agent-loop.ts<br/>ReAct loop core"]
        PROMPT["prompt-builder.ts<br/>System prompt factory"]
    end

    subgraph "Domain Layer"
        STATE_DOM["state.ts"]
        LESSONS_DOM["lessons.ts"]
        DECISIONS_DOM["decision-log.ts"]
        WEIGHTS_DOM["signal-weights.ts"]
        POOL_MEM_DOM["pool-memory.ts"]
        SMART_W_DOM["smart-wallets.ts"]
        STRATEGY_DOM["strategy-library.ts"]
        BLACKLIST_DOM["token-blacklist.ts"]
        BLOCKLIST_DOM["dev-blocklist.ts"]
    end

    subgraph "Adapters Layer"
        TOOL_EXEC["ToolExecutor.ts<br/>Tool dispatch"]
        TOOL_DEF["ToolDefinitions.ts<br/>Tool schemas"]
        METEORA_ADV["MeteoraAdapter.ts"]
        WALLET_ADV["WalletAdapter.ts"]
        SCREEN_ADV["ScreeningAdapter.ts"]
        TOKEN_ADV["TokenDataAdapter.ts"]
        STUDY_ADV["StudyAdapter.ts"]
        GMGN_ADV["GmgnClient.ts"]
        HIVE_ADV["HivemindAdapter.ts"]
        TG_ADV["TelegramAdapter.ts"]
        PNL_ADV["PnLAdapter.ts"]
        BRIEF_ADV["BriefingAdapter.ts"]
        CHART_ADV["ChartIndicatorsAdapter.ts"]
    end

    subgraph "Shared"
        TYPES["types.ts"]
        CONSTANTS["constants.ts"]
        LOGGER["logger.ts"]
        UTILS["utils.ts"]
    end

    CLI_PORT --> AGENT_LOOP
    DAEMON_PORT --> AGENT_LOOP
    AGENT_LOOP --> PROMPT
    AGENT_LOOP --> TOOL_EXEC
    TOOL_EXEC --> TOOL_DEF
    TOOL_EXEC --> METEORA_ADV
    TOOL_EXEC --> WALLET_ADV
    TOOL_EXEC --> SCREEN_ADV
    TOOL_EXEC --> TOKEN_ADV
    TOOL_EXEC --> STUDY_ADV
    TOOL_EXEC --> GMGN_ADV
    TOOL_EXEC --> HIVE_ADV
    TOOL_EXEC --> TG_ADV
    TOOL_EXEC --> PNL_ADV

    DOMAINLayer["Domain Layer"] --> TYPES
```

> **Path note:** `Cli.ts` lives at `packages/cli/src/Cli.ts`, `Daemon.ts` at `packages/daemon/src/Daemon.ts`, and every other `*.ts` shown above at `packages/core/src/...` (e.g. `agent-loop.ts` → `packages/core/src/application/agent-loop.ts`).

### Key Files

| File                                              | Role                                                            |
| ------------------------------------------------- | --------------------------------------------------------------- |
| `packages/core/src/config/Config.ts`              | Zod-validated config singleton from `user-config.json` + `.env` |
| `packages/core/src/application/agent-loop.ts`     | Core ReAct loop: LLM → tool call → repeat                       |
| `packages/core/src/application/prompt-builder.ts` | Builds role-specific system prompts                             |
| `packages/core/src/adapters/ToolExecutor.ts`      | Dispatches tool calls to adapter implementations                |
| `packages/core/src/adapters/ToolDefinitions.ts`   | OpenAI-format tool schemas                                      |
| `packages/core/src/domain/state.ts`               | Position registry in `state.json`                               |
| `packages/core/src/domain/lessons.ts`             | Learning engine + threshold evolution                           |
| `packages/core/src/domain/decision-log.ts`        | Structured decision rationale log                               |
| `packages/core/src/domain/signal-weights.ts`      | Darwinian signal weighting system                               |
| `packages/core/src/domain/pool-memory.ts`         | Per-pool deploy history + snapshots                             |

---

## 3. Startup & Initialization

```mermaid
sequenceDiagram
    participant User
    participant CLI as CLI / Daemon
    participant Config as Config.ts
    participant Wallet as WalletAdapter
    participant Screen as ScreeningAdapter
    participant State as State.ts
    participant Telegram as TelegramAdapter
    participant Cron as Cron Scheduler

    User->>CLI: npm start / meridian start
    CLI->>Config: loadConfig()
    Note right of Config: Reads user-config.json<br/>Reads .env (secrets)<br/>Merges with defaults via Zod schema

    CLI->>Wallet: getWalletBalances()
    Wallet-->>CLI: { sol: 10.5, usd: 1800, tokens: [...] }

    CLI->>State: syncOpenPositions()
    Note right of State: Reconciles local state.json<br/>with actual on-chain positions<br/>Auto-closes missing positions

    CLI->>Screen: getTopCandidates()
    Screen-->>CLI: Top candidate pools

    CLI->>Telegram: initBot() (if configured)
    Telegram-->>CLI: Bot polling started

    CLI->>Cron: Start cron jobs
    Note right of Cron: Management: every 10 min<br/>Screening: every 30 min<br/>Health check: every 60 min

    CLI->>User: REPL ready with live countdown
```

### Startup Checklist

1. **Config Load**: `user-config.json` + `.env` → Zod-validated `AppConfig` singleton
2. **Wallet Balance**: Fetch SOL + token balances from Solana RPC
3. **State Sync**: Reconcile `state.json` with on-chain positions (auto-close orphans)
4. **Telegram Bot**: Initialize polling (if `TELEGRAM_BOT_TOKEN` set)
5. **Cron Schedules**: Start management and screening cycles
6. **REPL Ready**: Interactive prompt with countdown to next cycle

---

## 4. Configuration System

```mermaid
graph TD
    subgraph "Configuration Sources"
        ENV[".env<br/>Secrets: keys, tokens, RPC URLs"]
        USER["user-config.json<br/>Runtime settings: thresholds, strategy"]
        GMGN_CFG["gmgn-config.example.json<br/>GMGN API settings"]
        DEFAULTS["Zod Schema Defaults<br/>Hardcoded fallbacks"]
    end

    subgraph "Config Builder"
        MERGE["buildConfig()"]
        ZOD_VALIDATE["Zod Validation"]
    end

    subgraph "Runtime Config"
        APP_CFG["AppConfig Singleton<br/>(in-memory)"]
        RELOAD["reloadScreeningThresholds()<br/>Hot-reload after evolution"]
    end

    ENV --> MERGE
    USER --> MERGE
    GMGN_CFG --> MERGE
    DEFAULTS --> MERGE
    MERGE --> ZOD_VALIDATE
    ZOD_VALIDATE --> APP_CFG
    APP_CFG --> RELOAD
    RELOAD --> APP_CFG
```

### Config Sections

| Section      | Purpose                                                               |
| ------------ | --------------------------------------------------------------------- |
| `risk`       | Max positions, max deploy amount                                      |
| `screening`  | Fee/TVL ratio, organic score, holder count, mcap, bin step thresholds |
| `management` | Deploy amount, stop loss, take profit, trailing TP, OOR wait time     |
| `strategy`   | LP strategy (bid_ask/spot), bin range                                 |
| `schedule`   | Management and screening interval (minutes)                           |
| `llm`        | Temperature, max tokens/steps, per-role model selection               |
| `darwin`     | Signal weight evolution settings                                      |
| `hiveMind`   | Shared learning sync settings                                         |
| `jupiter`    | Swap referral settings                                                |
| `indicators` | RSI/supertrend entry/exit indicators                                  |

---

## 5. The Agent Loop (ReAct)

The core of Meridian is a **ReAct (Reason + Act) loop** — the LLM reasons over live data, calls tools, observes results, and repeats until it produces a final answer.

```mermaid
sequenceDiagram
    participant Caller as Cron / REPL / Telegram
    participant Loop as agentLoop()
    participant Prompt as PromptBuilder
    participant LLM as OpenAI (OpenRouter)
    participant Tools as ToolExecutor
    participant Adapters as Adapters

    Caller->>Loop: goal + agentType
    Loop->>Prompt: buildSystemPrompt()
    Note right of Prompt: Injects: portfolio, positions,<br/>state summary, lessons,<br/>performance, decisions, weights

    Loop->>Loop: Build messages array

    loop ReAct Steps (max 20)
        Loop->>LLM: chat.completions.create()
        Note right of LLM: System prompt + history<br/>+ goal + tool definitions

        alt No tool calls → Final Answer
            LLM-->>Loop: content (final response)
            Loop-->>Caller: { content, userMessage }
        else Tool calls
            LLM-->>Loop: tool_calls[]

            loop For each tool call
                Loop->>Tools: executeTool(name, args)
                Tools->>Adapters: dispatch(name, args)
                Adapters-->>Tools: result
                Tools-->>Loop: { role: "tool", content: JSON }
            end

            Loop->>Loop: Append tool results to messages
            Note right of Loop: Continue loop
        end
    end
```

### Safety Mechanisms

| Mechanism                     | Purpose                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------ |
| **Once-per-session lock**     | `deploy_position`, `close_position`, `swap_token` can only fire once per cycle |
| **No-retry lock**             | `deploy_position` locked after first attempt regardless of outcome             |
| **JSON repair**               | Malformed tool arguments auto-repaired via `jsonrepair`                        |
| **Provider fallback**         | Falls back to `stepfun/step-3.5-flash:free` on provider errors                 |
| **System role fallback**      | Embeds system prompt in user message if provider rejects `role: system`        |
| **Tool choice fallback**      | Retries without `tool_choice: required` if provider rejects it                 |
| **Rate limit handling**       | 30s wait on 429 errors                                                         |
| **Tool-required enforcement** | For action intents, rejects answers without tool calls (up to 2 retries)       |

### Role-Based Tool Access

```mermaid
graph TD
    subgraph "SCREENER Tools"
        S_TOOLS["discover_pools<br/>get_top_candidates<br/>deploy_position<br/>get_active_bin<br/>check_smart_wallets<br/>get_token_holders<br/>get_token_narrative<br/>get_token_info<br/>search_pools<br/>get_pool_memory<br/>get_wallet_balance<br/>get_my_positions"]
    end

    subgraph "MANAGER Tools"
        M_TOOLS["close_position<br/>claim_fees<br/>swap_token<br/>get_position_pnl<br/>get_my_positions<br/>get_wallet_balance"]
    end

    subgraph "GENERAL Tools (intent-based)"
        G_TOOLS["All tools except self_update<br/>(filtered by user intent)"]
    end

    CALLER["User / Cron"] --> |"screen cycle"| SCREENER
    CALLER --> |"manage cycle"| MANAGER
    CALLER --> |"free chat"| GENERAL
```

### Intent Detection (GENERAL role)

The GENERAL agent uses regex patterns to detect user intent and only expose relevant tools:

```
"why did you deploy?" → get_recent_decisions
"deploy into SOL/BONK" → deploy_position, get_top_candidates, ...
"close position X" → close_position, get_my_positions, ...
"what's my balance?" → get_wallet_balance, get_my_positions
"study top LPers" → study_top_lpers, get_pool_detail, ...
```

---

## 6. Screening Flow

The Screening Agent runs every 30 minutes (configurable) to find and deploy into the best Meteora DLMM pool.

```mermaid
flowchart TD
    START["Screening Cycle Triggered"]

    START --> CHECK_DISCORD{"Discord signals<br/>enabled?"}
    CHECK_DISCORD -->|Yes| LOAD_SIGNALS["Load pending Discord signals<br/>(discord-signals.json)"]
    CHECK_DISCORD -->|No| FETCH_CANDIDATES

    LOAD_SIGNALS --> FETCH_CANDIDATES

    FETCH_CANDIDATES["get_top_candidates()"]
    Note1["Pool Discovery API →<br/>Filter by: fee/TVL, organic,<br/>holders, mcap, bin step"]
    FETCH_CANDIDATES --> Note1
    Note1 --> SCORE["Score pools (0-100)<br/>+ signal weights boost"]
    SCORE --> RETURN_TOP["Return top N candidates"]

    RETURN_TOP --> LLM_SCREEN["LLM Screening Cycle"]
    Note2["System prompt includes:<br/>- Current portfolio<br/>- Open positions<br/>- Lessons learned<br/>- Signal weights<br/>- Recent decisions"]
    LLM_SCREEN --> Note2

    Note2 --> EVAL["LLM evaluates each candidate"]
    EVAL --> |"Has Discord signal?"| PRIORITY["Process Discord signal first"]
    EVAL --> |"No signal"| STANDARD["Standard evaluation"]

    PRIORITY --> DEEP_RESEARCH["Deep Research"]
    STANDARD --> DEEP_RESEARCH

    DEEP_RESEARCH["Token Research"]
    Note3["Tools used:<br/>- get_token_info (Jupiter audit)<br/>- get_token_holders (concentration)<br/>- get_token_narrative (story)<br/>- check_smart_wallets (alpha)<br/>- get_pool_memory (history)<br/>- study_top_lpers (LP patterns)"]
    DEEP_RESEARCH --> Note3

    Note3 --> DECIDE["LLM Decision"]
    DECIDE --> |"Deploy"| CHECK_SAFETY
    DECIDE --> |"Skip all"| SKIP_LOG["Log skip decision"]

    CHECK_SAFETY["Safety Checks"]
    Note4["- Blacklist check<br/>- Dev blocklist check<br/>- Cooldown check<br/>- Max positions check<br/>- Min SOL reserve check"]
    CHECK_SAFETY --> Note4

    Note4 --> DEPLOY["deploy_position()"]
    DEPLOY --> ON_CHAIN["On-chain transaction<br/>(Meteora DLMM SDK)"]
    ON_CHAIN --> TRACK["trackPosition()<br/>(state.json)"]
    TRACK --> DECISION_LOG["Log decision<br/>(decision-log.json)"]
    DECISION_LOG --> NOTIFY["Telegram notification"]

    SKIP_LOG --> DECISION_LOG
```

### Pool Scoring Pipeline

```mermaid
graph LR
    subgraph "Hard Filters (pre-LLM)"
        F1["Fee/TVL ratio ≥ threshold"]
        F2["TVL within range"]
        F3["Volume ≥ minimum"]
        F4["Organic score ≥ minimum"]
        F5["Holder count ≥ minimum"]
        F6["Mcap within range"]
        F7["Bin step within range"]
        F8["Not blacklisted"]
        F9["Not on cooldown"]
    end

    subgraph "Scoring (0-100)"
        S1["Fee/TVL weight × darwin boost"]
        S2["Organic score weight × boost"]
        S3["Volume weight × boost"]
        S4["Mcap weight × boost"]
        S5["Holder weight × boost"]
        S6["Smart wallet bonus"]
    end

    F1 & F2 & F3 & F4 & F5 & F6 & F7 & F8 & F9 --> |"All pass"| SCORE_FINAL["Final Score"]
    SCORE_FINAL --> RANK["Rank top candidates"]
```

---

## 7. Management Flow

The Management Agent runs every 10 minutes (configurable) to evaluate each open position and act.

```mermaid
flowchart TD
    START["Management Cycle Triggered"]

    START --> GET_POS["get_my_positions()"]
    GET_POS --> ON_CHAIN_DATA["Fetch on-chain positions<br/>+ Meteora PnL API"]
    ON_CHAIN_DATA --> SYNC["syncOpenPositions()<br/>Reconcile with state.json"]

    SYNC --> FOR_EACH{"For each<br/>open position"}

    FOR_EACH --> GET_PNL["get_position_pnl()"]
    Note1["Returns:<br/>- pnl_pct, pnl_usd<br/>- unclaimed_fees_usd<br/>- in_range status<br/>- fee_per_tvl_24h<br/>- age_minutes"]
    GET_PNL --> Note1

    Note1 --> UPDATE_EXIT["updatePnlAndCheckExits()"]
    Note2["Checks:<br/>1. Stop loss (pnl ≤ -X%)<br/>2. Trailing TP (drop from peak ≥ Y%)<br/>3. Out of range > Z minutes<br/>4. Low yield (fee/TVL < min)"]
    UPDATE_EXIT --> Note2

    Note2 --> EXIT_DECISION{"Exit signal?"}

    EXIT_DECISION --> |"STOP_LOSS"| CLOSE
    EXIT_DECISION --> |"TRAILING_TP"| CONFIRM_EXIT["Confirm exit signal<br/>(consecutive ticks)"]
    EXIT_DECISION --> |"OUT_OF_RANGE"| CHECK_OOR["Check OOR duration"]
    EXIT_DECISION --> |"LOW_YIELD"| CLOSE
    EXIT_DECISION --> |"None"| CLAIM_CHECK

    CONFIRM_EXIT --> CLOSE
    CHECK_OOR --> |"Exceeds wait time"| CLOSE
    CHECK_OOR --> |"Within wait"| CLAIM_CHECK

    CLAIM_CHECK["Check unclaimed fees"]
    CLAIM_CHECK --> |"Fees > $5"| CLAIM["claim_fees()"]
    CLAIM --> SWAP_CHECK

    CLAIM_CHECK --> |"Fees < $5"| HOLD["Hold position"]
    SWAP_CHECK["Auto-swap if enabled"]
    SWAP_CHECK --> SWAP["swap_token()<br/>Base token → SOL"]
    SWAP --> HOLD

    CLOSE["close_position()"]
    Note3["Tools:<br/>- Withdraw all liquidity<br/>- Close position account<br/>- Swap base token → SOL"]
    CLOSE --> Note3
    Note3 --> RECORD["recordClose()<br/>(state.json)"]
    RECORD --> PERF["recordPerformance()<br/>(lessons.json)"]
    PERF --> LESSON["Derive lessons"]
    LESSON --> NOTIFY["Telegram report"]

    HOLD --> NEXT["Next position"]
    NEXT --> FOR_EACH

    FOR_EACH --> |"All done"| REPORT["Generate cycle report"]
    REPORT --> NOTIFY2["Send Telegram report"]
```

### Exit Conditions Detail

```mermaid
graph TD
    subgraph "Exit Signal Evaluation"
        POS["Position Data"]
        POS --> |"pnl_pct"| SL["Stop Loss?<br/>pnl ≤ stopLossPct"]
        POS --> |"peak_pnl_pct"| TTP["Trailing TP?<br/>peak - current ≥ trailingDropPct"]
        POS --> |"out_of_range_since"| OOR["Out of Range?<br/>minutes > outOfRangeWaitMinutes"]
        POS --> |"fee_per_tvl_24h"| LY["Low Yield?<br/>fee/TVL < minFeePerTvl24h"]
    end

    subgraph "Confirmation System"
        TICKS["consecutive-tick confirmation"]
        TICKS --> |"2+ matching signals"| FIRES["Exit fires"]
        TICKS --> |"signal clears"| RESET["Reset counter"]
    end

    SL --> |"Yes"| TICKS
    TTP --> |"Yes"| TICKS
    OOR --> |"Yes"| TICKS
    LY --> |"Yes"| TICKS
```

### Trailing Take Profit Flow

```mermaid
graph LR
    DEPLOY["Deploy Position<br/>peak_pnl = 0%"]
    DEPLOY --> |"PnL rises"| PEAK["Update peak_pnl_pct<br/>(confirmed over ticks)"]
    PEAK --> |"peak ≥ triggerPct"| ARM["Trailing TP armed"]
    ARM --> |"PnL drops"| DROP["drop = peak - current"]
    DROP --> |"drop ≥ dropPct"| CLOSE_TTP["Close position"]
    DROP --> |"drop < dropPct"| HOLD_TTP["Hold — still trailing"]
    HOLD_TTP --> |"New peak"| PEAK
```

---

## 8. State Management

### Position Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Deployed: deploy_position()
    Deployed --> InRange: Active bin in range
    Deployed --> OutOfRange: Active bin outside range
    InRange --> OutOfRange: Price moves
    OutOfRange --> InRange: Price recovers
    InRange --> Claiming: claim_fees()
    Claiming --> InRange: Fees claimed
    OutOfRange --> Closing: Close conditions met
    InRange --> Closing: Stop loss / Trailing TP
    Closing --> Closed: close_position()
    Closed --> [*]
```

### Data Files

| File                      | Content                                                   | Updated By                                                              |
| ------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------- |
| `state.json`              | Position registry, OOR tracking, peak PnL, trailing state | `trackPosition()`, `recordClose()`, `markOutOfRange()`, `confirmPeak()` |
| `lessons.json`            | Derived lessons + raw performance records                 | `recordPerformance()`, `addLesson()`                                    |
| `decision-log.json`       | Structured deploy/close/skip rationale                    | `logDecision()`                                                         |
| `signal-weights.json`     | Darwinian signal weights                                  | `recalculateWeights()`                                                  |
| `pool-memory.json`        | Per-pool deploy history + notes                           | `recordPoolDeploy()`, `addPoolNote()`                                   |
| `smart-wallets.json`      | Tracked KOL/alpha wallets                                 | `addSmartWallet()`                                                      |
| `strategy-library.json`   | Saved LP strategies                                       | `addStrategy()`                                                         |
| `token-blacklist.json`    | Blacklisted token mints                                   | `addToBlacklist()`                                                      |
| `deployer-blacklist.json` | Blocked deployer wallets                                  | `blockDev()`                                                            |

---

## 9. Learning & Evolution

### Lesson Pipeline

```mermaid
flowchart TD
    CLOSE["Position Closed"]
    CLOSE --> PERF["Capture Performance Record"]
    PERF --> |"PnL, fees, hold time,<br/>range efficiency, close reason"| ANALYZE["Analyze Outcome"]

    ANALYZE --> |"Significantly good/bad"| DERIVE["Derive Lesson"]
    ANALYZE --> |"Neutral"| RECORD_ONLY["Record only"]

    DERIVE --> TAG["Tag with context:<br/>screening, management,<br/>oor, fees, narrative"]
    TAG --> ROLE["Assign role:<br/>SCREENER / MANAGER / GENERAL"]
    ROLE --> SAVE["Save to lessons.json"]

    SAVE --> INJECT["Injected into next<br/>system prompt"]
```

### Signal Weight Evolution (Darwin)

```mermaid
graph TD
    subgraph "Weight System"
        W1["Signal weights<br/>(all start at 1.0)"]
        W2["Performance window<br/>(60 days)"]
        W3["Recalc every 5 positions"]
    end

    subgraph "Boost / Decay"
        BOOST["Winning signals → boost × 1.05"]
        DECAY["Losing signals → decay × 0.95"]
        FLOOR["Floor: 0.3"]
        CEIL["Ceiling: 2.5"]
    end

    subgraph "Application"
        INJECT_W["Weights injected into<br/>SCREENER system prompt"]
        APPLY_W["Agent prioritizes<br/>high-weight signals"]
    end

    W1 --> W2 --> W3 --> BOOST & DECAY
    BOOST --> FLOOR --> CEIL
    DECAY --> FLOOR --> CEIL
    CEIL --> INJECT_W --> APPLY_W
```

### Threshold Evolution

```mermaid
sequenceDiagram
    participant User
    participant CLI as evolve command
    participant Lessons as Lessons Engine
    participant Config as Config

    User->>CLI: node --import tsx packages/cli/src/Cli.ts evolve
    CLI->>Lessons: analyzePerformance()
    Note right of Lessons: Needs 5+ closed positions<br/>Analyzes win rate, avg PnL,<br/>fee yields per signal

    Lessons->>Lessons: Calculate lift per threshold
    Note right of Lessons: For each screening param:<br/>compare winner vs loser distributions<br/>Find optimal split point

    Lessons->>Config: reloadScreeningThresholds()
    Note right of Config: Hot-reloads user-config.json<br/>New thresholds take effect immediately
```

---

## 10. External Integrations

### Data Flow Diagram

```mermaid
graph TB
    subgraph "Blockchain"
        SOLANA["Solana RPC<br/>(Helius)"]
        METEORA_SDK["@meteora-ag/dlmm<br/>SDK"]
    end

    subgraph "APIs"
        METEORA_PNL["Meteora DLMM<br/>PnL API"]
        POOL_DISC_API["Pool Discovery API<br/>(datapi.meteora.ag)"]
        JUPITER_API["Jupiter API<br/>(token audit, swaps)"]
        GMGN_API["GMGN API<br/>(smart wallet data)"]
        LP_AGENT["LPAgent API<br/>(top LPer study)"]
        AGENT_MERIDIAN["Agent Meridian API<br/>(HiveMind sync)"]
    end

    subgraph "Internal"
        SCREEN_ADV["ScreeningAdapter"]
        METEORA_ADV["MeteoraAdapter"]
        WALLET_ADV["WalletAdapter"]
        TOKEN_ADV["TokenDataAdapter"]
        STUDY_ADV["StudyAdapter"]
        HIVE_ADV["HivemindAdapter"]
    end

    SCREEN_ADV --> POOL_DISC_API
    SCREEN_ADV --> GMGN_API
    METEORA_ADV --> METEORA_SDK
    METEORA_ADV --> SOLANA
    METEORA_ADV --> METEORA_PNL
    WALLET_ADV --> SOLANA
    WALLET_ADV --> JUPITER_API
    TOKEN_ADV --> JUPITER_API
    STUDY_ADV --> LP_AGENT
    HIVE_ADV --> AGENT_MERIDIAN
```

### Discord Signal Pipeline

```mermaid
flowchart TD
    DISCORD["Discord Channel<br/>(LP Army)"]
    DISCORD --> DEDUP["Dedup<br/>(last 10 min)"]
    DEDUP --> |"New token"| BLACKLIST_CHECK["Blacklist check"]
    BLACKLIST_CHECK --> |"Not blacklisted"| RESOLVE["Pool resolution<br/>→ Meteora DLMM pool"]
    RESOLVE --> RUG_CHECK["Rug check<br/>(deployer blacklist)"]
    RUG_CHECK --> |"Clean"| FEES_CHECK["Fees check<br/>(min DISCORD_MIN_FEES_SOL)"]
    FEES_CHECK --> |"Passes"| QUEUE["Queue as pending signal<br/>(discord-signals.json)"]
    QUEUE --> SCREEN["Screening agent<br/>picks up pending signals"]
```

---

## 11. User Interfaces

### Interface Comparison

```mermaid
graph TD
    subgraph "REPL (npm start)"
        R1["Interactive terminal"]
        R2["Live countdown to next cycle"]
        R3["Slash commands: /status, /candidates, /learn"]
        R4["Free-form chat"]
    end

    subgraph "Telegram Bot"
        T1["Remote control"]
        T2["Cycle reports + OOR alerts"]
        T3["Commands: /positions, /close, /set"]
        T4["Free-form chat"]
    end

    subgraph "CLI (meridian <cmd>)"
        C1["Direct tool invocation"]
        C2["JSON output for scripting"]
        C3["Every tool as subcommand"]
    end

    subgraph "Claude Code"
        CC1["Slash commands: /screen, /manage"]
        CC2["Specialized sub-agents"]
        CC3["Loop mode: /loop 30m /screen"]
    end
```

### Tool Categories

| Category                | Tools                                                                     | Used By |
| ----------------------- | ------------------------------------------------------------------------- | ------- |
| **Pool Discovery**      | `discover_pools`, `get_top_candidates`, `search_pools`, `get_pool_detail` | Screen  |
| **Token Research**      | `get_token_info`, `get_token_holders`, `get_token_narrative`              | Screen  |
| **Position Deploy**     | `get_active_bin`, `deploy_position`                                       | Screen  |
| **Position Management** | `get_my_positions`, `get_position_pnl`, `claim_fees`, `close_position`    | Manager |
| **Wallet**              | `get_wallet_balance`, `swap_token`                                        | Both    |
| **Learning**            | `add_lesson`, `list_lessons`, `clear_lessons`, `pin_lesson`               | Both    |
| **Memory**              | `get_pool_memory`, `add_pool_note`                                        | Both    |
| **Smart Wallets**       | `add_smart_wallet`, `check_smart_wallets_on_pool`                         | Screen  |
| **Strategy**            | `add_strategy`, `list_strategies`, `set_active_strategy`                  | Both    |
| **Config**              | `update_config`, `self_update`                                            | General |
| **Blacklist**           | `add_to_blacklist`, `block_deployer`                                      | Both    |
| **Decisions**           | `get_recent_decisions`                                                    | General |
| **Performance**         | `get_performance_history`                                                 | General |
| **Study**               | `study_top_lpers`, `get_top_lpers`                                        | Screen  |

---

## Appendix: Complete Data Flow

```mermaid
graph TB
    subgraph "Every Screening Cycle"
        direction TB
        S1["Cron fires (30 min)"] --> S2["Load pending Discord signals"]
        S2 --> S3["Fetch pool candidates from Discovery API"]
        S3 --> S4["Apply hard filters + score (0-100)"]
        S4 --> S5["Apply signal weight boosts (Darwin)"]
        S5 --> S6["Build system prompt with context"]
        S6 --> S7["LLM evaluates top candidates"]
        S7 --> S8["Deep research: token audit, holders, narrative, smart wallets"]
        S8 --> S9["LLM decides: deploy or skip"]
        S9 --> S10{"Deploy?"}
        S10 --> |"Yes"| S11["On-chain deploy via Meteora SDK"]
        S10 --> |"No"| S12["Log skip decision"]
        S11 --> S13["Track in state.json"]
        S13 --> S14["Log decision in decision-log.json"]
        S14 --> S15["Telegram notification"]
        S12 --> S14
    end

    subgraph "Every Management Cycle"
        direction TB
        M1["Cron fires (10 min)"] --> M2["Fetch on-chain positions + PnL"]
        M2 --> M3["Sync state.json with on-chain"]
        M3 --> M4["For each position:"]
        M4 --> M5["Evaluate exit conditions"]
        M5 --> M6{"Exit signal?"}
        M6 --> |"Yes"| M7["Close position"]
        M6 --> |"No"| M8["Check fee claim threshold"]
        M8 --> |"Claim"| M9["Claim fees + auto-swap"]
        M8 --> |"Hold"| M10["Skip"]
        M7 --> M11["Record close + derive lessons"]
        M9 --> M12["Update state"]
        M10 --> M12
        M12 --> M13["Generate cycle report"]
        M13 --> M14["Telegram report"]
    end

    subgraph "Learning Loop"
        direction TB
        L1["Position closes"] --> L2["Performance recorded"]
        L2 --> L3["Lessons derived"]
        L3 --> L4["Lessons injected into prompt"]
        L4 --> L5["Agent applies lessons"]
        L5 --> L6["5+ positions → evolve thresholds"]
        L6 --> L7["Signal weights recalculated"]
        L7 --> L8["Next screening cycle uses new weights"]
    end
```
