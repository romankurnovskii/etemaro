# apps/web — Etemaro Browser Console

Buildless single-page UI served directly by the daemon's IPC server. No bundler, no
build step, no extra port — the same process that serves `ws://127.0.0.1:8765` also
serves this UI and the JSON tool API.

## Run

```bash
etemaro serve            # http://127.0.0.1:8765/
etemaro serve --port 9000 --open
```

Then open the printed URL. The Ink terminal UI (`etemaro attach`) and the browser are
both clients of the same IPC protocol.

## Views

- **Dashboard** — live state snapshot: total PnL, open positions, next screening/management timers, busy flag.
- **Tools** — the full agent tool catalog (auto-derived from the LLM tool schema). Read tools run directly; state-changing tools require an explicit confirm checkbox.
- **Logs** — structured log stream with a text filter.
- **Chat** — send prompts to the agent ReAct loop.
- **Agents** — manage multiple daemon endpoints (one process per wallet/agent). Each agent is a separate daemon; add its URL here to monitor several at once. Set the `ipcToken` here when the daemon requires one.

## HTTP API (served by IpcServer)

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/health` | Liveness + agent id + tool count (always public) |
| GET | `/api/state` | Latest state snapshot |
| GET | `/api/tools` | Tool catalog (name, description, JSON Schema, write/protected flags) |
| POST | `/api/tool` | Invoke a tool: `{ "name": "...", "args": {...}, "confirm": true }` |

WebSocket messages mirror the Ink client: `subscribe:logs`, `subscribe:state`,
`command:chat`, `command:action`, `command:tool`; the server emits `log:entry`,
`state:snapshot`, `tool:catalog`, `tool:result`, `ack`, `error`.

## Security

- The daemon binds `127.0.0.1` by default (`connection.ipcHost` to override). Do not expose it publicly without a token and a reverse proxy.
- When `connection.ipcToken` is set, HTTP requests need `Authorization: Bearer <token>` (or `?token=`) and WebSocket clients must send `auth` first.
- State-changing tools (`WRITE_TOOLS` + `self_update`) require `confirm: true`. Keep dry-run enabled until you are ready for live trades.
- Wallet keystore and `.env` secrets are intentionally **not** exposed through this API.

## Why buildless

Per the project rule to avoid new build systems, this app is plain HTML/CSS/ES modules.
It can be migrated to Vite later without changing the daemon contract.
