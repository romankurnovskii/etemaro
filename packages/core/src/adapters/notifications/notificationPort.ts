/**
 * @file notificationPort.ts
 * @description Default NotificationPort implementation (Telegram) plus a swappable
 * module-level binding so callers can be handed a different notification backend.
 */
import type { NotificationPort } from '../../ports/notifications.js'
import {
  notifyClose,
  notifyDeploy,
  notifyLiquidationAlert,
  notifySwap,
  notifySwapError,
  notifyTransactionError,
} from './TelegramAdapter.js'

export const telegramNotificationPort: NotificationPort = {
  notifyDeploy,
  notifyClose,
  notifySwap,
  notifySwapError,
  notifyLiquidationAlert,
  notifyTransactionError,
}

let activePort: NotificationPort = telegramNotificationPort

export function getNotificationPort(): NotificationPort {
  return activePort
}

export function setNotificationPort(port: NotificationPort): void {
  activePort = port
}

export function resetNotificationPort(): void {
  activePort = telegramNotificationPort
}
