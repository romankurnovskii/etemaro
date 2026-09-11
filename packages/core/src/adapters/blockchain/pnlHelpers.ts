/**
 * @file pnlHelpers.ts
 * @description Position/PnL normalisation helpers extracted from MeteoraAdapter.
 */
import { config } from '../../config/Config.js'
import { getAndClearStagedSignals } from '../../domain/signal-tracker.js'
import { DEFAULT_AGENT_ID } from '../../shared/constants.js'
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
