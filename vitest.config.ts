import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 15000,
    include: ['packages/**/*.test.ts', 'packages/**/*.test.tsx'],
    setupFiles: ['vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['packages/**/*.test.ts'],
    },
  },
});
