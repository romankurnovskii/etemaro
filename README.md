# Etemaro

An LLM-powered agent that autonomously manages liquidity positions on Meteora DLMM for Solana.

![Desktop](assets/desktop-1.png)

Etemaro runs continuous screening and management cycles, deploying capital into high-quality Meteora DLMM pools and closing positions based on live PnL, yield, and range data — all driven by an LLM reasoning over real on-chain state instead of following a fixed rule set.

## Features

- **LLM-driven ReAct loop** — The agent inspects live pool and position data, reasons about risk and yield, then calls tools to deploy, manage, or close positions.
- **HiveMind collective learning** — Agents share lessons and performance events across a fleet, so every instance benefits from what others have learned.
- **Dry-run safe simulation** — Test strategies against real on-chain data without spending gas; mock positions are tracked locally.
- **Multi-surface interface** — CLI for one-shot commands, a Telegram bot for remote control, and a cross-platform desktop app.
- **Strategy library + signal adaptation** — Preset LP strategies with configurable bin distribution; signal weights evolve based on closed-position performance.

## Quick start

```bash
git clone https://github.com/romankurnovskii/etemaro
cd etemaro
npm install
npm run setup
npm run dev
```

**Option A: PM2 (production process manager)**

```bash
npm run build
npm run pm2:start    # Start daemon under PM2 with auto-restart
npm run pm2:logs     # Tail live logs
```

**Option B: Docker**

```bash
# Development (hot reload, mounts source)
docker compose -f docker-compose.dev.yml up --build

# Production (on remote server, .env already present)
docker compose -f docker-compose.prod.yml up -d --build --force-recreate --remove-orphans
```

## Links

- [Architecture Guide](docs/ARCHITECTURE.md)
- [Configuration Reference](docs/CONFIGURATION.md)
- [Usage Guide](docs/USAGE_GUIDE.md)
- [Desktop App](apps/desktop)
