# Meridian — Flow Diagrams & Usage Guide

> This document shows **how data flows through the system** from startup to position close,
> and **how to use the application** at each stage. For config reference and architecture details,
> see [README.md](../README.md), [ARCHITECTURE.md](ARCHITECTURE.md), and [CONFIGURATION.md](CONFIGURATION.md).

---

## Table of Contents

1. [Application Startup](#1-application-startup)
2. [Screening Cycle Flow](#2-screening-cycle-flow)
3. [Management Cycle Flow](#3-management-cycle-flow)
4. [Agent Loop (ReAct)](#4-agent-loop-react)
5. [Position Lifecycle](#5-position-lifecycle)
6. [Tool Execution & Safety](#6-tool-execution--safety)
7. [How to Use — Step by Step](#7-how-to-use--step-by-step)

---

## 1. Application Startup

What happens when you run `npm start` or `npm run dev`.

```mermaid
flowchart TD
    A["node index.js"] --> B{DRY_RUN?}
    B -->|true| C["Mode: DRY RUN\nNo on-chain transactions"]
    B -->|false| D["Mode: LIVE\nReal SOL at risk"]
    C --> E[Load .env + user-config.json]
    D --> E
    E --> F[ensureAgentId]
    F --> G["bootstrapHiveMind()\n(fire-and-forget)"]
    G --> H["startHiveMindBackgroundSync()\nevery 15 min"]
    H --> I{REPL attached?}
    I -->|yes| J["Interactive REPL\nType commands or chat"]
    I -->|no| K["Headless daemon\nPM2 / cron only"]
    J --> L[startCronJobs]
    K --> L
    L --> M["Management cron\n*/N min"]
    L --> N["Screening cron\n*/N min"]
    L --> O["Health check\nevery hour"]
    L --> P["Briefing\n1:00 AM UTC daily"]
    L --> Q["PnL poller\nevery 30 seconds"]
```

**How to use:**

```bash
npm run dev        # DRY_RUN=true — safe testing, no real transactions
npm start          # LIVE mode — real SOL deployed
npm run pm2:start  # Headless daemon for VPS (24/7)
```

The REPL prompt shows countdown timers to the next cycle:
```
[manage: 8m 12s | screen: 24m 3s]
>
```

---

## 2. Screening Cycle Flow

The most complex flow — finds pools, evaluates them, and optionally deploys capital.

```mermaid
flowchart TD
    START["Screening Cycle Triggered\n(cron or manual)"] --> GUARD{Busy or\nmax positions?}
    GUARD -->|yes| SKIP1["SKIP\nLog + decision entry"]
    GUARD -->|no| PRE["Pre-checks (parallel)"]

    PRE --> POS["getMyPositions\n(position count)"]
    PRE --> WAL["getWalletBalances\n(SOL balance)"]

    POS --> GUARD2{Positions >= maxPositions?}
    WAL --> GUARD3{SOL < deployAmount + gasReserve?}
    GUARD2 -->|yes| SKIP2["SKIP — max reached"]
    GUARD3 -->|yes| SKIP3["SKIP — insufficient SOL"]

    GUARD2 -->|no| CAND
    GUARD3 -->|no| CAND

    CAND["getTopCandidates(limit=10)\nHard filters applied:\nTVL, fee/TVL, organic,\nholders, mcap, bin step,\ncooldowns, blacklists"]

    CAND --> RECON["Sequential Recon (150ms throttle)\nFor each candidate:"]

    RECON --> SW["checkSmartWalletsOnPool"]
    RECON --> NT["getTokenNarrative"]
    RECON --> TI["getTokenInfo\n(Jupiter audit)"]
    RECON --> AB["getActiveBin\n(pre-fetch)"]

    SW --> FILTER["Post-recon Hard Filters:\n- blocked launchpads\n- bot holders > max"]
    NT --> FILTER
    TI --> FILTER
    AB --> FILTER

    FILTER --> ZERO{Passing\ncandidates?}
    ZERO -->|0| NO["NO DEPLOY\nRecord decision + rejected list"]

    ZERO -->|1| LONE{Lone candidate\nskip check}
    LONE -->|skip| NO2["NO DEPLOY\nSmart wallet? Narrative?\nPVP conflict?"]
    LONE -->|pass| BUILD

    ZERO -->|2+| BUILD["Build compact candidate blocks\nInclude: metrics, audit, smart wallets,\nnarrative, memory, active_bin"]

    BUILD --> SIGNALS{"Darwin enabled?"}
    SIGNALS -->|yes| STAGE["stageSignals()\nCapture: organic, fee_tvl,\nvolume, mcap, holders, etc."]
    SIGNALS -->|no| LLM
    STAGE --> LLM

    LLM["agentLoop(SCREENER role)\nLLM evaluates candidates\ntool_choice: required\non step 0"]

    LLM --> DECIDE{LLM decision}
    DECIDE -->|"deploy_position"| DEPLOY["Execute deploy\n+ safety checks"]
    DECIDE -->|"No deploy"| NO3["NO DEPLOY\nLLM reasoning"]

    DEPLOY --> POST["Post-deploy:\ntrackPosition()\nappendDecision()\nnotifyDeploy (Telegram)"]

    POST --> REPORT["Send report to Telegram\n(if enabled)"]
    NO --> REPORT
    NO2 --> REPORT
    NO3 --> REPORT
```

**How to use:**

```bash
# One-shot screening from CLI
npm run screen -- --dry-run

# From Telegram
/screen

# From Claude Code
/screen
```

---

## 3. Management Cycle Flow

Evaluates every open position against deterministic rules. LLM only for edge cases.

```mermaid
flowchart TD
    START["Management Cycle Triggered\n(cron or manual)"] --> GUARD{Busy?}
    GUARD -->|yes| SKIP["SKIP"]
    GUARD -->|no| FETCH["getMyPositions(force=true)\nFresh on-chain snapshot"]

    FETCH --> ZERO{Open\npositions?}
    ZERO -->|0| TRIGGER["Trigger screening cycle\n(need deployments)"]
    ZERO -->|1+| SNAPSHOT

    SNAPSHOT["For each position:\nrecordPositionSnapshot()\nrecallForPool()"]

    SNAPSHOT --> EXIT["updatePnlAndCheckExits()\nDetects: STOP_LOSS, TRAILING_TP,\nOUT_OF_RANGE, LOW_YIELD"]

    EXIT --> RULES["getDeterministicCloseRule()\n5 hard rules (no LLM):"]

    RULES --> R1{"Rule 1: pnl <= stopLoss?"}
    R1 -->|yes| CLOSE["ACTION = CLOSE\n(reason: stop loss)"]
    R1 -->|no| R2{"Rule 2: pnl >= takeProfit?"}
    R2 -->|yes| CLOSE2["ACTION = CLOSE\n(reason: take profit)"]
    R2 -->|no| R3{"Rule 3: active_bin > upper_bin\n+ binsToClose?"}
    R3 -->|yes| CLOSE3["ACTION = CLOSE\n(reason: pumped above range)"]
    R3 -->|no| R4{"Rule 4: OOR > waitMinutes?"}
    R4 -->|yes| CLOSE4["ACTION = CLOSE\n(reason: out of range)"]
    R4 -->|no| R5{"Rule 5: yield < minFeePerTvl\nAND age >= 60min?"}
    R5 -->|yes| CLOSE5["ACTION = CLOSE\n(reason: low yield)"]
    R5 -->|no| CLAIM

    CLAIM{Fees >= minClaimAmount?}
    CLAIM -->|yes| CLAIM_A["ACTION = CLAIM"]
    CLAIM -->|no| INSTR{Has instruction?}
    INSTR -->|yes| INST_A["ACTION = INSTRUCTION\n(needs LLM)"]
    INSTR -->|no| STAY["ACTION = STAY"]

    CLOSE --> EXEC
    CLOSE2 --> EXEC
    CLOSE3 --> EXEC
    CLOSE4 --> EXEC
    CLOSE5 --> EXEC
    CLAIM_A --> EXEC

    EXEC["executeManagementActions()\nDirect tool calls — NO LLM for\nmechanical CLOSE/CLAIM"]

    INST_A --> LLM["agentLoop(MANAGER role)\nLLM evaluates instruction condition\nagainst live data"]

    LLM --> EXEC

    EXEC --> POST["Post-close:\nrecordClose()\nrecordPerformance()\nauto-swap base→SOL\nappendDecision()\npushHiveMind()"]

    POST --> SCREEN{"Positions < max\nAND cooldown passed?"}
    SCREEN -->|yes| TRIGGER2["Trigger screening cycle"]
    SCREEN -->|no| REPORT

    STAY --> REPORT
    TRIGGER2 --> REPORT
    REPORT["Send management report\n+ OOR alerts to Telegram"]
```

**The 5 Deterministic Close Rules** (applied in order, no LLM needed):

| Rule | Condition | Action |
|------|-----------|--------|
| 1 | `pnl_pct <= stopLossPct` (-15%) | CLOSE — stop loss |
| 2 | `pnl_pct >= takeProfitPct` (5%) | CLOSE — take profit |
| 3 | `active_bin > upper_bin + binsToClose` | CLOSE — pumped above range |
| 4 | `OOR > outOfRangeWaitMinutes` (30m) | CLOSE — out of range too long |
| 5 | `fee_per_tvl_24h < minFeePerTvl24h` AND `age >= 60min` | CLOSE — low yield |

**How to use:**

```bash
# One-shot management from CLI
npm run manage -- --dry-run

# From Telegram
/positions     # see all open positions
/close 1       # close position by list index

# From Claude Code
/manage
```

---

## 4. Agent Loop (ReAct)

The core ReAct loop that powers every LLM-driven cycle.

```mermaid
flowchart TD
    GOAL["agentLoop(goal, maxSteps,\nhistory, agentType, model)"] --> DATA["Load live data:\n- getWalletBalances()\n- getMyPositions()\n- getStateSummary()\n- getLessonsForPrompt()\n- getPerformanceSummary()\n- getDecisionSummary()"]

    DATA --> PROMPT["buildSystemPrompt()\nRole-specific system prompt\nwith live data injected"]

    PROMPT --> TOOLS["getToolsForRole()\nFilter tools by role:\nSCREENER / MANAGER / GENERAL"]

    TOOLS --> LOOP["for step = 0 to maxSteps:"]
    LOOP --> API["Call LLM API\nOpenRouter / local / any\nOpenAI-compatible endpoint"]

    API --> RETRY{Transient\nerror?}
    RETRY -->|502/503/529| FALLBACK["Swap to fallback model\nafter 2nd attempt"]
    RETRY -->|system role rejected| EMBED["Switch to\nuser_embedded mode"]
    RETRY -->|no| RESPONSE

    FALLBACK --> API
    EMBED --> API

    RESPONSE["Parse response"] --> HAS_TOOLS{Tool calls?}

    HAS_TOOLS -->|yes| REPAIR["jsonrepair()\nFix malformed JSON args"]

    REPAIR --> ONCE{Already fired\nthis session?}
    ONCE -->|yes| BLOCKED["Return blocked=true\nto LLM (try something else)"]
    ONCE -->|no| SAFETY

    SAFETY["executeTool()\nSafety checks for\nprotected tools"]

    SAFETY --> PROTECTED{Protected\ntool?}
    PROTECTED -->|yes| CHECK["runSafetyChecks():\n- Pool thresholds fresh?\n- SOL balance sufficient?\n- Bin-array rent check?"]
    PROTECTED -->|no| RUN

    CHECK -->|fail| ERROR["Return error to LLM"]
    CHECK -->|pass| RUN

    RUN["toolMap[name](args)\nExecute the actual tool"]

    RUN --> SIDE["Post-tool side effects:\n- Telegram notifications\n- Pool memory annotation\n- Auto-swap on close\n- Audit logging"]

    SIDE --> RESULT["Return result to LLM"]
    BLOCKED --> RESULT
    ERROR --> RESULT

    RESULT --> LOOP

    HAS_TOOLS -->|no| CHECK2{"Must use\ntool?"}
    CHECK2 -->|yes| REMIND["Inject reminder:\n'You must call the tool'"]
    CHECK2 -->|no| DONE["Return final text\nresponse"]
    REMIND --> LOOP
```

**Role-based tool access:**

| Role | Available Tools | When Used |
|------|----------------|-----------|
| `SCREENER` | deploy_position, get_top_candidates, get_active_bin, check_smart_wallets_on_pool, get_token_holders, get_token_narrative, get_token_info, search_pools, get_pool_memory, get_wallet_balance, get_my_positions | Every 30 min (cron) |
| `MANAGER` | close_position, claim_fees, swap_token, get_position_pnl, get_my_positions, get_wallet_balance | Every 10 min (cron) |
| `GENERAL` | Intent-matched subset (17 intents) | REPL, Telegram, Claude Code |

---

## 5. Position Lifecycle

The complete journey of a deployed position from creation to close.

```mermaid
stateDiagram-v2
    [*] --> Finding: Screening Cycle

    Finding --> Deploying: LLM picks candidate
    Deploying --> Active: deploy_position() success

    state Active {
        [*] --> InRange
        InRange --> OutOfRange: price moved
        OutOfRange --> InRange: price returned
        OutOfRange --> OOR_Warning: > outOfRangeWaitMinutes
    }

    Active --> Claiming: fees >= minClaimAmount
    Claiming --> Active: fees claimed

    Active --> Closing: Stop Loss / Take Profit / OOR / Low Yield
    Active --> Closing: Instruction condition met

    Closing --> Swapping: auto-swap base→SOL
    Swapping --> Recorded: position closed

    Recorded --> Learning: recordPerformance()
    Learning --> Lessons: derive lesson
    Lessons --> [*]: lessons injected into future cycles
```

**Position data flow:**

```
Deploy ──────► trackPosition() ──────► state.json
                                          │
Manage cycle ◄── getMyPositions() ◄───────┤
     │                                     │
     ├── updatePnlAndCheckExits() ◄────────┘
     ├── recordPositionSnapshot() ──► pool-memory.json
     └── close ──► recordClose() ──► state.json
                   │
                   ├── recordPerformance() ──► lessons.json
                   ├── auto-swap ──► Jupiter
                   ├── appendDecision() ──► decision-log.json
                   └── pushHiveMind() ──► Agent Meridian API
```

---

## 6. Tool Execution & Safety

Every tool call goes through `executeTool()` which adds safety layers for protected operations.

```mermaid
flowchart LR
    CALL["executeTool(name, args)"] --> IS_PROTECTED{Protected tool?}

    IS_PROTECTED -->|no| DIRECT["toolMap[name](args)"]
    IS_PROTECTED -->|yes| SAFETY

    subgraph SAFETY[" runSafetyChecks() "]
        direction TB
        S1["1. Pool thresholds fresh?\n(fetch fresh pool detail)"]
        S2["2. TVL within range?"]
        S3["3. Fee/TVL ratio valid?"]
        S4["4. Volatility acceptable?"]
        S5["5. Bin step in [80-125]?"]
        S6["6. SOL balance sufficient?\n(deploy + gasReserve)"]
        S7["7. Bin-array init rent\nnot charged"]
    end

    S1 --> PASS{All pass?}
    PASS -->|yes| DIRECT
    PASS -->|no| REJECT["Return error\n(deploy blocked)"]

    DIRECT --> POST["Post-tool effects"]
    POST --> NOTIFY["Telegram notifications"]
    POST --> AUDIT["logAction() → audit JSONL"]
    POST --> POOLMEM["Auto-annotate pool memory\n(on low yield close)"]
    POST --> AUTOSWAP["Auto-swap base→SOL\n(on close)"]
```

**Protected tools** (require safety checks):
- `deploy_position`
- `close_position`
- `claim_fees`
- `swap_token`
- `self_update`

**Once-per-session locks** (prevent duplicate actions):
- `deploy_position` — locked on first attempt (even if failed)
- `swap_token` — locked on success only
- `close_position` — locked on success only

---

## 7. How to Use — Step by Step

### First-time Setup

```bash
# 1. Clone and install
git clone https://github.com/yunus-0x/meridian
cd meridian
npm install

# 2. Run the interactive wizard (creates .env + user-config.json)
npm run setup
# You'll choose a preset (degen/moderate/safe) and enter:
#   - Solana wallet private key
#   - RPC URL (Helius recommended)
#   - OpenRouter API key
#   - Telegram bot token (optional)
#   - Strategy preferences

# 3. Test in dry-run mode
npm run dev
# This starts the REPL + cron but skips all on-chain transactions
```

### Day-to-Day Operations

**Autonomous mode** (hands-off):
```bash
npm start          # Live mode with REPL
npm run pm2:start  # Headless daemon for VPS
```

**One-shot CLI** (scripting / debugging):
```bash
npm run balance                              # Check wallet
npm run positions                            # Open positions
npm run candidates -- --limit 5              # Top pool candidates
npm run cli pnl -- <position_address>        # PnL for a position
npm run screen -- --dry-run                  # Run one screening cycle
npm run manage -- --dry-run                  # Run one management cycle
npm run cli deploy -- --pool <addr> --amount 0.5 --dry-run
npm run cli close -- --position <addr> --dry-run
npm run cli swap -- --from <mint> --to SOL --amount 100 --dry-run
npm run lessons                              # View learned lessons
npm run evolve                               # Auto-adjust thresholds
```

**Telegram commands** (remote control):
```
/status          — wallet balance + open positions
/positions       — detailed position list with PnL
/close <n>       — close position by index
/set <n> <text>  — set instruction on a position
/screen          — trigger screening cycle
/candidates      — show top candidates
/briefing        — generate daily report
/pause           — pause cron jobs
/resume          — resume cron jobs
```

**Claude Code** (AI-powered terminal):
```bash
claude              # Start Claude Code in repo dir
/screen             # Full AI screening cycle
/manage             # Full AI management cycle
/balance            # Wallet check
/positions          # Position list
/candidates         # Enriched candidate research
```

### The Decision Flow — When Does Meridian Deploy?

```
Cron fires screening cycle
        │
        ├── Enough positions open? → SKIP
        ├── Enough SOL? → SKIP
        ├── Find top candidates via Meteora API
        │     ├── Filter by: TVL, fee/TVL, organic score,
        │     │   holders, mcap, bin step, cooldowns, blacklists
        │     └── Enrich each: smart wallets, narrative, token audit
        ├── Post-recon filters: launchpad, bot holders
        ├── Zero candidates? → NO DEPLOY
        ├── One candidate? → skip if weak (no smart wallet, no narrative)
        └── LLM evaluates → picks best or says NO DEPLOY
              └── deploy_position() → trackPosition() → Telegram notify
```

### The Decision Flow — When Does Meridian Close?

```
Cron fires management cycle
        │
        ├── Fetch all positions fresh from chain
        ├── For each position, check in order:
        │     1. Stop loss (pnl <= -15%)? → CLOSE
        │     2. Take profit (pnl >= 5%)? → CLOSE
        │     3. Pumped above range? → CLOSE
        │     4. OOR > 30 minutes? → CLOSE
        │     5. Low yield (< 0.55% fee/TVL 24h)? → CLOSE
        │     6. Has instruction? → LLM evaluates condition
        │     7. Fees >= min claim? → CLAIM
        │     8. None of above → STAY
        ├── Execute CLOSE/CLAIM directly (no LLM)
        ├── LLM only for INSTRUCTION positions
        └── After close: auto-swap base→SOL, record lesson
```

---

## Quick Reference — Entry Points

| What you want | How to do it |
|---|---|
| Safe testing | `npm run dev` (DRY_RUN) |
| Live trading | `npm start` or `npm run pm2:start` |
| One-shot screening | `npm run screen -- --dry-run` |
| One-shot management | `npm run manage -- --dry-run` |
| Check balance | `npm run balance` |
| List positions | `npm run positions` |
| Deploy manually | `npm run cli deploy -- --pool <addr> --amount 0.5 --dry-run` |
| Close manually | `npm run cli close -- --position <addr> --dry-run` |
| Remote control | Telegram `/positions`, `/close`, `/screen` |
| Learn from history | `npm run lessons` |
| Auto-evolve thresholds | `npm run evolve` |
