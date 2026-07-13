import * as meteora from './adapters/blockchain/MeteoraAdapter.js';
import * as wallet from './adapters/blockchain/WalletAdapter.js';
import * as screening from './adapters/blockchain/ScreeningAdapter.js';
import * as token from './adapters/blockchain/TokenDataAdapter.js';
import * as study from './adapters/blockchain/StudyAdapter.js';
import * as telegram from './adapters/notifications/TelegramAdapter.js';
import * as briefing from './adapters/BriefingAdapter.js';
import * as hivemind from './adapters/external/HivemindAdapter.js';
import * as toolExecutor from './adapters/ToolExecutor.js';
import * as domain from './domain/index.js';

export { meteora, wallet, screening, token, study, telegram, briefing, hivemind, toolExecutor, domain };

// Flat exports for standard utilities, types, and configs
export * from './config/Config.js';
export * from './shared/logger.js';
export * from './shared/constants.js';
export * from './shared/types.js';
export * from './adapters/ToolDefinitions.js';
export * from './application/agent-loop.js';
export * from './application/prompt-builder.js';
export * from './domain/index.js';

// Resolve name collision by explicitly exporting AgentLoopResult from agent-loop.js
export type { AgentLoopResult } from './application/agent-loop.js';
