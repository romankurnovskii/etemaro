# Meridian

**Autonomous Meteora DLMM liquidity management agent for Solana, powered by LLMs.**

Meridian runs continuous screening and management cycles, deploying capital into high-quality Meteora DLMM pools and closing positions based on live PnL, yield, and range data.

---

## 📚 Documentation
Detailed guides are available in the [docs/](docs) directory:
* **[Start Here (Index)](docs/START_HERE.md)** — List of all documents.
* **[Architecture Guide](docs/ARCHITECTURE.md)** — Core TypeScript hexagonal design, ReAct loop, and tools.
* **[Configuration Reference](docs/CONFIGURATION.md)** — Precedence, settings, and the full `user-config.json` [field reference](docs/CONFIGURATION.md#2-user-configuration-user-configjson).
* **[Usage Guide](docs/USAGE_GUIDE.md)** — Step-by-step instructions, REPL commands, and flowcharts.
* **[HiveMind Shared Lessons](docs/HIVEMIND.md)** — Collective-learning sync (shared-lesson pull/push).
* **[Q&A / FAQ](docs/QA.md)** — Frequently asked questions.

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
```bash
npm run dev      # Dry-run mode (safe simulation, no real transactions)
npm start        # Live autonomous agent mode
```
