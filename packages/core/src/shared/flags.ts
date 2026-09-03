/**
 * @file flags.ts
 * @description Shared runtime boolean flags set once by Config.ts at startup.
 *
 * This module has NO imports to avoid circular dependencies. It acts as a
 * neutral registry that both Config.ts (writer) and logger.ts / other modules
 * (readers) can safely import.
 */

/** True when the agent is running in dry-run mode. Set by Config.ts after buildConfig(). */
let _dryRun = false

/** Override the dry-run flag. Called once by Config.ts after config is built. */
export function setDryRun(value: boolean): void {
  _dryRun = value
}

/** Read the current dry-run flag. */
export function getDryRun(): boolean {
  return _dryRun
}
