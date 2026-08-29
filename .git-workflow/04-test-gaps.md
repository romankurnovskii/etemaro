# Step 4: Test Gap Analysis

## Assessment

Since the CI is now fully green on PR #150 (10/10 checks pass, none skipped),
the remaining test/validation gaps are **non-blocking** and advisory only.

## Identified gaps / follow-ups (prioritized by risk)

### Medium

1. **Node.js 20 → 24 deprecation migration (advisory)**
   - GitHub Actions is forcing Node 20-targeting actions onto Node.js 24.
   - Recommended: update `actions/checkout`, `actions/setup-node`,
     `actions/upload-artifact`, and `pnpm/action-setup` to versions whose
     `action.yml` targets Node.js 24 (e.g. checkout@v5, setup-node@v5,
     upload-artifact@v5), or rely on the auto-forcing behavior until deprecation.
   - Not CI-blocking today, but will become the default and should be addressed
     before it causes failures.

### Low

2. **`@etemaro/rugcheck` version drift prevention**
   - The original break occurred because the pin (`1.0.2`) referenced a version
     that was never published. Consider a Dependabot/`any`-style managed range or
     a pre-merge CI check that `pnpm install --frozen-lockfile` succeeds (CI
     currently uses `--no-frozen-lockfile`, which tolerates lockfile drift).
   - Recommend switching to `--frozen-lockfile` once the lockfile is stabilized.

3. **Desktop build coverage**
   - Test Desktop Builds only compiles/packages; it does not execute the daemon
     or strategy library runtime paths on the three OSes. The daemon /stop fix
     (b6d45fe) and strategy-library fix (6fb52f) are unit-tested but not e2e
     exercised on Windows/Linux/macOS runners.

## Risk assessment

- Untested paths identified above are **low** for the current PR; nothing blocks
  merge.
- No additional tests required before merge of PR #150.
