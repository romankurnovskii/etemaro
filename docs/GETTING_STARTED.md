# Getting Started with Etemaro

Two commands. About a minute.

## 1. Install

Need Node.js 22+.

```bash
curl -fsSL https://etemaro.com/install.sh | sh
```

_Or:_ `npm install -g @etemaro/cli`

**Desktop (macOS):** `brew tap romankurnovskii/awesome-brew && brew install --cask romankurnovskii/awesome-brew/etemaro`

**From source:** `git clone https://github.com/romankurnovskii/etemaro && cd etemaro && pnpm install`

## 2. First-time setup

```bash
etemaro init
```

This creates `~/.config/etemaro` and runs the **interactive onboarding wizard**:

1. **Solana Network & RPC** — choose Mainnet (Quickstart/Helius) or custom RPC
2. **Wallet Setup** — choose one:
   - **Generate new wallet** (recommended) — creates fresh keypair, saves to keystore
   - Import existing private key (Base58)
   - Import from Solana CLI keypair file
   - Select existing wallet alias
3. **Strategy Selection** — pick from library (e.g., `bid_ask_wide`, `spot_wide`, `copy_trade_lag`)
4. **Risk & Allocation** — max positions, max SOL per position
5. **(Optional) Telegram Alerts** — bot token

> **Wallet keystore** (recommended): The wizard creates wallets in `~/.config/etemaro/.credentials/wallets/<alias>.json` with `0600` permissions. No private keys in `.env` or process environment.

On a terminal it will prompt. On a server without a TTY, run `etemaro wallet generate --name main-scalp` first, then add `"wallet": "main-scalp"` to your config.

Jupiter, Telegram, and strategy JSON are **not** part of first setup. Add `JUPITER_API_KEY` only when you go live.

Desktop users: paste keys in **Settings → Environment Variables** instead of the CLI.

## 3. Start

```bash
etemaro start --dry-run
```

Default strategy is `bid_ask` with `dryRun: true`. Screening every 30 minutes, management every 10.

When you are ready for live trades: set `JUPITER_API_KEY`, then `etemaro start`.

```
[manage: 8m 12s | screen: 24m 3s]
>
```

## 4. Interactive Dashboard & Live Chat

To see real-time streaming logs, monitor active positions, and converse with the agent:

1. Start the agent (in the background or in a separate terminal):
   ```bash
   etemaro start --dry-run
   # or with PM2:
   pnpm run pm2:start
   ```

2. Attach the interactive terminal UI:
   ```bash
   etemaro attach
   # or from source:
   pnpm run attach
   ```

You will see:
- **Top Header**: Connection status, wallet balances (SOL/USDC), and 24h PnL.
- **Center Log Pane**: Real-time event log stream (screening discoveries, position rebalances, swap simulations).
- **Bottom Chat Prompt**: Type any command or question (e.g., `"explain your current strategy"`, `"show top pool candidates"`, `"trigger screening"`).
- **Detach**: Press `Ctrl+C` to exit the dashboard safely without stopping the trading agent.

## Quick health check

```bash
etemaro balance
etemaro positions
```

---

## Next Steps

- [Configuration Reference](CONFIGURATION.md) — all available settings
- [Usage Guide](USAGE_GUIDE.md) — commands, Telegram controls, and daily operations
- [QA & FAQ](QA.md) — common questions about dry-run, strategies, and wallet safety
