/**
 * @file configProvider.ts
 * @description Swappable config binding. The default is the process config singleton;
 * modules call getConfig() so a scoped ConfigPort can be injected for tests/plugins.
 */
import { config } from '../config/Config.js'
import type { ConfigPort } from '../ports/config.js'

let activeConfig: ConfigPort = config

export function getConfig(): ConfigPort {
  return activeConfig
}

export function setConfig(cfg: ConfigPort): void {
  activeConfig = cfg
}

export function resetConfig(): void {
  activeConfig = config
}
