/**
 * @file pnlHelpers.ts
 * @description Position/PnL normalisation helpers extracted from MeteoraAdapter.
 */
import { config } from '../../config/Config.js'
import { getAndClearStagedSignals } from '../../domain/signal-tracker.js'
import { DEFAULT_AGENT_ID, TOKEN_MINTS } from '../../shared/constants.js'
import { agentMeridianJson, getAgentMeridianHeaders } from '../external/AgentMeridianClient.js'

export function safeNum(value: any): number {
  const n = parseFloat(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

export function maybeNum(value: any): number | null {
  if (value == null || value === '') return null
  const n = parseFloat(value)
  return Number.isFinite(n) ? n : null
}

export function roundNum(value: number | undefined | null, decimals = 4): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  const factor = 10 ** decimals
  return Math.round(n * factor) / factor
}

const PERFORMANCE_SIGNAL_FIELDS = [
  'organic_score',
  'fee_tvl_ratio',
  'volume',
  'mcap',
  'holder_count',
  'smart_wallets_present',
  'narrative_quality',
  'study_win_rate',
  'hive_consensus',
  'volatility',
]

export function resolvePerformanceSignalSnapshot({
  poolAddress,
  baseMint,
  tracked,
}: {
  poolAddress: string
  baseMint: string
  tracked: any
}) {
  const staged = config.darwin?.enabled ? getAndClearStagedSignals(poolAddress, baseMint) : null
  const snapshot: any = {
    ...(staged || {}),
    ...(tracked?.signal_snapshot || {}),
  }

  if (baseMint && snapshot.base_mint == null) snapshot.base_mint = baseMint
  for (const field of PERFORMANCE_SIGNAL_FIELDS) {
    if (snapshot[field] == null && tracked?.[field] != null) {
      snapshot[field] = tracked[field]
    }
  }

  return Object.values(snapshot).some((value: any) => value != null) ? snapshot : null
}

export function getClosedPnlValue(posEntry: any, solMode = false): number {
  return solMode
    ? (maybeNum(posEntry?.pnlSol) ?? maybeNum(posEntry?.pnl?.valueNative) ?? 0)
    : (maybeNum(posEntry?.pnlUsd) ?? maybeNum(posEntry?.pnl?.value) ?? 0)
}

export function getClosedPnlPct(posEntry: any, solMode = false): number {
  const reported = solMode
    ? (maybeNum(posEntry?.pnlSolPctChange) ?? maybeNum(posEntry?.pnl?.percentNative))
    : (maybeNum(posEntry?.pnlPctChange) ?? maybeNum(posEntry?.pnl?.percent))
  if (reported != null) return reported

  const pnl = getClosedPnlValue(posEntry, solMode)
  const deposit = solMode
    ? maybeNum(posEntry?.allTimeDeposits?.total?.sol)
    : maybeNum(posEntry?.allTimeDeposits?.total?.usd)
  return deposit && deposit > 0 ? (pnl / deposit) * 100 : 0
}

export function deriveOpenPnlPct(binData: any, solMode = false): number | null {
  if (!binData) return null

  const deposit = solMode ? safeNum(binData.allTimeDeposits?.total?.sol) : safeNum(binData.allTimeDeposits?.total?.usd)
  if (deposit <= 0) return null

  const balances = solMode ? safeNum(binData.unrealizedPnl?.balancesSol) : safeNum(binData.unrealizedPnl?.balances)
  const unclaimedFees = solMode
    ? safeNum(binData.unrealizedPnl?.unclaimedFeeTokenX?.amountSol) +
      safeNum(binData.unrealizedPnl?.unclaimedFeeTokenY?.amountSol)
    : safeNum(binData.unrealizedPnl?.unclaimedFeeTokenX?.usd) + safeNum(binData.unrealizedPnl?.unclaimedFeeTokenY?.usd)
  const withdrawals = solMode
    ? safeNum(binData.allTimeWithdrawals?.total?.sol)
    : safeNum(binData.allTimeWithdrawals?.total?.usd)
  const fees = solMode ? safeNum(binData.allTimeFees?.total?.sol) : safeNum(binData.allTimeFees?.total?.usd)

  const pnl = balances + unclaimedFees + withdrawals + fees - deposit
  return (pnl / deposit) * 100
}

export function deriveLpAgentPnlPct(lpData: any, solMode = false): number | null {
  if (!lpData) return null
  const deposit = solMode ? safeNum(lpData.inputNative) : safeNum(lpData.inputValue)
  if (deposit <= 0) return null

  const currentValue = solMode ? safeNum(lpData.valueNative) : safeNum(lpData.value)
  const unclaimedFees = solMode ? safeNum(lpData.unCollectedFeeNative) : safeNum(lpData.unCollectedFee)
  const pnl = currentValue + unclaimedFees - deposit
  return (pnl / deposit) * 100
}

const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111111'
const WSOL_MINT = TOKEN_MINTS.SOL

/** True for wrapped SOL and native SOL mints. */
export function isSolMint(mint?: string | null): boolean {
  return mint === WSOL_MINT || mint === NATIVE_SOL_MINT
}

/**
 * Pick the non-SOL (base/meme) mint for a closed pool.
 *
 * Meteora DLMM exposes the quote side on either `tokenX` or `tokenY`, so we
 * cannot assume `tokenX` is the base token. We prefer the tracked base mint and
 * fall back to whichever side is not SOL.
 */
export function resolveNonSolMint({
  trackedBaseMint,
  tokenXMint,
  tokenYMint,
}: {
  trackedBaseMint?: string | null
  tokenXMint?: string | null
  tokenYMint?: string | null
}): string {
  const candidates = [trackedBaseMint, tokenXMint, tokenYMint]
  for (const candidate of candidates) {
    if (candidate && !isSolMint(candidate)) return candidate
  }
  return tokenXMint || tokenYMint || trackedBaseMint || ''
}

export interface CloseAccounting {
  status: 'realized' | 'closed_pending_swap'
  /** USD value of the SOL actually returned to the wallet at close. */
  cashRealizedUsd: number
  /** USD value of base tokens still held in the wallet awaiting a swap. */
  unrealizedResidualUsd: number
  /** Base-token units still held in the wallet. */
  unrealizedTokensAmount: number
  /** Whether a genuine, above-dust base-token inventory was detected. */
  hasUnsoldInventory: boolean
}

/**
 * Decide how a just-closed position splits between realized SOL cash and unsold
 * base-token inventory.
 *
 * We must never assume a non-SOL pool always leaves tokens behind. A single-sided
 * bid-ask position that closes as 100% SOL has no inventory; classifying it as
 * `closed_pending_swap` with `cash_realized_usd = 0` previously let the
 * mark-to-market sweeper collapse its value to a phantom -100% loss.
 */
export function resolveCloseAccounting({
  finalValueUsd,
  unsoldTokensAmount,
  unsoldTokensUsd,
  sweeperMinUsd = 0.02,
}: {
  finalValueUsd: number
  unsoldTokensAmount?: number | null
  unsoldTokensUsd?: number | null
  sweeperMinUsd?: number
}): CloseAccounting {
  const final = Number.isFinite(finalValueUsd) ? Math.max(0, finalValueUsd) : 0
  const amount = Number.isFinite(unsoldTokensAmount as number) ? Math.max(0, unsoldTokensAmount as number) : 0
  const unsoldUsd = Number.isFinite(unsoldTokensUsd as number) ? Math.max(0, unsoldTokensUsd as number) : 0
  const threshold = Number.isFinite(sweeperMinUsd) ? Math.max(0, sweeperMinUsd) : 0.02

  const hasUnsoldInventory = amount > 0 && unsoldUsd >= threshold
  if (!hasUnsoldInventory) {
    return {
      status: 'realized',
      cashRealizedUsd: roundNum(final, 2),
      unrealizedResidualUsd: 0,
      unrealizedTokensAmount: 0,
      hasUnsoldInventory: false,
    }
  }

  // Guard against a stale wallet price exceeding the withdrawn total.
  const residual = roundNum(Math.min(unsoldUsd, final > 0 ? final : unsoldUsd), 2)
  return {
    status: 'closed_pending_swap',
    cashRealizedUsd: roundNum(Math.max(0, final - residual), 2),
    unrealizedResidualUsd: residual,
    unrealizedTokensAmount: amount,
    hasUnsoldInventory: true,
  }
}

export async function _fetchRawOpenPositionsFromMeridian({
  walletAddress,
  agentId,
}: {
  walletAddress: string
  agentId?: string
}) {
  const search = new URLSearchParams({
    owner: walletAddress,
    agentId: agentId || DEFAULT_AGENT_ID,
  })
  const payload = await agentMeridianJson(`/positions/open/raw?${search.toString()}`, {
    headers: getAgentMeridianHeaders(),
    retry: {
      maxElapsedMs: 30_000,
      perAttemptTimeoutMs: 10_000,
    },
  })
  const rows = Array.isArray(payload?.data) ? payload.data : []
  const byPosition: Record<string, any> = {}
  for (const row of rows) {
    const addr = row?.position || row?.id || row?.tokenId
    if (addr) byPosition[addr] = row
  }
  return {
    ...payload,
    data: rows,
    byPosition,
  }
}
