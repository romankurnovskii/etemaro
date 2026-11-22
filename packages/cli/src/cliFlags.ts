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

/**
 * `--dry-run` used to set `DRY_RUN` in the environment, which nothing read, so
 * it silently did nothing. Dry-run is controlled only by `connection.dryRun` in
 * the instance config; the flag is rejected so nobody relies on a no-op.
 */
export const DRY_RUN_REMOVED_MESSAGE =
  '--dry-run was removed: dry-run is controlled only by "connection.dryRun" in the instance config ' +
  '(config/instances/<id>.json). Set it to true to simulate, false to trade live.'

/** Returns the rejection message when the removed flag is present, else null. */
export function rejectRemovedDryRunFlag(flags: Record<string, unknown>): string | null {
  return flags['dry-run'] !== undefined ? DRY_RUN_REMOVED_MESSAGE : null
}
