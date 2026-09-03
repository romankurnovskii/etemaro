<p align="center">
  <img src="assets/favicon.svg" alt="Etemaro Logo" width="100" height="100" />
</p>

# Etemaro

An LLM-powered agent that autonomously manages liquidity positions on Meteora DLMM for Solana.

![Desktop](assets/desktop-1.png)

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.22284026.svg)](https://doi.org/10.5281/zenodo.22284026)

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

When the checklist is green:

```bash
etemaro start --dry-run
```

Live mode (real trades): add `JUPITER_API_KEY`, then `etemaro start`.

_Or install via `npm install -g @etemaro/cli` / `brew install romankurnovskii/awesome-brew/etemaro`._

> Common questions: **[docs/QA.md](docs/QA.md)**.

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
