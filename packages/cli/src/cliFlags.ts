/**
 * @file cliFlags.ts
 * @description Pure CLI argv/runtime-flag helpers extracted from Cli.ts.
 */
export function isCliTarget(filePath: string | undefined): boolean {
  if (!filePath) return false
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return false
  const lower = filePath.toLowerCase()
  return (
    lower.endsWith('cli.ts') ||
    lower.endsWith('cli.js') ||
    lower.endsWith('cli.cjs') ||
    lower.endsWith('/etemaro') ||
    lower.endsWith('\\etemaro') ||
    lower === 'etemaro'
  )
}
/**
 * Extract the value for a `--flag`/`-f` pair from an argv array.
 * Returns undefined if the flag is absent, has no value, or the value
 * looks like another flag (so `etemaro balance --config` with no path
 * does not swallow the next subcommand).
 *
 * Extracted as a pure function for direct unit testing.
 */
export function resolveGlobalFlagValue(argv: string[], flag: string, alias?: string): string | undefined {
  const idx = argv.findIndex((a) => a === flag || (alias !== undefined && a === alias))
  if (idx === -1) return undefined
  const value = argv[idx + 1]
  if (value === undefined || value.startsWith('-')) return undefined
  return value
}

/** Apply CLI flags that must be visible to core before any tool runs. */
export function applyCliRuntimeFlags(flags: Record<string, unknown>, env: NodeJS.Dict<string> = process.env): void {
  if (flags['dry-run'] === true) env.DRY_RUN = 'true'
}
