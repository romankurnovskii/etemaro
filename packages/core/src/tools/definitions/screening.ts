import type { ToolDefinition } from '../../shared/types.js'

/** screening tool definitions. */
export const screeningTools: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'discover_pools',
      description: `Fetch top DLMM pools from the Meteora Pool Discovery API.
Pools are pre-filtered for safety:
- No critical warnings on base/quote tokens
- No high single ownership on base token
- Base token market cap >= $150k
- Base token holders >= 100
- Volume >= $1k (in timeframe)
- Active TVL >= $10k
- Windowed fee/TVL (screening timeframe, not real-time active-bin) >= 0.01
- Both tokens organic score >= 60

Returns condensed pool data: address, name, tokens, bin_step, fee_pct,
active_tvl, fee_window, volume_window, windowed fee/TVL (fee_active_tvl_ratio), volatility from max(timeframe, 30m), organic_score,
holders, mcap, active_positions, price_change_pct, warning count.

Use this as the primary tool for finding new LP opportunities.`,
      parameters: {
        type: 'object',
        properties: {
          page_size: {
            type: 'number',
            description: 'Number of pools to return. Default 50. Use 10-20 for quick scans.',
          },
          timeframe: {
            type: 'string',
            enum: ['1h', '4h', '12h', '24h'],
            description: 'Timeframe for metrics. Use 24h for general screening, 1h for momentum.',
          },
          category: {
            type: 'string',
            enum: ['top', 'new', 'trending'],
            description:
              "Pool category. 'top' = highest fee/TVL, 'new' = recently created, 'trending' = gaining activity.",
          },
        },
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'get_top_candidates',
      description: `Get the top pre-scored pool candidates for deployment review.
All filtering, scoring, and rule-checking is done in code — no analysis needed.
Returns the top N eligible pools ranked by score (windowed fee/TVL, organic, stability, volume).
Also returns total_screened (raw pools evaluated) and filtered_examples so logs can show scanned vs shortlisted.
Each pool includes a score (0-100) and has already passed all hard disqualifiers.
Use this instead of discover_pools for screening cycles.
If this returns one candidate, still judge whether it is actually worth deploying; one weak candidate should be skipped.`,
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Number of top candidates to return. Default 3.',
          },
        },
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'get_pool_detail',
      description: `Get detailed info for a specific DLMM pool by address.
Use this during management to check current pool health (volume, fees, organic score, price trend).
Default timeframe is 5m for real-time accuracy during position management.
Use a longer timeframe (1h, 4h) only when screening for new deployments.

IMPORTANT: Only call this with a real pool address from get_my_positions or get_top_candidates. Never guess or construct a pool address.`,
      parameters: {
        type: 'object',
        properties: {
          pool_address: {
            type: 'string',
            description: 'The on-chain pool address (base58 public key)',
          },
          timeframe: {
            type: 'string',
            enum: ['5m', '30m', '1h', '2h', '4h', '12h', '24h'],
            description: 'Data timeframe. Default 5m for management (most accurate). Use 4h+ for screening.',
          },
        },
        required: ['pool_address'],
      },
    },
  },

  // ═══════════════════════════════════════════
  //  POSITION DEPLOYMENT TOOLS
  // ═══════════════════════════════════════════
  {
    type: 'function',
    function: {
      name: 'get_active_bin',
      description: `Get the current active bin and price for a DLMM pool.
This is an on-chain call via the SDK. Returns:
- binId: the current active bin number
- price: human-readable price (token X per token Y)
- pricePerLamport: raw price in lamports

Only call this if you need the current price to calculate a specific bin range (e.g. user requested a % range). Do NOT call before every deploy — deploy_position fetches the active bin internally.`,
      parameters: {
        type: 'object',
        properties: {
          pool_address: {
            type: 'string',
            description: 'The DLMM pool address',
          },
        },
        required: ['pool_address'],
      },
    },
  },
]
