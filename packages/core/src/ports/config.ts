/**
 * @file config.ts
 * @description Config port. The resolved application configuration shape, exposed as a
 * dependency-injection seam so modules can receive config instead of importing the
 * ambient singleton.
 */
import type { AppConfig } from '../shared/types.js'

/** The resolved application configuration (currently identical to AppConfig). */
export type ConfigPort = AppConfig

/** Late-bound accessor for the active config, for callers that need reload semantics. */
export type ConfigProvider = () => AppConfig
