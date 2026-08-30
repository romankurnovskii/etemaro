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

This creates `~/.config/etemaro` and checks the only two keys needed to start in dry-run:

| Variable             | What it is                                              |
| -------------------- | ------------------------------------------------------- |
| `WALLET_PRIVATE_KEY` | Solana wallet base58 key (or `etemaro generate-wallet`) |
| `LLM_API_KEY`        | OpenRouter / OpenAI / compatible LLM key                |

On a terminal it will prompt. On a server without a TTY, paste the keys into `~/.config/etemaro/.env` and run `etemaro init` again.

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
