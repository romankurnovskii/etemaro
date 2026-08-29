# Step 3: CI Test Execution Results

## Context

Objective: ensure GitHub Tests eventually pass on PR #150
(`fix/telegram-stop-command` → `main`).

## Root cause (resolved)

All 4 failing CI jobs were blocked at install time by
`@etemaro/rugcheck` being pinned to `1.0.2` (a version that does **not exist**
in the npm registry; only `1.0.1` and `1.0.3` are published).

## Resolution

Commit `3c52d29 fix(deps): bump @etemaro/rugcheck to 1.0.3 and regenerate lockfile`
bumped the pin to `1.0.3` (latest) and regenerated the lockfile. This commit was
already present on the branch (applied by a parallel process before my own edit was
needed), so no additional local changes were required.

## Results (CI run after the fix — PR head 3c52d29)

| Check                           | Workflow                 | Result             |
| ------------------------------- | ------------------------ | ------------------ |
| test                            | PR Tests                 | ✅ SUCCESS (30s)   |
| build_linux                     | Test Desktop Builds      | ✅ SUCCESS (7m49s) |
| build_macos                     | Test Desktop Builds      | ✅ SUCCESS (5m3s)  |
| build_windows                   | Test Desktop Builds      | ✅ SUCCESS (8m30s) |
| Analyze (actions)               | CodeQL                   | ✅ SUCCESS         |
| Analyze (javascript-typescript) | CodeQL                   | ✅ SUCCESS         |
| Analyze (ruby)                  | CodeQL                   | ✅ SUCCESS         |
| CodeQL                          | CodeQL                   | ✅ SUCCESS         |
| GitGuardian Security Checks     | —                        | ✅ SUCCESS         |
| Code scanning AI findings       | GitHub Advanced Security | ✅ SUCCESS         |

## Totals

- **Passed: 10**
- **Failed: 0**
- **Skipped: 0**

## PR merge state

- `mergeable`: MERGEABLE
- `mergeStateStatus`: CLEAN

## Non-blocking warnings

Node.js 20 deprecation notice: GitHub Actions is forcing actions targeting
Node.js 20 (checkout@v4, setup-node@v4, upload-artifact@v4, pnpm/action-setup@v4)
onto Node.js 24. Advisory only; does not affect pass/fail.
