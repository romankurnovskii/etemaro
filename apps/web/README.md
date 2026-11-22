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

The CLI build copies `apps/web/dist` into `packages/cli/dist/web`, so a global
`npm i -g @etemaro/cli` can serve the console without a repo checkout
(`resolveWebDir()` in `packages/core/src/shared/constants.ts`).

## State management

Two layers, split by ownership:

**Server state — TanStack Query** (`src/hooks/`). Anything that comes from the
daemon's HTTP API is cached, deduped and refetched by the query client
(`src/lib/queryClient.ts`).

| Hook | Endpoint | Behaviour |
| --- | --- | --- |
| `useAgentsQuery` | `GET /api/agents` | 15 s `refetchInterval`, paused while the tab is hidden |
| `useAgentMutations` | `POST /api/agents*` | create / start / stop / strategy; invalidates the list on settle |
| `useConfigQuery` | `GET /api/config?path=` | one cache entry per path, 30 s stale time |
| `useSaveConfig` | `PUT /api/config?path=` | invalidates that path on success |
| `useStrategiesQuery` | `POST /api/tool` (`list_strategies`) | 60 s stale time |

Agent links read their config through `queryClient.fetchQuery`, so N agents
sharing a config path and every reconnect reuse one request.

**Client state — zustand** (`src/stores/`). UI and socket state only.

| Store | Owns |
| --- | --- |
| `uiStore` | active tab (synced to `#/tab`), bearer token, tool preselection, connection popover |
| `connectionStore` | console daemon WebSocket: status, snapshot, tool catalog, chat, auth errors |
| `telemetryStore` | one IPC link per *running* agent, keyed by agent id |
| `logsStore` | every log entry, bucketed by the entry's own `agentId` (bounded per agent) |
| `themeStore` | `system` / `light` / `dark`, persisted to `localStorage` |

## Theming

`styles.css` declares every colour with `light-dark()`, so one token block covers
both themes. `color-scheme` decides which value applies:

- no `data-theme` on `<html>` → the OS `prefers-color-scheme` wins
- `data-theme="light"` / `"dark"` → pinned by the header toggle

`themeStore` applies the attribute before the first paint (`main.tsx`), so there
is no flash. Dark values come from the brand dashboard palette
(`#0F0C0A` / `#1A1512` / `#FAF8F5`).

## Components

`src/components/ui/` holds the primitives. Views compose them instead of
hand-writing class names.

| Component | Replaces |
| --- | --- |
| `Button` | `.btn` + `button.primary` / `button.ghost` / `button.danger` |
| `Pill` | `.status-pill` / `.conn-badge` with ad-hoc tone classes |
| `Field` | `<label class="field"><span>…` blocks |

## Brand

The console follows the Etemaro brand mark (`assets/favicon.svg`): olive
`#556B2F` on a warm off-white canvas, sage `#8A9A5B` as the secondary accent.
`components/Logo.tsx` renders the same geometry inline with `currentColor`, and
`public/favicon.svg` is the shared icon. UI text uses self-hosted
`@fontsource-variable/inter` (bundled woff2, no CDN); data uses the system mono
stack. All colours come from the CSS variables at the top of `src/styles.css` —
no ad-hoc hex values in components.

## Bearer token

The token field is **not** needed for the default localhost setup. It exists
because the daemon can require auth when `connection.ipcToken` is set: HTTP then
needs `Authorization: Bearer` and WebSocket clients must `auth` first. The field
lives in the header's **Connection** popover, is stored in `localStorage`
(`etemaro.token`), and opens automatically when the daemon rejects the
credentials. Per-agent tokens are never stored.

## Views

- **Agents** — Agent Visualizer: one card per managed agent with status, inferred loop phase
  (Idle → Evaluating → Rebalancing → Settled), last tool, last decision, and active pool; start/stop; and a
  strategy switch that previews a recursive diff (`get_strategy`) before confirming. Backed by `/api/agents*`.
  Each managed agent is a separate process with its own IPC server (`connection.ipcPort` in its instance
  config), so the console connects to every running agent directly — the console daemon's WebSocket only
  carries its own logs and state. Logs are attributed to a card by exact `agentId` match only. Range bins,
  in-range status, asset split, and uptime are not exposed over IPC and show "—".
- **Dashboard** — live state snapshot (PnL, positions, cycle timers).
- **Tools** — the full agent tool catalog with JSON-Schema-driven forms; protected tools require an explicit confirm.
- **Logs / Chat** — merged live log stream (console daemon + running agents) with info/warn/error, category,
  and agent filters; and a direct line to the console daemon's agent.

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
