import type { ToolDefinition } from '../../shared/types.js'

/** blacklist tool definitions. */
export const blacklistTools: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'add_to_blacklist',
      description: `Permanently blacklist a base token mint so it's never deployed into again.
Use when a token rugs, shows wash trading, or is otherwise unsafe.
Blacklisted tokens are filtered BEFORE the LLM even sees pool candidates.`,
      parameters: {
        type: 'object',
        properties: {
          mint: {
            type: 'string',
            description: 'The base token mint address to blacklist',
          },
          symbol: {
            type: 'string',
            description: 'Token symbol (for readability)',
          },
          reason: {
            type: 'string',
            description: 'Why this token is being blacklisted',
          },
        },
        required: ['mint', 'reason'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'remove_from_blacklist',
      description: 'Remove a token mint from the blacklist (e.g. if it was added by mistake).',
      parameters: {
        type: 'object',
        properties: {
          mint: {
            type: 'string',
            description: 'The mint address to remove from the blacklist',
          },
        },
        required: ['mint'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'list_blacklist',
      description: 'List all blacklisted token mints with their reasons and timestamps.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'block_deployer',
      description:
        'Block a deployer wallet address. Any token deployed by this wallet will be hard-filtered from screening before the LLM ever sees it.',
      parameters: {
        type: 'object',
        properties: {
          wallet: { type: 'string', description: 'Deployer wallet address (base58)' },
          label: { type: 'string', description: "Human-readable label (e.g. 'known rugger')" },
          reason: { type: 'string', description: 'Why this deployer is being blocked' },
        },
        required: ['wallet'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'unblock_deployer',
      description: 'Remove a deployer wallet from the blocklist.',
      parameters: {
        type: 'object',
        properties: {
          wallet: { type: 'string', description: 'Deployer wallet address to unblock' },
        },
        required: ['wallet'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_blocked_deployers',
      description: 'List all blocked deployer wallets.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },

  // ─── Config Introspection ───────────────────────────────────────
]
