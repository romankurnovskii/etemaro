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
    fs.writeFileSync(path.join(__dirname, 'dist', 'Cli.cjs'), wrapper)
  },
})
