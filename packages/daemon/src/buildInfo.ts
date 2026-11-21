/**
 * @file buildInfo.ts
 * @description Best-effort build identity for the running daemon (git short SHA).
 */

import fs from 'node:fs'
import path from 'node:path'

/**
 * Resolve the checked-out git commit (first 12 chars) from the repo's .git directory.
 * Returns 'unknown' outside a git worktree or when the ref cannot be read.
 */
export function resolveBuildId(repoRoot: string): string {
  try {
    const gitDir = path.join(repoRoot, '.git')
    const headPath = path.join(gitDir, 'HEAD')
    const head = fs.readFileSync(headPath, 'utf8').trim()
    if (head.startsWith('ref: ')) {
      const ref = head.slice(5).trim()
      return fs.readFileSync(path.join(gitDir, ref), 'utf8').trim().slice(0, 12)
    }
    return head.slice(0, 12)
  } catch {
    return 'unknown'
  }
}
