/**
 * @file notifications.ts
 * @description Notification port. Outbound-alert seam so callers do not depend on a
 * concrete messaging backend (Telegram today).
 */

export interface DeployNotification {
  pair: string
  amountSol: number
  position: string
  tx: string
  priceRange?: { min: number; max: number }
  rangeCoverage?: { downside_pct: number; upside_pct: number; width_pct: number }
  binStep?: number
  baseFee?: number
}

export interface CloseNotification {
  pair: string
  pnlUsd: number
  pnlPct: number
  status?: 'realized' | 'closed_pending_swap' | 'abandoned_loss'
  solReceived?: number
}

export interface SwapNotification {
  inputSymbol: string
  outputSymbol: string
  amountIn: string
  amountOut: string
  tx: string
  amountUsd?: number | null
}

export interface SwapErrorNotification {
  inputSymbol: string
  outputSymbol: string
  reason?: string
}

export interface LiquidationAlertNotification {
  symbol?: string
  mint: string
  amount: number
  usd?: number | null
  reason?: string
  attempts?: number
}

export interface TransactionErrorNotification {
  type: string
  pair?: string
  position?: string
  reason: string
  tx?: string
}

export interface NotificationPort {
  notifyDeploy(data: DeployNotification): Promise<unknown>
  notifyClose(data: CloseNotification): Promise<unknown>
  notifySwap(data: SwapNotification): Promise<unknown>
  notifySwapError(data: SwapErrorNotification): Promise<unknown>
  notifyLiquidationAlert(data: LiquidationAlertNotification): Promise<unknown>
  notifyTransactionError(data: TransactionErrorNotification): Promise<unknown>
}
