import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/Cli.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  bundle: true,
  sourcemap: true,
  banner: {
    js: '#!/usr/bin/env node\nimport { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
  shims: true,
  // Bundle internal workspace packages into the standalone distribution
  noExternal: ['@etemaro/core', '@etemaro/daemon'],
  async onSuccess() {
    // Generate Cli.cjs compatibility wrapper for Homebrew formula and CJS consumers
    const wrapper = '#!/usr/bin/env node\nimport("./Cli.js");\n'
    // mode 0o755: the wrapper is the Homebrew `bin.install_symlink` target and must be executable
    fs.writeFileSync(path.join(__dirname, 'dist', 'Cli.cjs'), wrapper, { mode: 0o755 })

    // Ship the built browser console inside the package so `etemaro serve` works
    // from a global npm install (no repo checkout). `resolveWebDir()` looks for
    // `<bundle dir>/web` as its fallback.
    const webDist = path.resolve(__dirname, '..', '..', 'apps', 'web', 'dist')
    const target = path.join(__dirname, 'dist', 'web')
    if (fs.existsSync(path.join(webDist, 'index.html'))) {
      fs.rmSync(target, { recursive: true, force: true })
      fs.cpSync(webDist, target, { recursive: true })
    } else {
      console.warn('[cli] apps/web/dist not found — run `pnpm --filter @etemaro/web build` to bundle the web UI')
    }
  },
})
