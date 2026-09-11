/**
 * @file toolPorts.ts
 * @description Injectable tool-side adapter ports. ToolExecutor resolves chain, market-data,
 * and wallet operations through this seam, so concrete adapters can be swapped in one place.
 */
import * as Meteora from '../blockchain/MeteoraAdapter.js'
import * as Screening from '../blockchain/ScreeningAdapter.js'
import * as Study from '../blockchain/StudyAdapter.js'
import * as TokenData from '../blockchain/TokenDataAdapter.js'
import * as Wallet from '../blockchain/WalletAdapter.js'

export interface ChainPort {
  claimFees: typeof Meteora.claimFees
  closePosition: typeof Meteora.closePosition
  deployPosition: typeof Meteora.deployPosition
  getActiveBin: typeof Meteora.getActiveBin
  getMyPositions: typeof Meteora.getMyPositions
  getPositionPnl: typeof Meteora.getPositionPnl
  getWalletPositions: typeof Meteora.getWalletPositions
  searchPools: typeof Meteora.searchPools
  swapDirectDlmm: typeof Meteora.swapDirectDlmm
}

export interface MarketDataPort {
  discoverPools: typeof Screening.discoverPools
  getPoolDetail: typeof Screening.getPoolDetail
  getTopCandidates: typeof Screening.getTopCandidates
  studyTopLPers: typeof Study.studyTopLPers
  getTokenHolders: typeof TokenData.getTokenHolders
  getTokenInfo: typeof TokenData.getTokenInfo
  getTokenNarrative: typeof TokenData.getTokenNarrative
}

export interface WalletPort {
  getWalletBalances: typeof Wallet.getWalletBalances
  swapToken: typeof Wallet.swapToken
}

export interface ToolPorts {
  chain: ChainPort
  market: MarketDataPort
  wallet: WalletPort
}

const defaultToolPorts: ToolPorts = {
  chain: {
    claimFees: Meteora.claimFees,
    closePosition: Meteora.closePosition,
    deployPosition: Meteora.deployPosition,
    getActiveBin: Meteora.getActiveBin,
    getMyPositions: Meteora.getMyPositions,
    getPositionPnl: Meteora.getPositionPnl,
    getWalletPositions: Meteora.getWalletPositions,
    searchPools: Meteora.searchPools,
    swapDirectDlmm: Meteora.swapDirectDlmm,
  },
  market: {
    discoverPools: Screening.discoverPools,
    getPoolDetail: Screening.getPoolDetail,
    getTopCandidates: Screening.getTopCandidates,
    studyTopLPers: Study.studyTopLPers,
    getTokenHolders: TokenData.getTokenHolders,
    getTokenInfo: TokenData.getTokenInfo,
    getTokenNarrative: TokenData.getTokenNarrative,
  },
  wallet: {
    getWalletBalances: Wallet.getWalletBalances,
    swapToken: Wallet.swapToken,
  },
}

let activeToolPorts: ToolPorts = defaultToolPorts

export function getToolPorts(): ToolPorts {
  return activeToolPorts
}

export function setToolPorts(ports: ToolPorts): void {
  activeToolPorts = ports
}

export function resetToolPorts(): void {
  activeToolPorts = defaultToolPorts
}
