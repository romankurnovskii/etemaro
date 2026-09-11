/**
 * @file index.ts
 * @description Ordered concatenation of all agent tool definitions. Order matches the
 * original single-file array; category modules are contiguous slices of it.
 */
import type { ToolDefinition } from '../../shared/types.js'
import { blacklistTools } from './blacklist.js'
import { configTools } from './config.js'
import { deploymentTools } from './deployment.js'
import { learningTools } from './learning.js'
import { managementTools } from './management.js'
import { screeningTools } from './screening.js'
import { smartWalletTools } from './smart-wallets.js'
import { tokenTools } from './token.js'

export const toolDefinitions: ToolDefinition[] = [
  ...screeningTools,
  ...deploymentTools,
  ...managementTools,
  ...smartWalletTools,
  ...tokenTools,
  ...learningTools,
  ...blacklistTools,
  ...configTools,
]
