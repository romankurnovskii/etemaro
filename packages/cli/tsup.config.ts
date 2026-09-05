import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/Cli.ts'],
  format: ['cjs'],
  target: 'node20',
  platform: 'node',
  clean: true,
  bundle: true,
  sourcemap: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
  shims: true, // Enable cjs and esm shims. Provides support for import.meta.url when targeting modern ESM builds
  // Bundle internal workspace packages into the standalone distribution
  noExternal: ['@etemaro/core', '@etemaro/daemon'],
})
