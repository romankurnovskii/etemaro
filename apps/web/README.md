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

## Agent Visualizer

Agents is the default view. Fleet cards show the supervisor's process state and
subscribe to each running agent's own IPC port (read from its instance config).
Connections stay on the configured daemon hostname. The inspector never assigns
the console daemon's positions or logs to an unrelated managed agent.

- The loop indicator is **derived** from the agent's `busy` snapshot and structured
  `tool_start` / `tool_finish` / `tool_blocked` events. It is unknown without a snapshot.
- Position bins and range status come from the existing read-only `get_my_positions`
  tool. The selected agent's positions and recent decisions refresh every 15 seconds;
  overlapping requests are prevented and outstanding reads are aborted on selection changes.
- Older daemon versions do not expose LP asset composition or decision confidence.
  These fields show **Not reported**. Optional `token_x_value_usd` / `token_y_value_usd`
  position fields render a USD composition bar; structured log metadata can supply `confidence`.
  No allocation is inferred from wallet balances, bin location, or token quantities.
- Strategy changes fetch both full `get_strategy` records and show a field diff
  before an explicit confirmation updates the instance configuration. The supervisor's
  endpoint saves configuration only: **restart a running agent to load the change**.
- Refresh reloads the fleet and strategy catalog and retries per-agent connections.

The header can save, replace, or remove the existing `etemaro.token` browser-storage
entry. URL tokens are removed from the address after import. WebSocket subscriptions
wait for the matching authentication ACK; invalid credentials stop automatic retries
until the token is changed. Transient disconnects retry with capped exponential backoff.

## Verification

From `apps/web`:

```bash
npm run typecheck
npm run build
npm test            # Node >=22.6; built-in test runner, no added test framework
```

The focused tests cover loop inference, severity mapping, nested strategy diffs, and
agent endpoint validation. Browser acceptance should additionally cover per-agent
data isolation, token replacement, delayed auth ACK, reconnect, create/start/stop,
strategy preview/cancel/confirm/error, tool confirmation reset and output copying,
log search/severity/category filters, and narrow-screen navigation.

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
