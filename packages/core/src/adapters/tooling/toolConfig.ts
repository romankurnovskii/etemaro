/**
 * @file toolConfig.ts
 * @description Swappable config binding for the tool layer. The default is the process
 * config singleton; callers can inject a scoped ConfigPort for tests or plugins.
 */
import { config } from '../../config/Config.js'
import type { ConfigPort } from '../../ports/config.js'

let activeConfig: ConfigPort = config

export function getToolConfig(): ConfigPort {
  return activeConfig
}

export function setToolConfig(cfg: ConfigPort): void {
  activeConfig = cfg
}

export function resetToolConfig(): void {
  activeConfig = config
}
