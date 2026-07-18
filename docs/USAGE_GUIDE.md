# Etemaro — Usage Guide

> **How to run and operate Etemaro.** For the detailed data-flow diagrams (screening, management, agent loop, lifecycle, tool safety, external integrations), see [FULL_FLOW.md](FULL_FLOW.md). For config fields see [CONFIGURATION.md](CONFIGURATION.md), for collective learning see [HIVEMIND.md](HIVEMIND.md), and for the code layout see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## 1. Application Startup

`npm start` (live) or `npm run dev` (dry-run) boots the daemon:

1. Loads `.env` + `config/user-config.json` into a Zod-validated config singleton.
2. Fetches wallet balances and reconciles `state.json` with on-chain positions.
3. Ensures a HiveMind `agentId`, then runs `bootstrapHiveMind()` (registers; pulls shared lessons + presets when `pullMode=auto`) and starts the 15-minute HiveMind background sync — see [HIVEMIND.md](HIVEMIND.md).
4. Initializes the Telegram bot (if `TELEGRAM_BOT_TOKEN` is set).
5. Starts cron jobs: management, screening, health check, daily briefing, PnL poller.
6. Opens the REPL with a live countdown to the next cycle.

The full startup sequence diagram is in [FULL_FLOW.md §3](FULL_FLOW.md#3-startup--initialization).

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

## 2. Screening & Management Cycles

These are the two autonomous loops. Detailed flowcharts live in FULL_FLOW.md:

- **Screening** (default every 30 min) — discovers + hard-filters candidate pools, scores them (Darwin-weighted), and the `SCREENER` LLM decides whether to deploy. Diagram: [FULL_FLOW.md §6](FULL_FLOW.md#6-screening-flow).
- **Management** (default every 10 min) — fetches on-chain PnL, applies 5 deterministic close rules (stop loss, take profit, out-of-range, low yield, plus trailing TP), claims fees, and on close records performance + derives lessons. Diagram: [FULL_FLOW.md §7](FULL_FLOW.md#7-management-flow).

The agent loop, role-based tool access, and tool-execution safety checks are documented in [FULL_FLOW.md §5](FULL_FLOW.md#5-the-agent-loop-react) and [§8/§10](FULL_FLOW.md#8-state-management).

---

## 3. How to Use — Step by Step

### First-time Setup

```bash
# 1. Clone and install
git clone https://github.com/romankurnovskii/etemaro
cd etemaro
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
/hive pull       — pull shared HiveMind lessons now (see HIVEMIND.md)
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

### The Decision Flow — When Does Etemaro Deploy?

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

### The Decision Flow — When Does Etemaro Close?

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

## 4. Quick Reference — Entry Points

| What you want          | How to do it                                                 |
| ---------------------- | ------------------------------------------------------------ |
| Safe testing           | `npm run dev` (DRY_RUN)                                      |
| Live trading           | `npm start` or `npm run pm2:start`                           |
| One-shot screening     | `npm run screen -- --dry-run`                                |
| One-shot management    | `npm run manage -- --dry-run`                                |
| Check balance          | `npm run balance`                                            |
| List positions         | `npm run positions`                                          |
| Deploy manually        | `npm run cli deploy -- --pool <addr> --amount 0.5 --dry-run` |
| Close manually         | `npm run cli close -- --position <addr> --dry-run`           |
| Remote control         | Telegram`/positions`, `/close`, `/screen`                    |
| Learn from history     | `npm run lessons`                                            |
| Auto-evolve thresholds | `npm run evolve`                                             |
| Pull shared lessons    | Telegram`/hive pull` (see [HIVEMIND.md](HIVEMIND.md))        |
