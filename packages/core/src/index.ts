import * as briefing from './adapters/BriefingAdapter.js'
import * as meteora from './adapters/blockchain/MeteoraAdapter.js'
import * as screening from './adapters/blockchain/ScreeningAdapter.js'
import * as study from './adapters/blockchain/StudyAdapter.js'
import * as token from './adapters/blockchain/TokenDataAdapter.js'
import * as wallet from './adapters/blockchain/WalletAdapter.js'
import * as desktop from './adapters/chat/DesktopAdapter.js'
import * as hivemind from './adapters/external/HivemindAdapter.js'
import * as price from './adapters/external/PriceProvider.js'
import * as telegram from './adapters/notifications/TelegramAdapter.js'
import * as toolExecutor from './adapters/ToolExecutor.js'
import * as domain from './domain/index.js'

export * from './adapters/blockchain/WalletAdapter.js'
export * from './adapters/external/PriceProvider.js'
export { OpenAiChatAdapter } from './adapters/llm/OpenAiChatAdapter.js'
export {
  getNotificationPort,
  resetNotificationPort,
  setNotificationPort,
  telegramNotificationPort,
} from './adapters/notifications/notificationPort.js'
export * from './adapters/ToolDefinitions.js'
export { getToolConfig, resetToolConfig, setToolConfig } from './adapters/tooling/toolConfig.js'
export type { ChainPort, MarketDataPort, ToolPorts, WalletPort } from './adapters/tooling/toolPorts.js'
export { getToolPorts, resetToolPorts, setToolPorts } from './adapters/tooling/toolPorts.js'
// Resolve name collision by explicitly exporting AgentLoopResult from agent-loop.js
export type { AgentLoopResult } from './application/agent-loop.js'
export * from './application/agent-loop.js'
export * from './application/prompt-builder.js'
// Flat exports for standard utilities, types, and configs
export * from './config/Config.js'
export * from './config/config-validation.js'
export * from './config/defaultUserConfig.js'
export * from './domain/index.js'
export type {
  CloseNotification,
  ConfigPort,
  ConfigProvider,
  DeployNotification,
  LiquidationAlertNotification,
  LlmChatRequest,
  LlmChatResponse,
  LlmFactory,
  LlmPort,
  NotificationPort,
  SwapErrorNotification,
  SwapNotification,
  TransactionErrorNotification,
} from './ports/index.js'
export type { StateStorePort, StateStoreReadOptions } from './ports/state-store.js'
export { getConfig, resetConfig, setConfig } from './shared/configProvider.js'
export { getWalletAddress } from './shared/connection.js'
export * from './shared/constants.js'
export * from './shared/ipc-protocol.js'
export * from './shared/keystore.js'
export * from './shared/logger.js'
export * from './shared/mutex.js'
export { getStateStore, readStateFile, resetStateStore, setStateStore, writeStateFile } from './shared/stateStore.js'
export * from './shared/types.js'
export * from './shared/utils.js'
export * from './shared/validation.js'
export * from './tools/index.js'
export * from './utils/time.js'
export { briefing, desktop, domain, hivemind, meteora, price, screening, study, telegram, token, toolExecutor, wallet }
