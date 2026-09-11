import type { ToolDefinition } from '../../shared/types.js'

/** smart-wallets tool definitions. */
export const smartWalletTools: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'add_smart_wallet',
      description: `Add a wallet to the active strategy smart-wallet list.
Use when the user says "add smart wallet", "track this wallet", "add to smart wallets", etc.
- type "lp": wallet is tracked for LP positions (checked before deploying). Use for LPers/whales.
- type "holder": wallet is only checked for token holdings (never fetches positions). Use for KOLs/traders who don't LP.`,
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: "Label for this wallet (e.g. 'alpha-1', 'whale-sol')" },
          address: { type: 'string', description: 'Solana wallet address (base58)' },
          category: {
            type: 'string',
            enum: ['alpha', 'smart', 'fast', 'multi'],
            description: 'Wallet category (default: alpha)',
          },
          type: {
            type: 'string',
            enum: ['lp', 'holder'],
            description: 'lp = tracks LP positions, holder = tracks token holdings only (default: lp)',
          },
        },
        required: ['name', 'address'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'remove_smart_wallet',
      description: 'Remove a wallet from the active strategy smart-wallet list.',
      parameters: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Wallet address to remove' },
        },
        required: ['address'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'list_smart_wallets',
      description: 'List smart wallets assigned to the active strategy.',
      parameters: { type: 'object', properties: {} },
    },
  },

  {
    type: 'function',
    function: {
      name: 'check_smart_wallets_on_pool',
      description: `Check if any tracked smart wallets have an active position in a given pool.
Use this before deploying to gauge confidence — if smart wallets are in the pool it's a strong signal.
If no smart wallets are present, rely on fundamentals (fees, volume, organic score) as usual.`,
      parameters: {
        type: 'object',
        properties: {
          pool_address: { type: 'string', description: 'Pool address to check' },
        },
        required: ['pool_address'],
      },
    },
  },
]
