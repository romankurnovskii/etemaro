import type { ToolDefinition } from '../../shared/types.js'

/** deployment tool definitions. */
export const deploymentTools: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'deploy_position',
      description: `Open a new DLMM liquidity position.

PRIORITY ORDER for strategy and bins:
1. If user asks for spot/curve/bid_ask, use it.
2. No user spec → use the configured strategy from config.strategy.strategyMeteora and choose bins based on volatility

HARD RULES:
- Never use 'curve'.
- Bin Step: Only deploy in pools with bin_step between 80 and 125.
- Volatility must be positive. If volatility is 0, null, or missing, do not deploy.
- Range must cover at least 35 total bins. Never deploy 1-bin/tiny ranges.
- For single-side SOL deploys (amount_y only, amount_x=0), do not request upside exposure:
  use bins_below only, keep bins_above=0, and the upper bin will be pinned to the current active bin.

Guidelines (only when user hasn't specified):
- Strategy: omit the strategy field — the system will use the configured default from config.strategy.strategyMeteora
- Bins: choose from configured minBinsBelow/maxBinsBelow by positive volatility. The hard lower floor is 35 bins.
- Deposit: single-sided SOL only: set amount_y/amount_sol, keep amount_x=0.

WARNING: This executes a real on-chain transaction. Check DRY_RUN mode.`,
      parameters: {
        type: 'object',
        properties: {
          pool_address: {
            type: 'string',
            description: 'The DLMM pool address to LP in',
          },
          amount_y: {
            type: 'number',
            description: 'Amount of quote token (usually SOL) to deposit.',
          },
          amount_x: {
            type: 'number',
            description: 'Unsupported for this agent. Keep at 0; deploys are single-side SOL via amount_y.',
          },
          amount_sol: {
            type: 'number',
            description: 'Alias for amount_y. For backward compatibility.',
          },
          strategy: {
            type: 'string',
            enum: ['bid_ask', 'spot'],
            description:
              'DLMM strategy type. If user specifies, use exactly what they said. Otherwise omit — the system default from config.strategy.strategyMeteora will be used automatically.',
          },
          bins_below: {
            type: 'number',
            description:
              'Number of bins below the current active bin. For single-side SOL deploys, this is the main range input: lower bin = active bin - bins_below, upper bin = active bin.',
          },
          bins_above: {
            type: 'number',
            description:
              'Number of bins above the current active bin. Keep this at 0 for single-side SOL deploys. Only use this for dual-sided or explicit upside-exposure deploys.',
          },
          downside_pct: {
            type: 'number',
            description:
              'Optional human-friendly downside range in percent below the current active price. Converted to bins internally via the Meteora SDK.',
          },
          upside_pct: {
            type: 'number',
            description:
              'Optional human-friendly upside range in percent above the current active price. Do not use this for single-side SOL deploys.',
          },
          pool_name: { type: 'string', description: 'Human-readable pool name for record-keeping' },
          base_mint: {
            type: 'string',
            description: 'Base token mint address — used to prevent duplicate token exposure across pools',
          },
          bin_step: { type: 'number', description: 'Pool bin step (from discover_pools)' },
          base_fee: { type: 'number', description: 'Pool base fee percentage (from discover_pools)' },
          volatility: {
            type: 'number',
            description: 'Pool volatility at deploy time, sourced from max(screening timeframe, 30m)',
          },
          fee_tvl_ratio: { type: 'number', description: 'fee/TVL ratio at deploy time' },
          organic_score: { type: 'number', description: 'Base token organic score at deploy time' },
          initial_value_usd: { type: 'number', description: 'Estimated USD value being deployed' },
        },
        required: ['pool_address'],
      },
    },
  },

  // ═══════════════════════════════════════════
  //  POSITION MANAGEMENT TOOLS
  // ═══════════════════════════════════════════
]
