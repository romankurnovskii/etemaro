import type { StrategyLibraryData } from '../shared/types.js'

/** Purpose of the private (mutable, gitignored) strategy overlay file. */
export const PRIVATE_STRATEGY_LIBRARY_DESCRIPTION =
  'Private strategy overlay. Strategies declared here override the shared base ' +
  '(config/shared/strategy-library.shared.json) on id collision, and the active pointer ' +
  'lives only here. Created by `etemaro init`; manage with `etemaro strategy ...`. ' +
  'The runtime ignores unknown top-level fields other than this description.'

/** Empty private strategy library written by `etemaro init` when missing. */
export const EMPTY_PRIVATE_STRATEGY_LIBRARY: StrategyLibraryData = {
  description: PRIVATE_STRATEGY_LIBRARY_DESCRIPTION,
  strategies: {},
}

export const emptyPrivateStrategyLibraryStr = JSON.stringify(EMPTY_PRIVATE_STRATEGY_LIBRARY, null, 2)
