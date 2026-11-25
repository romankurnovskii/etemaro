# Deprecations

What was retired, why, and what to use instead. Newest first.

## 2026-11 — Tauri desktop app (`apps/desktop`)

| | |
| --- | --- |
| **Removed** | `apps/desktop` submodule, the `DesktopAdapter` chat server on `:31415`, the `desktop` npm script, `release-desktop` / `test-desktop` workflows, the Homebrew cask `etemaro` |
| **Replaced by** | The browser console in `apps/web`, served by the daemon itself |
| **Issue** | [#548](https://github.com/romankurnovskii/etemaro/issues/548) |
| **PRs** | [#549](https://github.com/romankurnovskii/etemaro/pull/549), [#551](https://github.com/romankurnovskii/etemaro/pull/551), [#552](https://github.com/romankurnovskii/etemaro/pull/552) |
| **Upstream repo** | `romankurnovskii/etemaro-desktop` archived |

### Why

The web console covers the same workflows (fleet view, positions, logs, chat, config), ships with the CLI, and needs no per-platform build. Maintaining a Tauri app duplicated every UI change and forced a separate release pipeline.

### Migration

| Desktop feature | Now |
| --- | --- |
| Launch the app | `etemaro serve --open` |
| Fleet view / start / stop | **Agents** tab |
| Positions and PnL | **Dashboard** tab |
| Live logs | **Logs** tab |
| Chat | **Chat** tab |
| Settings / env vars | **Config** tab |
| Local-only process | `etemaro serve` binds `127.0.0.1` |
| UI without a trading agent | `etemaro serve --no-agent` (console host only) |

### Homebrew

- `brew install --cask etemaro` no longer exists. Remove it with `brew uninstall --cask etemaro` if it is still installed.
- `brew install romankurnovskii/awesome-brew/etemaro` installs the CLI, which serves the console.

### Not affected

- The CLI (`@etemaro/cli`), the Telegram bot, PM2 deployments, and `data/` layouts.

---

## Template

```markdown
## YYYY-MM — <surface>

| | |
| --- | --- |
| **Removed** | … |
| **Replaced by** | … |
| **Issue** | #… |

### Why
### Migration
### Not affected
```
