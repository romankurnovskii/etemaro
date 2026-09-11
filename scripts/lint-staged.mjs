#!/usr/bin/env node
/**
 * Pre-commit lint/format for staged files.
 *
 * Replaces the previous "npx lint-staged", which was broken: lint-staged is not a
 * declared dependency, so npx tried to download it into ~/.npm (fails in sandboxes /
 * offline and is non-deterministic). This script is dependency-free and uses the
 * project's own biome.
 */
import { execFileSync } from 'node:child_process'

const STAGED_EXT = /\.(ts|tsx|js|jsx|json|md|html|css|sh)$/

const raw = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], {
  encoding: 'utf8',
})
const files = raw.split('\0').filter(Boolean).filter((f) => STAGED_EXT.test(f))

if (files.length === 0) {
  console.log('[lint-staged] no matching staged files')
  process.exit(0)
}

try {
  execFileSync('pnpm', ['exec', 'biome', 'check', '--write', '--unsafe', '--no-errors-on-unmatched', ...files], {
    stdio: 'inherit',
  })
} catch (err) {
  process.exit(typeof err?.status === 'number' ? err.status : 1)
}

// Re-stage so the commit contains the formatted content (lint-staged does this too).
execFileSync('git', ['add', '--', ...files], { stdio: 'inherit' })
console.log('[lint-staged] formatted ' + files.length + ' staged file(s)')
