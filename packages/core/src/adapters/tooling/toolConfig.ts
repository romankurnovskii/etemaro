/**
 * @file toolConfig.ts
 * @description Backwards-compatible alias for the shared config provider. The tool layer
 * and the shared provider share one swappable ConfigPort binding.
 */
export {
  getConfig as getToolConfig,
  resetConfig as resetToolConfig,
  setConfig as setToolConfig,
} from '../../shared/configProvider.js'
