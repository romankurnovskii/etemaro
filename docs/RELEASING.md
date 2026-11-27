# Releasing

The CLI ships two ways, both driven by the same version number:

| Channel | Artifact | Source of truth |
| --- | --- | --- |
| npm | `@etemaro/cli@<version>` | `packages/cli/package.json` |
| Homebrew | `Formula/etemaro.rb` in `romankurnovskii/homebrew-awesome-brew` | the npm tarball |

## Cut a release

```bash
# 1. everything merged, main green, working tree clean
git checkout main && git pull

# 2. bump every published package, then the tag
node -e "
const fs=require('fs');
for (const [p,v] of [['package.json','4.x.0'],['packages/cli/package.json','4.x.0'],['packages/daemon/package.json','4.x.0'],['packages/core/package.json','2.x.0']]) {
  const j=JSON.parse(fs.readFileSync(p,'utf8')); j.version=v; fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n');
}"
git commit -am "chore(release): bump version to 4.x.0"
git tag -a v4.x.0 -m "v4.x.0"
git push origin main --follow-tags
```

The `v*` tag starts `.github/workflows/release-cli.yml`, which builds the web
console, bundles `dist/web` into the CLI package, publishes to npm and creates a
GitHub release with `Cli.cjs`.

Verify the published artifacts:

```bash
npm view @etemaro/cli version
cd packages/cli && npm pack --dry-run   # dist/web/index.html must be listed
```

## Homebrew formula

The formula is **hand-maintained** — `scripts/update_casks.py` wipes `Casks/` and
`Formula/` each run and only keeps the entries listed under `skip` in
`formula.json`. Keep `etemaro.rb` in that `skip` list.

After npm publishes, update the formula in the tap:

```ruby
url "https://registry.npmjs.org/@etemaro/cli/-/cli-4.x.0.tgz"
sha256 "<sha256 of the npm tarball>"
```

```bash
curl -sL https://registry.npmjs.org/@etemaro/cli/-/cli-4.x.0.tgz | shasum -a 256
brew install --build-from-source romankurnovskii/awesome-brew/etemaro
etemaro --version
```

The formula installs the tarball, strips `devDependencies` (they point at
workspace packages that are not on npm), runs `npm install --omit=dev`, and
symlinks `dist/Cli.cjs`. Do not copy `dist/` alone — the CLI needs `ws`.

## npm credentials

`release-cli.yml` authenticates with the `NPM_TOKEN` repository secret.

- Use a **granular access token**, scoped to `@etemaro`, with *Read and write*
  package permissions and "bypass 2FA" enabled for CI.
- Granular tokens expire. A 90-day token stops working on day 91 and npm
  reports it as `E404 Not Found - PUT https://registry.npmjs.org/@etemaro%2fcli`
  (npm hides auth failures for scoped packages behind 404).
- `E401 Unauthorized - credential_not_found` from `npm whoami` means the same
  thing locally: the token in `~/.npmrc` is dead.

Rotate:

1. Create the token at <https://www.npmjs.com/settings/~/tokens>.
2. `gh secret set NPM_TOKEN` (paste the token when prompted).
3. Re-run the failed job: `gh run rerun <run-id>`. No re-tag needed — the tag
   still points at the release commit.

Set a calendar reminder for token expiry; nothing warns you in advance.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `404 ... is not in this registry` on publish | token expired or lacks publish rights for the scope |
| `401 credential_not_found` | token revoked / wrong registry in `.npmrc` |
| `dist/web` missing from the tarball | `apps/web` was not built first — the root `build` script does this |
| Formula installs but `etemaro` cannot find `ws` | `dist/` was copied without `npm install --omit=dev` |
