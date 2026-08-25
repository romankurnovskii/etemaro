import { defineConfig } from 'tsup';

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
  // Bundle internal workspace packages into the standalone distribution
  noExternal: ['@etemaro/core', '@etemaro/daemon'],
});
