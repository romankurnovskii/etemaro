/**
 * @file ToolDefinitions.ts
 * @description LLM tool definitions assembled from tools/definitions category modules
 * and hardened with additionalProperties:false on object parameters.
 *
 * @dependencies tools/definitions
 */
import type { ToolDefinition } from '../shared/types.js'
import { toolDefinitions } from '../tools/definitions/index.js'

export const tools: ToolDefinition[] = toolDefinitions.map((tool) => ({
  ...tool,
  function: {
    ...tool.function,
    parameters:
      tool.function.parameters?.type === 'object'
        ? { additionalProperties: false, ...tool.function.parameters }
        : tool.function.parameters,
  },
}))
