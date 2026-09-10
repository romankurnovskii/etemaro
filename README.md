<p align="center">
  <img src="assets/favicon.svg" alt="Etemaro Logo" width="100" height="100" />
</p>

# Etemaro

An LLM-powered agent that autonomously manages liquidity positions on Meteora DLMM for Solana.

![Desktop](assets/desktop-1.png)

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.22284026.svg)](https://doi.org/10.5281/zenodo.22284026)
[![SSRN](https://img.shields.io/badge/SSRN-7404618-brightgreen)](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=7404618)

Etemaro runs continuous screening and management cycles, deploying capital into high-quality Meteora DLMM pools and closing positions based on live PnL, yield, and range data — all driven by an LLM reasoning over real on-chain state instead of following a fixed rule set.

## Features

- **LLM-driven ReAct loop** — The agent inspects live pool and position data, reasons about risk and yield, then calls tools to deploy, manage, or close positions.
- **HiveMind collective learning** — Agents share lessons and performance events across a fleet, so every instance benefits from what others have learned.
- **Dry-run safe simulation** — Test strategies against real on-chain data without spending gas; mock positions are tracked locally.
- **Multi-surface interface** — CLI for one-shot commands, a Telegram bot for remote control, and a cross-platform desktop app.
- **Strategy library + signal adaptation** — Preset LP strategies with configurable bin distribution; signal weights evolve based on closed-position performance.

---

## Run the agent

Need **Node.js 22+**. Then two commands:

```bash
curl -fsSL https://etemaro.com/install.sh | sh
etemaro init
```

`etemaro init` is first-time setup (~1 minute). It creates `~/.config/etemaro`, checks for a wallet key and an LLM key, and tells you what is missing. Jupiter is only needed later for live swaps.

### Add a wallet

Wallets live in the keystore at `~/.config/etemaro/.credentials/wallets/<alias>.json` (mode `0600`):

```bash
etemaro wallet generate --name etemaro-01-100          # brand-new keypair
etemaro wallet import --name etemaro-01-100 --prompt   # existing Base58 key (hidden prompt)
```

Then point an agent at the alias: `"wallet": "etemaro-01-100"` in its config (`config/user-config.json` or `config/instances/<id>.json`). Inspect with `etemaro wallet list`.

**From a source clone** (no global `etemaro`), prefix with `npm run cli --` — the `--` is required:

```bash
npm run cli -- wallet generate --name etemaro-01-100
npm run cli -- wallet import --name etemaro-01-100 --prompt
```

Without `--`, npm consumes `--name`/`--prompt` as its own flags and errors with `Unknown cli flag`.

When the checklist is green:

```bash
etemaro start --dry-run
```

Live mode (real trades): add `JUPITER_API_KEY`, then `etemaro start`.

_Or install via `npm install -g @etemaro/cli` / `brew install romankurnovskii/awesome-brew/etemaro`._

### Interactive Dashboard & Live Chat (`etemaro attach`)

To monitor the agent with a real-time terminal UI, stream live logs, and chat with it in plain English:

1. **Start the agent** (in background or via PM2):
   ```bash
   etemaro start --dry-run
   # or with PM2 (24/7 background):
   pnpm run pm2:start
   ```
2. **Attach the interactive CLI**:
   ```bash
   etemaro attach
   # or from source:
   pnpm run attach
   ```

Inside the interactive terminal dashboard:
- **Status & PnL** — Live wallet balance, open DLMM positions, 24h PnL, and next screening/management countdown timers.
- **Log Stream** — Color-coded real-time log stream without stdout scraping or file tailing.
- **Agent Chat** — Type instructions or questions at the bottom prompt (`what pools are you watching?`, `run screen`, `why did you close position 1?`).
- **Detach** — Press `Ctrl+C` to detach at any time; the trading daemon continues running in the background.

> Common questions: **[docs/QA.md](docs/QA.md)**.

---

### Browser UI (`etemaro serve`)

Prefer a browser over the terminal? Start the agent headlessly and open the built-in console:

```bash
etemaro serve --open      # http://127.0.0.1:8765/
```

- **Dashboard** — live positions, PnL, and cycle timers.
- **Tools** — run any of the agent's tools (same catalog the LLM uses); state-changing tools require an explicit confirm.
- **Logs / Chat / Agents** — stream logs, chat with the agent, and monitor multiple agent endpoints.

The UI is served by the daemon itself on the IPC port (no extra process); `etemaro attach` and the browser share the same protocol. See [apps/web/README.md](apps/web/README.md).

---

### Desktop App (GUI)

- **macOS (via Homebrew)**:
  ```bash
  brew tap romankurnovskii/awesome-brew
  brew trust --cask romankurnovskii/awesome-brew/etemaro
  brew install romankurnovskii/awesome-brew/etemaro --cask
  ```
- **Windows / Linux / macOS (Direct Download)**:
  Download the latest installer or bundle from [GitHub Releases](https://github.com/romankurnovskii/etemaro/releases).

---

### Developer / Source Setup

```bash
# 1. Clone repo & install dependencies
git clone https://github.com/romankurnovskii/etemaro
cd etemaro
pnpm install

# 2. Initialize configuration (.env and user-config.json)
pnpm cli init

# 3. Start in dry-run mode
pnpm run dev
```

---

## Server

Same two commands on a VPS. Keep the process running with tmux, systemd, or:

```bash
nohup etemaro start --dry-run >> ~/.config/etemaro/data/agent.out 2>&1 &
```

Clone + PM2 / Docker is **[source setup](#developer--source-setup)** above.

---

## Documentation & Guides

- ❓ **[Q&A / FAQ Guide](docs/QA.md)** — Frequently asked questions covering setup, multi-instance deployment, dry runs, smart wallets, and PnL metrics (most user questions are covered here).
- 🚀 **[Getting Started Guide](docs/GETTING_STARTED.md)** — Step-by-step first-time setup, environment variables, strategy selection.
- 📖 **[Usage Guide](docs/USAGE_GUIDE.md)** — Daily operations, CLI commands, Telegram bot controls, REPL, and decision flows.
- 🏗️ **[Architecture Guide](docs/ARCHITECTURE.md)** — System layout, domain boundaries, adapter layer, and state management.
- ⚙️ **[Configuration Reference](docs/CONFIGURATION.md)** — Exhaustive configuration reference for `user-config.json`.
- 🧠 **[HiveMind Guide](docs/HIVEMIND.md)** — Fleet learning, lesson sharing, and shared presets.
- 💻 **[Desktop App](apps/desktop)** — Tauri-based cross-platform desktop UI.
