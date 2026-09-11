import type { ToolDefinition } from '../../shared/types.js'

/** config tool definitions. */
export const configTools: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'get_user_config',
      description: `Return the currently loaded runtime configuration and the config file path in use.
Use when the user asks:
- "which config file are you using?"
- "what is my strategy?" / "review my strategy"
- "what are my thresholds?" / "show me my settings"
- "what is my take profit / stop loss / deploy amount?"
- "review my config"

Returns:
- configPath: the resolved file path (AGENT_CONFIG_PATH or default agent-config.json)
- preset: config preset label
- risk, screening, management, strategy, opportunity, schedule, llm sections

Do NOT use list_strategies / get_strategy to answer config questions — those only return
strategy-library metadata (named profiles), NOT the actual running operational parameters.`,
      parameters: { type: 'object', properties: {} },
    },
  },
]
