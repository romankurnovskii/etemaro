# Step 1: Code Quality / CI Failure Assessment

## Context

Working tree is clean; all changes are committed on `fix/telegram-stop-command`
(4 commits ahead of main). Session objective: ensure GitHub Tests eventually pass
on the open PR #150.

## Diagnosis: All failing CI jobs share one root cause

Both required workflows fail at the **install dependencies** step:

- **PR Tests** → `test` job: FAILURE
- **Test Desktop Builds** → `build_linux`, `build_macos`, `build_windows`: FAILURE

Every failing job reports the identical error:

```
ERR_PNPM_NO_MATCHING_VERSION  No matching version found for @etemaro/rugcheck@1.0.2
```

### Root cause

`packages/core/package.json:12` pins:

```json
"@etemaro/rugcheck": "1.0.2",
```

But the npm registry only has published versions **`1.0.1`** and **`1.0.3`**
(verified via `npm view @etemaro/rugcheck versions` → `[ '1.0.1', '1.0.3' ]`).
There is **no `1.0.2`**. pnpm refuses to resolve the non-existent version and
aborts the install, so every job fails before any tests/builds run.

### Why 4 jobs fail at once

- `test` (PR Tests) installs workspace deps → hits `packages/core`.
- `build_*` (Test Desktop Builds) install frontend deps → same workspace, same failure.

### Severity

- **Critical (CI-blocking):** pinned dependency version `@etemaro/rugcheck@1.0.2`
  does not exist in the npm registry. Blocks all CI. One-line fix.

### Passing checks (not affected)

- CodeQL (all 3 analyzes): SUCCESS
- GitGuardian Security: SUCCESS
- Code scanning AI findings: SUCCESS

## Recommended fix

Change `packages/core/package.json:12` from `"1.0.2"` to the latest published
version **`1.0.3`**:

```json
"@etemaro/rugcheck": "1.0.3",
```

Since CI installs with `--no-frozen-lockfile`, updating the manifest is sufficient;
the lockfile does not currently reference `rugcheck` at all.

## Summary counts

- critical: 1 (CI-blocking dependency version)
- high: 0
- medium: 0
- low: 0
