# apps/web — Etemaro Browser Console (React + Vite)

Single-page React app for the Etemaro daemon, built with Vite and served by the
daemon's IPC server on the same port as the WebSocket (default
`http://127.0.0.1:8765/`). No separate web process is required.

## Develop

```bash
pnpm --filter @etemaro/web dev     # Vite dev server on http://127.0.0.1:5173
```

In dev the app talks to the daemon at `http://127.0.0.1:8765` (override with
`VITE_DAEMON_URL`). Start the daemon with `etemaro serve` or `pnpm run dev`.

## Build

```bash
pnpm --filter @etemaro/web build   # emits apps/web/dist
```

`IpcServer` serves `apps/web/dist` statically, and `pnpm -r build` builds it as
part of the workspace. The root `pre-commit` hook builds before running tests.

## Views

- **Agents** — one-click create, start, stop, and re-target an agent's strategy. Backed by `/api/agents*`.
- **Dashboard** — live state snapshot (PnL, positions, cycle timers).
- **Tools** — the full agent tool catalog with JSON-Schema-driven forms; protected tools require an explicit confirm.
- **Logs / Chat** — live log stream and a direct line to the agent.

## HTTP API (served by IpcServer)

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/health` | Liveness + agent id + tool count (public) |
| GET | `/api/state` | Latest state snapshot |
| GET | `/api/tools` | Tool catalog |
| POST | `/api/tool` | Invoke a tool: `{ "name", "args", "confirm" }` |
| GET | `/api/agents` | List configured agents with running state |
| POST | `/api/agents` | Create an agent: `{ "name" }` |
| POST | `/api/agents/:id/start` | `/stop` | Start / stop an agent child process |
| POST | `/api/agents/:id/strategy` | Set the agent's active strategy |

The browser WebSocket uses the shared IPC protocol (`subscribe:logs`,
`subscribe:state`, `command:chat`, `command:tool`).

## Security

- The daemon binds `127.0.0.1` by default (`connection.ipcHost` to override).
- With `connection.ipcToken`, HTTP needs `Authorization: Bearer` (or `?token=`) and WebSocket clients must `auth` first.
- State-changing tools require `confirm: true`; created agents default to **dry-run**.
- Wallet keystore and `.env` secrets are never exposed through this API.
