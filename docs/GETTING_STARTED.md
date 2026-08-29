# Getting Started with Etemaro

A simple guide to run your first autonomous LP agent on Solana.

---

## 1. Install

### Option A: 1-Line Install (CLI — Recommended)

```bash
curl -fsSL https://etemaro.com/install.sh | sh
```

_Or via npm:_

```bash
npm install -g @etemaro/cli
```

### Option B: Desktop App (macOS)

```bash
brew tap romankurnovskii/awesome-brew
brew trust --cask romankurnovskii/awesome-brew/etemaro
brew install romankurnovskii/awesome-brew/etemaro --cask
```

_(Windows and Linux builds are also available on [GitHub Releases](https://github.com/romankurnovskii/etemaro/releases))_

### Option C: Developer / Source Setup

```bash
git clone https://github.com/romankurnovskii/etemaro
cd etemaro
pnpm install
```

---

## 2. Create a Telegram Bot (optional but recommended)

This lets you control and monitor the agent from your phone.

1. Open Telegram and search for **@BotFather**.
2. Send `/newbot`, follow the prompts, and copy the **token** (looks like `123456:ABC-DEF...`).
3. Send any message to your new bot (required to activate it).
4. To get your **chat ID**:
   - Open in a browser: `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
   - Look for `"chat":{"id":123456789,...}` — that number is your chat ID.
   - (Or use @userinfobot in Telegram.)

---

## 3. Configure Environment Variables

Copy the example files and fill in your values:

```bash
cp .env.example .env
cp config/templates/user-config.example.json config/user-config.json
```

Edit `.env` and set:

> **Desktop App users**: skip manual `.env` editing — you can add these values directly in the app under **Settings → Environment Variables**. The GUI stores them as process envs at runtime.

| Variable                    | What it is                                     | Where to get it                                           |
| --------------------------- | ---------------------------------------------- | --------------------------------------------------------- |
| `WALLET_PRIVATE_KEY`        | Your Solana wallet key (base58 string)         | Export from Phantom / Solflare wallet settings            |
| `JUPITER_API_KEY`           | Jupiter swap API key                           | https://developers.jup.ag/portal/                         |
| `LLM_API_KEY`               | Your AI model API key                          | OpenRouter, OpenAI, or any OpenAI-compatible provider     |
| `LLM_BASE_URL`              | AI model endpoint                              | `https://openrouter.ai/api/v1` (default) or your provider |
| `LLM_MODEL`                 | Model name                                     | e.g. `openrouter/healer-alpha` or `gpt-4o`                |
| `TELEGRAM_BOT_TOKEN`        | Bot token from BotFather                       | Step 2 above                                              |
| `TELEGRAM_CHAT_ID`          | Your Telegram chat ID                          | Step 2 above                                              |
| `TELEGRAM_ALLOWED_USER_IDS` | Restrict bot access to specific Telegram users | Leave empty to allow anyone who knows the bot             |

---

## 4. Choose Your First Strategy

Open `config/user-config.json` and look at the `strategy` section:

```json
"strategy": {
  "strategy": "bid_ask",
  "minBinsBelow": 35,
  "maxBinsBelow": 69,
  "defaultBinsBelow": 69
}
```

**Default: `bid_ask`** — places liquidity on both sides of the current price. This is a safe, standard LP strategy.

If you want something simpler, change `"strategy"` to `"spot"` to place liquidity centered around the current price only.

Keep `dryRun: true` while testing — this simulates trades without spending real SOL.

---

## 5. Run the Agent

```bash
# Test first (no real transactions)
npm run dev

# When ready, go live
npm start
```

You will see a REPL prompt with countdown timers:

```
[manage: 8m 12s | screen: 24m 3s]
>
```

The agent will automatically:

- **Screen** for new pools every 30 minutes
- **Manage** open positions every 10 minutes

If Telegram is configured, you will receive notifications for every deploy, close, and swap.

---

## Quick Health Check

```bash
npm run balance    # Check wallet SOL balance
npm run positions  # See open positions
```

---

## Next Steps

- [Configuration Reference](CONFIGURATION.md) — all available settings
- [Usage Guide](USAGE_GUIDE.md) — commands, Telegram controls, and daily operations
- [QA & FAQ](QA.md) — common questions about dry-run, strategies, and wallet safety
