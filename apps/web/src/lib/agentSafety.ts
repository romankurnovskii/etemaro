import type { ManagedAgent } from './ipc'

/**
 * An agent is live when its instance config does not set `connection.dryRun: true`.
 * A missing field is treated as live: the daemon defaults `dryRun` to false, and
 * guessing "safe" here would be the dangerous direction.
 */
export function isLiveAgent(agent: Pick<ManagedAgent, 'dryRun'> | null | undefined): boolean {
  return agent?.dryRun !== true
}

/** Starting a live agent moves real funds, so it needs an explicit confirmation. */
export function startNeedsConfirmation(agent: Pick<ManagedAgent, 'dryRun'> | null | undefined): boolean {
  return isLiveAgent(agent)
}
