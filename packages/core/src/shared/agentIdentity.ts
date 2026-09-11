/**
 * @file agentIdentity.ts
 * @description Local agent identity used for outbound API requests and log prefixes.
 * Lives in shared so infrastructure (logger) does not depend on an adapter.
 */
import { config } from '../config/Config.js'
import { DEFAULT_AGENT_ID } from './constants.js'

/** Agent id for outbound requests (local agent identity; no HiveMind fallback). */
export function getAgentIdForRequests(): string {
  return config.agentId || DEFAULT_AGENT_ID
}
