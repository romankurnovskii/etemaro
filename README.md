# Meridian

**Autonomous Meteora DLMM liquidity management agent for Solana, powered by LLMs.**

Meridian runs continuous screening and management cycles, deploying capital into high-quality Meteora DLMM pools and closing positions based on live PnL, yield, and range data.

---

## 📚 Documentation

Detailed guides are available in the [docs/](docs) directory:

- **[Start Here (Index)](docs/START_HERE.md)** — List of all documents.
- **[Architecture Guide](docs/ARCHITECTURE.md)** — Core TypeScript hexagonal design, ReAct loop, and tools.
- **[Configuration Reference](docs/CONFIGURATION.md)** — Precedence, settings, and the full `user-config.json` [field reference](docs/CONFIGURATION.md#2-user-configuration-user-configjson).
- **[Usage Guide](docs/USAGE_GUIDE.md)** — Step-by-step instructions, REPL commands, and flowcharts.
- **[HiveMind Shared Lessons](docs/HIVEMIND.md)** — Collective-learning sync (shared-lesson pull/push).
- **[Q&A / FAQ](docs/QA.md)** — Frequently asked questions.

---

## 🚀 Quick Start

### 1. Install Dependencies

```bash
git clone https://github.com/yunus-0x/meridian
cd meridian
npm install
```

### 2. Configure Environment

Run the interactive setup wizard:

```bash
npm run setup
```

This will configure your `.env` (API keys, private keys) and `config/user-config.json` (risk profile, thresholds).

### 3. Run

**Option A: Direct (development / dry-run)**

```bash
npm run dev      # Dry-run mode (safe simulation, no real transactions)
npm start        # Live autonomous agent mode
```

**Option B: PM2 (production process manager)**

```bash
npm run pm2:start    # Start daemon under PM2 with auto-restart
npm run pm2:logs     # Tail live logs
```

**Option C: Docker**

```bash
# Development (hot reload, mounts source)
docker compose -f docker-compose.dev.yml up --build

# Production (on remote server, .env.prod already present)
docker compose -f docker-compose.prod.yml up -d --build --force-recreate --remove-orphans
```
