/**
 * @file docsCommands.test.ts
 * @description Guards the docs against documenting CLI commands that the CLI does not implement.
 *
 * The CLI dispatch table in Cli.ts is the source of truth. Any `etemaro <cmd>`,
 * `npm run cli <cmd>` or `pnpm cli <cmd>` example in docs/ or README.md must resolve
 * to a real command, otherwise operators copy-paste a command that dies with
 * "Unknown command" (see issue #347).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const CLI_SOURCE = fileURLToPath(new URL('./Cli.ts', import.meta.url))
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/** Command tokens from the CLI dispatch switch, including nested subcommands. */
function readKnownCommands(): Set<string> {
  const source = fs.readFileSync(CLI_SOURCE, 'utf8')
  const commands = new Set<string>()
  for (const match of source.matchAll(/case '([a-z][a-z0-9-]*)':/g)) {
    if (match[1]) commands.add(match[1])
  }
  return commands
}

function markdownFiles(): string[] {
  const files = [path.join(REPO_ROOT, 'README.md')]
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.md')) files.push(full)
    }
  }
  walk(path.join(REPO_ROOT, 'docs'))
  return files
}

describe('docs CLI command references', () => {
  it('parses a non-trivial command set from Cli.ts', () => {
    const known = readKnownCommands()
    expect(known.size).toBeGreaterThan(10)
    expect(known).toContain('init')
    expect(known).toContain('wallet')
    expect(known).toContain('strategy')
  })

  it('only references CLI commands that exist in Cli.ts', () => {
    const known = readKnownCommands()
    const reference = /(?:\bnpm run cli|\bpnpm cli|\betemaro)\s+([a-z][a-z0-9-]*)/g
    const offenders: string[] = []

    for (const file of markdownFiles()) {
      const lines = fs.readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, index) => {
        for (const match of line.matchAll(reference)) {
          const command = match[1]
          if (command && !known.has(command)) {
            offenders.push(`${path.relative(REPO_ROOT, file)}:${index + 1} -> "${match[0]}"`)
          }
        }
      })
    }

    expect(
      offenders,
      `Docs reference CLI commands missing from packages/cli/src/Cli.ts:\n${offenders.join('\n')}`,
    ).toEqual([])
  })
})
