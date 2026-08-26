# Meridian — HiveMind Shared Lessons (Collective Learning)

HiveMind uses Meridian's **collective learning sync**. Agents register with a shared backend, periodically **pull** lessons and strategy presets contributed by the wider fleet, and **push** their own derived lessons + closed-position performance back to the pool. Pulled lessons are injected into the agent's system prompt so every instance benefits from what others have learned.

> Source of truth: `packages/core/src/adapters/external/HivemindAdapter.ts`. Lifecycle wiring: `packages/daemon/src/Daemon.ts`.

---

## 1. Enabling HiveMind

HiveMind is enabled when `hiveMind.enabled` is `true` and both a URL and an API key are present:

- `isHiveMindEnabled()` checks `hiveMind.enabled`, `hiveMind.url`, and `hiveMind.apiKey` — `HivemindAdapter.ts:140-142`.
- The canonical config uses nested `hiveMind.url` and `hiveMind.apiKey`, with an `HIVEMIND_API_KEY` environment fallback.
- A unique `agentId` is generated automatically on first run (format `agt_<hex>`) if absent, and written back to `user-config.json` — `HivemindAdapter.ts:85-98`, `ensureAgentId()`.

If HiveMind is disabled, every pull/push call short-circuits to `null` and the feature is a no-op.

---

## 2. Configuration Fields

| Field      | Purpose                                                                                      | Example / what to expect                                                                                |
| ---------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `enabled`  | Explicitly enable HiveMind synchronization.                                                  | `true` → active when URL and key are also configured.                                                   |
| `url`      | Base URL of the HiveMind backend.                                                            | `"https://api.agentmeridian.xyz"`                                                                       |
| `apiKey`   | Auth key sent as the `x-api-key` header. Falls back to `HIVEMIND_API_KEY` env.               | Missing/empty → disabled.                                                                               |
| `pullMode` | `auto` (default) or `manual`. Controls whether lessons are pulled on startup + periodically. | `"auto"` → continuous sync. `"manual"` → only pulled on demand via `/hive pull` (see §4).               |
| `agentId`  | Stable instance identity. Leave empty to auto-generate.                                      | `""` → a new `agt_...` id is written on startup. A fixed string persists your identity across restarts. |

Type definition: `HiveMindConfig` at `packages/core/src/shared/types.ts:647-652`.

---

## 3. Pull Flow (Startup + Periodic)

Lessons and presets are pulled in **two** places:

### On startup — `bootstrapHiveMind()`

Called from `Daemon.start()` at `Daemon.ts:260`. It fires-and-forgets and:

1. Registers the agent (`reason: "startup"`).
2. If `pullMode === "auto"`, pulls lessons (`pullHiveMindLessons()`) **and** presets (`pullHiveMindPresets()`) — `HivemindAdapter.ts:271-284`.

### Periodically — `startHiveMindBackgroundSync()`

Called from `Daemon.start()` at `Daemon.ts:263`. It starts a heartbeat `setInterval` every `HEARTBEAT_INTERVAL_MS = 15 * 60 * 1000` (15 minutes) — `HivemindAdapter.ts:13`, `286-298`. Each tick re-registers the agent and, when `pullMode === "auto"`, re-pulls lessons + presets.

```
Daemon.start()
  ├─ bootstrapHiveMind()        (fire-and-forget)
  │     ├─ registerHiveMindAgent("startup")
  │     └─ [auto] pullHiveMindLessons() + pullHiveMindPresets()
  └─ startHiveMindBackgroundSync()   every 15 min
        ├─ registerHiveMindAgent("heartbeat")
        └─ [auto] pullHiveMindLessons() + pullHiveMindPresets()
```

### Caching

Pulled lessons are normalized and written to `data/hivemind-cache.json` (`sharedLessons`, `presets`, `pulledAt`) — `HivemindAdapter.ts:11`, `240-246`. The prompt reader reads from this cache, **not** the network, so injection is cheap and works offline between pulls.

---

## 4. Manual Pull (Telegram)

When `pullMode === "manual"` (or for an on-demand refresh), send `/hive pull` in Telegram. The handler (`Daemon.ts:1653-1682`) registers, pulls up to 12 lessons + presets regardless of mode, and reports counts. Plain `/hive` shows current status without forcing a pull.

---

## 5. Prompt Injection

`getSharedLessonsForPrompt()` (`HivemindAdapter.ts:175-202`) turns cached shared lessons into prompt text:

- Reads `data/hivemind-cache.json`, normalizes each lesson (drops ones without a `rule`).
- **Role filter**: a lesson with a `role` is only shown to that role; `GENERAL` sees everything — `:186-189`.
- **Sorted by `score` descending**, then truncated to `maxLessons` (default **6**) — `:177`, `:190-193`.
- Formatted as `[HIVEMIND score=<n>] <rule>` and injected into the system prompt via the lessons domain (`packages/core/src/domain/lessons.ts:579`).

Only the top lessons by score reach the LLM, so noisy/contributed lessons compete on quality, not just recency.

---

## 6. Push Flow (Contributing Back)

When Etemaro derives a lesson locally, it pushes it to the fleet:

- `pushHiveLesson()` POSTs to `/api/hivemind/lessons/push` — `HivemindAdapter.ts:426-441`.
- Triggered from the lessons domain the moment a lesson is derived — `packages/core/src/domain/lessons.ts:103`, `699-701`.
- Closed-position **performance** events are also pushed on close via `/api/hivemind/performance/push` (`pushHivePerformanceEvent()`, `HivemindAdapter.ts:453-486`), feeding cross-agent win-rate stats.

Both pushes are best-effort: failures are logged as `hivemind_warn` and never block the agent loop.

---

## 7. Quick Reference

| Concern          | Behavior                               | Code                                      |
| ---------------- | -------------------------------------- | ----------------------------------------- |
| Enabled?         | Needs `hiveMindUrl` + `hiveMindApiKey` | `HivemindAdapter.ts:81`                   |
| Startup pull     | Yes, if `pullMode=auto`                | `Daemon.ts:260`, `HivemindAdapter.ts:271` |
| Periodic pull    | Every 15 min, if `pullMode=auto`       | `Daemon.ts:263`, `HivemindAdapter.ts:286` |
| Manual pull      | `/hive pull` Telegram command          | `Daemon.ts:1653`                          |
| Cache file       | `data/hivemind-cache.json`             | `HivemindAdapter.ts:11`                   |
| Injected lessons | Top 6 by score, role-filtered          | `HivemindAdapter.ts:175`                  |
| Contribute       | Lessons + performance on derive/close  | `HivemindAdapter.ts:426`, `453`           |

See also: [CONFIGURATION.md](CONFIGURATION.md) (config fields) · [ARCHITECTURE.md](ARCHITECTURE.md) (adapter overview).
