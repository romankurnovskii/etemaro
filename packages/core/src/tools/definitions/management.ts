import type { ToolDefinition } from '../../shared/types.js'

/** management tool definitions. */
export const managementTools: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'get_position_pnl',
      description: `Get detailed PnL and real-time Fee/TVL metrics for an open position.
Use this during management to check if yield has dropped significantly.
Returns current feePerTvl24h which indicates the current APY of the pool.`,
      parameters: {
        type: 'object',
        properties: {
          pool_address: { type: 'string', description: 'The pool address' },
          position_address: { type: 'string', description: 'The position public key' },
        },
        required: ['pool_address', 'position_address'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'get_meteora_positions',
      description: `List all open Meteora DLMM LP positions for the agent wallet.
Strictly inspects active Meteora LP liquidity positions, deployed range (min/max bin IDs), uncollected fees, and in-range status.
This does NOT show spot tokens sitting in the wallet.

Returns positions grouped by pool, each with:
- position address
- pool address and token pair
- bin range (min/max bin IDs)
- whether currently in range
- unclaimed fees (in USD)
- total deposited value vs current value
- time since last rebalance

Use this at the start of every management cycle or when inspecting LP positions.`,
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'get_my_positions',
      description: `List all open Meteora DLMM LP positions for the agent wallet (alias for get_meteora_positions).
Strictly inspects active Meteora LP liquidity positions, deployed range, and uncollected fees.
This does NOT show spot tokens sitting in the wallet (use get_wallet_balance for wallet tokens).

Returns positions grouped by pool, each with:
- position address
- pool address and token pair
- bin range (min/max bin IDs)
- whether currently in range
- unclaimed fees (in USD)
- total deposited value vs current value
- time since last rebalance

Use this at the start of every management cycle.`,
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'claim_fees',
      description: `Claim accumulated swap fees from a specific position.
Only call when unclaimed fees > $5 to justify transaction costs.
Returns the transaction hash and amounts claimed.

WARNING: This executes a real on-chain transaction.`,
      parameters: {
        type: 'object',
        properties: {
          position_address: {
            type: 'string',
            description: 'The position public key to claim fees from',
          },
        },
        required: ['position_address'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'close_position',
      description: `Remove all liquidity and close a position.
This withdraws all tokens back to the wallet and closes the position account.
Use when:
- Position has been out of range for > 30 minutes
- IL exceeds accumulated fees
- Token shows danger signals (organic score drop, volume crash)
- Rebalancing (close old + open new)

WARNING: This executes a real on-chain transaction. Cannot be undone.`,
      parameters: {
        type: 'object',
        properties: {
          position_address: {
            type: 'string',
            description: 'The position public key to close',
          },
          skip_swap: {
            type: 'boolean',
            description:
              'Set to true if user explicitly wants to hold/keep the base token after closing. Default: false (auto-swaps base token back to SOL).',
          },
          reason: {
            type: 'string',
            description:
              "Why this position is being closed. Include the rule that triggered it, e.g. 'low yield', 'stop loss', 'trailing TP', 'OOR'. Used for pool memory.",
          },
        },
        required: ['position_address'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'get_wallet_positions',
      description: `Get all open DLMM positions for any Solana wallet address.
Use this when the user asks about another wallet's positions, wants to monitor a wallet,
or wants to copy/compare positions.

Returns the same structure as get_my_positions but for the given wallet:
position address, pool, bin range, in-range status, unclaimed fees, PnL, age.`,
      parameters: {
        type: 'object',
        properties: {
          wallet_address: {
            type: 'string',
            description: 'The Solana wallet address (base58 public key) to check',
          },
        },
        required: ['wallet_address'],
      },
    },
  },

  // ═══════════════════════════════════════════
  //  WALLET TOOLS
  // ═══════════════════════════════════════════
  {
    type: 'function',
    function: {
      name: 'get_wallet_balance',
      description: `Get current spot wallet balances for SOL, USDC, standard SPL tokens, and Token-2022 tokens held directly in the wallet.
Use this to check real token balances and cash held directly in the wallet.
This does NOT show Meteora LP positions (use get_meteora_positions for LP bins).

Returns:
- SOL balance (native)
- USDC balance
- Token balances (SPL & Token-2022) with USD values and program standard
- Total spot holdings value in USD

Use to check available capital before deploying positions or executing swaps.`,
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'get_portfolio_summary',
      description: `Get unified portfolio summary combining spot wallet holdings and active Meteora DLMM LP positions.
Delivers total net worth and capital allocation breakdown across:
- Liquid SOL (cash & gas) with USD valuation
- Spot token balances (SPL & Token-2022) with individual USD valuations
- Active Meteora LP positions (deposited capital, active bins, in-range status)
- Uncollected LP fees ($ USD)
- Total Net Equity ($ USD)

Use when asked for "portfolio", "net worth", "total assets", "total capital", or "all holdings".`,
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'swap_token',
      description: `Swap tokens via Jupiter aggregator.
Use when you need to rebalance wallet holdings, e.g.:
- Convert claimed fee tokens back to SOL/USDC
- Prepare token pair before deploying a position

WARNING: This executes a real on-chain transaction.`,
      parameters: {
        type: 'object',
        properties: {
          input_mint: {
            type: 'string',
            description: 'Mint address of the token to sell',
          },
          output_mint: {
            type: 'string',
            description: 'Mint address of the token to buy',
          },
          amount: {
            type: 'number',
            description: 'Amount of input token to swap (in human-readable units, not lamports)',
          },
        },
        required: ['input_mint', 'output_mint', 'amount'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'swap_all_tokens_to_sol',
      description: `Sweep and swap all non-SOL SPL tokens in the wallet back to SOL in a single safe, sequentially paced batch (alias for sweep_unsold_tokens).
Use when multiple leftover tokens or claimed fee tokens have accumulated in the wallet.
Automatically skips SOL and USDC, and sequentially sells each token via Jupiter with DLMM direct pool fallback.

WARNING: This executes real on-chain transactions.`,
      parameters: {
        type: 'object',
        properties: {
          skip_mints: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional list of token mint addresses to exclude from swapping',
          },
        },
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'sweep_unsold_tokens',
      description: `Sweep and liquidate all unsold base tokens in the wallet back to SOL.
Reconciles active wallet balances against the persistent liquidation backlog in state.json.
Attempts Jupiter aggregator first, then falls back to direct Meteora DLMM pool swaps if Jupiter has no route.
Skips micro-dust (< $0.02) and marks persistently illiquid/rugged tokens as abandoned to preserve gas.

WARNING: This executes real on-chain transactions.`,
      parameters: {
        type: 'object',
        properties: {
          skip_mints: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional list of token mint addresses to exclude from sweeping',
          },
        },
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'get_pending_liquidations',
      description: `Inspect the persistent backlog of unsold tokens awaiting liquidation.
Returns details for each token including mint, symbol, amount, USD value, liquidation attempts, status (pending, liquidated, abandoned), and last error.`,
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['pending', 'liquidated', 'abandoned'],
            description: 'Optional status filter. Omit to retrieve all tracked liquidations.',
          },
        },
      },
    },
  },

  // ═══════════════════════════════════════════
  //  LEARNING TOOLS
  // ═══════════════════════════════════════════
  {
    type: 'function',
    function: {
      name: 'update_config',
      description: `Update any of your operating parameters at runtime.
Changes persist to agent-config.json and take effect immediately — no restart needed.

VALID KEYS (use EXACTLY these key names, nothing else):
Screening: minFeeActiveTvlRatio, minTvl, maxTvl, minVolume, minOrganic, minQuoteOrganic, minHolders, minMcap, maxMcap, minBinStep, maxBinStep, timeframe, category, minTokenFeesSol, excludeHighSupplyConcentration, allowedLaunchpads, blockedLaunchpads
Management: minClaimAmount, outOfRangeBinsToClose, outOfRangeWaitMinutes, oorCooldownTriggerCount, oorCooldownHours, repeatDeployCooldownEnabled, repeatDeployCooldownTriggerCount, repeatDeployCooldownHours, repeatDeployCooldownScope, repeatDeployCooldownMinFeeEarnedPct, minVolumeToRebalance, stopLossPct, takeProfitPct, minSolToOpen, deployAmountSol, gasReserve, positionSizePct
Risk: maxPositions, maxDeployAmount
Schedule: managementIntervalMin, screeningIntervalMin
Models: managementModel, screeningModel, generalModel
Strategy: minBinsBelow, maxBinsBelow, defaultBinsBelow (legacy binsBelow maps to maxBinsBelow)

Reason is optional but helpful — logged as a lesson when provided.`,
      parameters: {
        type: 'object',
        properties: {
          changes: {
            type: 'object',
            description: 'Key-value pairs of settings to update. e.g. { "takeProfitPct": 8 }',
          },
          reason: {
            type: 'string',
            description: 'Why you are making this change — what you observed that justified it',
          },
        },
        required: ['changes'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'self_update',
      description: `Pull the latest code from git and restart the agent.
Use when the user says "update", "pull latest", "update yourself", etc.
Responds with what changed before restarting in 3 seconds.`,
      parameters: { type: 'object', properties: {} },
    },
  },

  {
    type: 'function',
    function: {
      name: 'get_recent_decisions',
      description: `Get the recent structured decision log for deployments, closes, skips, and no-deploy outcomes.
Use this when the user asks explanatory questions like:
- why did you deploy that position?
- why did you close that pool?
- why didn't you deploy anything?

This is the preferred tool for answering "why did you..." questions because it returns the agent's recorded reasoning without requiring unrelated live trading actions.`,
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'How many recent decisions to return. Default 6.',
          },
        },
      },
    },
  },

  // ═══════════════════════════════════════════
  //  SMART WALLET TOOLS
  // ═══════════════════════════════════════════
]
