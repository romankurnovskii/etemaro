/**
 * Hash routing helpers — extracted for testability.
 *
 * "hash route parse" tests run in node env using JSDOM-free location stubs.
 */

export const VALID_HASHES = ['agents', 'dashboard', 'tools', 'config', 'logs', 'chat'] as const
export type Tab = (typeof VALID_HASHES)[number]

/**
 * Parses a raw hash string (e.g. '#/agents', '#agents', 'agents')
 * and returns the matching Tab or the default 'agents'.
 */
export function parseHash(rawHash: string): Tab {
  const h = rawHash.replace(/^#\/?/, '')
  return (VALID_HASHES as readonly string[]).includes(h) ? (h as Tab) : 'agents'
}
