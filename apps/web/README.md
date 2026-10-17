# apps/web — Etemaro Browser Console (React + Vite)

Single-page React app for the Etemaro daemon, built with Vite and served by the
daemon's IPC server on the same port as the WebSocket (default
`http://127.0.0.1:8765/`). No separate web process is required.

## Setup and develop

Run commands from the repository root with Node.js 22 or later and **pnpm
9.15.4**, the version pinned in the root `packageManager` field. Install the
workspace dependencies, including the renderer used by the UI tests:

```bash
pnpm --version                   # expected: 9.15.4
pnpm install --frozen-lockfile
```

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

- **Agents** — create, start and stop agents, inspect their individual telemetry,
  and preview a strategy change before saving it for the next start. Backed by
  `/api/agents*` and each child's WebSocket stream.
- **Dashboard** — the connected daemon's state snapshot (PnL, positions and cycle
  timers). This is separate from the individual agent cards.
- **Tools** — the daemon's tool catalog with JSON-Schema-driven forms. Protected
  tools require explicit confirmation. Output can be selected or copied with
  **Copy output**; clipboard failure leaves the output available for manual copy.
- **Logs / Chat** — the daemon's live log stream and chat. Logs support combined
  text, category and severity filters. Severity comes from the producer's `level`
  (`debug`, `info`, `warn`, `error`). Missing or unrecognized severity is
  **Unknown / not reported**, not a guess based on message text. Unknown entries
  remain visible under **All severities**. The log view displays the last 400
  matching entries from its bounded buffer, not an archive.

## Agent isolation and telemetry

Each running agent card opens its own WebSocket using the daemon host/TLS scheme
and that child's configured `ipcPort`. A configured port is not proof that the
child is reachable. Stopped agents and children without a valid TCP port do not
open a child connection. A Unix-socket-only child has no browser TCP endpoint.
State snapshots must match the card's `configPath`, and log entries must match
its agent ID. A card never substitutes the parent daemon's snapshot or another
child's data. Disconnecting clears the current snapshot and heartbeat.

The visualizer reports observations rather than filling gaps with estimated
values:

- **Phases** (`Idle`, `Evaluating`, `Rebalancing`, `Settled`) come from actual
  execution activity and structured tool events. **Settled means an activity or
  tool cycle finished; it does not confirm an on-chain transaction.** Older
  producers without a phase show the available busy/idle state instead.
- **Confidence** (`confidence`) is currently `null` in the daemon telemetry producer, so the UI
  shows **Not reported**. It does not manufacture a score from decision prose.
- **Position range** uses reported lower/upper bins and the current active bin.
  Missing bounds or active-bin observations stay unavailable; a historical
  opening bin is not presented as the current active bin.
- **Asset split** is available only when both X/Y quantities and their mint
  decimals were observed. The API can lack these inputs; in that case
  `assetSplit` is `null` and the UI shows **Not reported**. X/Y are token
  quantities, not comparable USD percentages.
- **PnL** and USD values remain **Not reported** when genuine USD observations
  are missing. A total with `totalPnlUsdKnown: false` is unknown even if its wire
  placeholder is zero; it is not evidence of zero profit or loss.

### Changing a strategy

Choose **Strategy for next start**, then **Preview changes**. The preview reads
the current and proposed strategy through `get_strategy` and displays parameter
differences. **Cancel** closes the preview without a configuration write or
start/stop request. **Save for next start** updates the selected agent's
configuration only. It does **not** restart the process or change a running
agent's strategy in place; stop and start that agent explicitly when you intend
to apply the saved strategy. A stale preview is discarded when its agent,
strategy or authentication context changes.

## HTTP API (served by IpcServer)

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/health` | Liveness + agent id + tool count (public) |
| GET | `/api/state` | Latest state snapshot |
| GET | `/api/tools` | Tool catalog |
| POST | `/api/tool` | Invoke a tool: `{ "name", "args", "confirm" }` |
| GET | `/api/agents` | List configured agents with running state |
| POST | `/api/agents` | Create an agent: `{ "name" }` |
| POST | `/api/agents/:id/start` | Start an agent child process |
| POST | `/api/agents/:id/stop` | Stop an agent child process |
| POST | `/api/agents/:id/strategy` | Save the strategy in configuration for the next start |

The browser WebSocket uses the shared IPC protocol (`subscribe:logs`,
`subscribe:state`, `command:chat`, `command:tool`).

## Authentication

Open **Access token** in the header, enter the daemon IPC token and select
**Use token**. This updates the current tab's connections and authenticated
requests; it does not create or rotate the daemon's token.

- Leave **Remember in this browser** unchecked for session-only use. Submitting
  this choice also removes any previously saved token.
- To persist a token, explicitly check **Remember in this browser** and submit
  **Use token**. It is stored under `etemaro.token` in browser local storage;
  merely typing a token does not save it.
- **Clear token** clears the current tab's token and attempts to remove the
  saved browser value. If browser storage is blocked, the UI reports that the
  storage update failed; the current tab's token still changes.
- A previously saved value can be loaded on startup. A legacy `?token=` link is
  imported for the current session and its token parameter is removed from the
  address bar; it is not automatically persisted. Prefer the token panel to
  putting credentials in links. The header's endpoint label omits URL
  credentials, query parameters and fragments.

- The daemon binds `127.0.0.1` by default (`connection.ipcHost` to override).
- With `connection.ipcToken`, HTTP needs `Authorization: Bearer` (or `?token=`) and WebSocket clients must `auth` first.
- Tools marked protected require `confirm: true`; created agents default to
  **dry-run**. The write/read badge describes the tool's operation, not whether
  confirmation alone makes it safe to run.

## Validation

With the frozen workspace install above, check the web types and production
bundle:

```bash
pnpm --filter @etemaro/web typecheck
pnpm --filter @etemaro/web build
```

Run the focused UI, telemetry and related producer/server regressions:

```bash
pnpm exec vitest run apps/web/src \
  packages/core/src/shared/agent-telemetry.test.ts \
  packages/core/src/shared/ipc-protocol.test.ts \
  packages/core/src/shared/logger.test.ts \
  packages/core/src/domain/decision-log.test.ts \
  packages/core/src/adapters/PnLAdapter.test.ts \
  packages/core/src/adapters/ToolExecutor.test.ts \
  packages/core/src/adapters/ToolExecutor.screening.test.ts \
  packages/core/src/adapters/blockchain/MeteoraAdapter.test.ts \
  packages/daemon/src/Daemon.test.ts \
  packages/daemon/src/server/AgentSupervisor.test.ts \
  packages/daemon/src/server/IpcServer.test.ts
```

These tests use controlled fixtures/mocks and exercise component interactions,
stream attribution, lifecycle cleanup and observed telemetry. They do not run a
live trading daemon or prove real-network transactions. A passing focused suite
or web build is **not** a full-monorepo result. Run the separate workspace checks
when validating the complete repository:

```bash
pnpm test
pnpm typecheck
pnpm build
```
