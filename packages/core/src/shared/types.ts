/**
 * @file types.ts
 * @description Shared TypeScript interfaces and type aliases for positions, pools, tokens, lessons, signals, strategies, config, and agent loop.
 *
 * @features
 * - Position, state, pool, token, lesson, performance, strategy, pool memory, and blacklist types
 * - Decision log, signal weights, signal snapshot, and agent loop types
 * - AppConfig, screening, management, strategy, schedule, LLM, Darwin, PnL, opportunity, GMGN, Jupiter, and indicator config types
 *
 * @dependencies none (pure types)
 */
// ─── Position State ────────────────────────────────────────────

export interface PositionRecord {
  position: string;
  pool: string;
  pool_name: string;
  strategy: string;
  bin_range: BinRange;
  amount_sol: number;
  amount_x: number;
  active_bin_at_deploy: number;
  bin_step: number;
  volatility: number;
  fee_tvl_ratio: number;
  initial_fee_tvl_24h: number;
  organic_score: number;
  initial_value_usd: number;
  entry_mcap: number | null;
  entry_tvl: number | null;
  entry_volume: number | null;
  entry_holders: number | null;
  signal_snapshot: SignalSnapshot | null;
  deployed_at: string;
  out_of_range_since: string | null;
  last_claim_at: string | null;
  total_fees_claimed_usd: number;
  rebalance_count: number;
  closed: boolean;
  closed_at: string | null;
  notes: string[];
  peak_pnl_pct: number;
  pending_peak_pnl_pct: number | null;
  pending_peak_confirm_count: number;
  pending_peak_started_at: string | null;
  pending_exit_action: string | null;
  pending_exit_count: number;
  pending_exit_started_at: string | null;
  trailing_active: boolean;
  instruction?: string | null;
  close_reason?: string;
  recentEvents?: StateEvent[];
}

export interface StateEvent {
  ts: string;
  action: string;
  position?: string;
  pool_name?: string;
  reason?: string;
}

export interface BinRange {
  lower?: number;
  upper?: number;
  min?: number;
  max?: number;
  active?: number;
}

// ─── Pool Types ────────────────────────────────────────────────

export interface PoolDetail {
  address: string;
  name: string;
  pair: string;
  base_mint: string;
  quote_mint: string;
  bin_step: number;
  active_bin: number;
  tvl: number;
  volume_24h: number;
  fee_24h: number;
  fee_tvl_ratio: number;
  apr: number;
  organic_score: number;
  holders: number;
  mcap: number;
  volatility: number;
  price: number;
  token_age_hours?: number;
  launchpad?: string;
  [key: string]: unknown;
}

export interface PoolCandidate extends PoolDetail {
  degen_score?: number;
  smart_wallets_in_pool?: SmartWalletHit[];
  narrative?: string;
  token_info?: TokenInfo;
  fees_sol?: number;
  bot_holders_pct?: number;
  top10_pct?: number;
  pvp_rival?: boolean;
  pvp_symbol?: string;
}

// ─── Position (on-chain) ───────────────────────────────────────

export interface OnChainPosition {
  position: string;
  pool: string;
  pair?: string;
  base_mint?: string;
  quote_mint?: string;
  in_range: boolean;
  pnl_pct: number;
  pnl_usd?: number;
  pnl_pct_suspicious?: boolean;
  unclaimed_fees_usd: number;
  active_bin?: number;
  lower_bin?: number;
  upper_bin?: number;
  value_usd?: number;
  age_minutes?: number;
  fee_per_tvl_24h?: number;
  minutes_out_of_range?: number;
}

// ─── Wallet / Token ────────────────────────────────────────────

export interface WalletBalances {
  sol: number;
  usd: number;
  tokens: TokenBalance[];
}

export interface TokenBalance {
  mint: string;
  symbol: string;
  amount: number;
  usd: number;
}

export interface TokenInfo {
  name: string;
  symbol: string;
  mint: string;
  decimals: number;
  supply: number;
  mcap: number;
  holders: number;
  organic_score?: number;
  narrative?: string;
  bot_holders_pct?: number;
  top10_pct?: number;
  launchpad?: string;
  [key: string]: unknown;
}

export interface TokenHolders {
  total_holders: number;
  top_holders: Array<{
    address: string;
    amount: number;
    pct: number;
    is_bot: boolean;
  }>;
  bot_holders_pct: number;
  top10_pct: number;
}

// ─── Lessons / Performance ─────────────────────────────────────

export interface Lesson {
  id: number;
  rule: string;
  tags: string[];
  outcome: LessonOutcome;
  sourceType?: string;
  confidence?: number;
  context?: string;
  pnl_pct?: number;
  fees_earned_usd?: number;
  initial_value_usd?: number;
  range_efficiency?: number;
  close_reason?: string;
  pool?: string;
  pinned?: boolean;
  role?: AgentRole | null;
  created_at?: string;
  entry_mcap?: number | null;
  entry_tvl?: number | null;
  entry_volume?: number | null;
  exit_mcap?: number | null;
  exit_tvl?: number | null;
  exit_volume?: number | null;
}

export type LessonOutcome =
  | "good"
  | "bad"
  | "poor"
  | "neutral"
  | "manual"
  | "evolution"
  | "failed"
  | "worked";

export interface PerformanceRecord {
  position: string;
  pool: string;
  pool_name: string;
  base_mint?: string;
  strategy: string;
  bin_range: number | BinRange;
  bin_step: number;
  volatility: number;
  fee_tvl_ratio: number;
  organic_score: number;
  amount_sol: number;
  fees_earned_usd: number;
  fees_earned_sol?: number;
  final_value_usd: number;
  initial_value_usd: number;
  minutes_in_range: number;
  minutes_held: number;
  close_reason: string;
  deployed_at?: string;
  signal_snapshot?: SignalSnapshot;
  pnl_usd?: number;
  pnl_pct?: number;
  range_efficiency?: number;
  recorded_at?: string;
  entry_mcap?: number | null;
  entry_tvl?: number | null;
  entry_volume?: number | null;
  exit_mcap?: number | null;
  exit_tvl?: number | null;
  exit_volume?: number | null;
}

export interface LessonsData {
  lessons: Lesson[];
  performance: PerformanceRecord[];
}

// ─── Decision Log ──────────────────────────────────────────────

export type DecisionType = "deploy" | "close" | "skip" | "no_deploy" | "note";

export interface Decision {
  id: string;
  ts: string;
  type: DecisionType;
  actor: string;
  pool: string | null;
  pool_name: string | null;
  position: string | null;
  summary: string | null;
  reason: string | null;
  risks: string[];
  metrics: Record<string, unknown>;
  rejected: string[];
}

// ─── Signal Weights ────────────────────────────────────────────

export type SignalName =
  | "organic_score"
  | "fee_tvl_ratio"
  | "volume"
  | "mcap"
  | "holder_count"
  | "smart_wallets_present"
  | "narrative_quality"
  | "study_win_rate"
  | "hive_consensus"
  | "volatility"
  | "entry_mcap"
  | "entry_tvl"
  | "entry_volume";

export interface SignalWeightsData {
  weights: Partial<Record<SignalName, number>>;
  last_recalc: string | null;
  recalc_count: number;
  history: SignalWeightHistory[];
}

export interface SignalWeightHistory {
  timestamp: string;
  changes: Array<{
    signal: string;
    from: number;
    to: number;
    lift: number;
    action: "boosted" | "decayed";
  }>;
  window_size: number;
  win_count: number;
  loss_count: number;
}

export interface SignalSnapshot extends Partial<Record<SignalName, unknown>> {
  base_mint?: string;
  [key: string]: unknown;
}

// ─── Strategy Library ──────────────────────────────────────────

export interface Strategy {
  id: string;
  name: string;
  author: string;
  lp_strategy: string;
  token_criteria: Record<string, unknown>;
  entry: Record<string, unknown>;
  range: Record<string, unknown>;
  exit: Record<string, unknown>;
  best_for: string;
  raw?: string;
  added_at?: string;
  updated_at?: string;
}

export interface StrategyLibraryData {
  active: string | null;
  strategies: Record<string, Strategy>;
}

// ─── Pool Memory ───────────────────────────────────────────────

export interface PoolMemoryDeploy {
  deployed_at: string | null;
  closed_at: string;
  pnl_pct: number | null;
  pnl_usd: number | null;
  fees_earned_usd: number | null;
  fees_earned_sol: number | null;
  fee_earned_pct: number | null;
  range_efficiency: number | null;
  minutes_held: number | null;
  close_reason: string | null;
  strategy: string | null;
  volatility_at_deploy: number | null;
  entry_mcap: number | null;
  entry_tvl: number | null;
  entry_volume: number | null;
  exit_mcap: number | null;
  exit_tvl: number | null;
  exit_volume: number | null;
}

export interface PoolMemoryEntry {
  name: string;
  base_mint: string | null;
  deploys: PoolMemoryDeploy[];
  total_deploys: number;
  avg_pnl_pct: number;
  win_rate: number;
  adjusted_win_rate: number;
  adjusted_win_rate_sample_count: number;
  last_deployed_at: string | null;
  last_outcome: string | null;
  cooldown_until?: string;
  cooldown_reason?: string;
  base_mint_cooldown_until?: string;
  base_mint_cooldown_reason?: string;
  notes: Array<{ note: string; added_at: string }>;
  snapshots?: PoolSnapshot[];
}

export interface PoolSnapshot {
  ts: string;
  position: string;
  pnl_pct: number | null;
  pnl_usd: number | null;
  in_range: boolean | null;
  unclaimed_fees_usd: number | null;
  minutes_out_of_range: number | null;
  age_minutes: number | null;
}

// ─── Smart Wallets ─────────────────────────────────────────────

export interface SmartWallet {
  name: string;
  address: string;
  category: string;
  type: "lp" | "holder";
  addedAt: string;
}

export interface SmartWalletHit {
  name: string;
  category: string;
  address: string;
}

// ─── Token Blacklist ───────────────────────────────────────────

export interface BlacklistedToken {
  symbol: string;
  reason: string;
  added_at: string;
  added_by: string;
}

// ─── Dev Blocklist ─────────────────────────────────────────────

export interface BlockedDev {
  label: string;
  reason: string;
  added_at: string;
}

// ─── Agent Roles ───────────────────────────────────────────────

export type AgentRole = "SCREENER" | "MANAGER" | "GENERAL";

// ─── Telegram ──────────────────────────────────────────────────

export interface TelegramMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: { id: number; first_name: string; username?: string };
  text?: string;
  date: number;
}

export interface TelegramCallbackQuery {
  id: string;
  data?: string;
  message?: {
    message_id: number;
    chat: { id: number };
    text?: string;
  };
  from: { id: number };
}

// ─── Briefing ──────────────────────────────────────────────────

export interface BriefingData {
  date: string;
  positions_opened: number;
  positions_closed: number;
  total_pnl_usd: number;
  win_rate: number;
  lessons_added: number;
  recent_decisions: Decision[];
  portfolio: {
    open_positions: number;
    total_value_usd: number;
    total_fees_claimed_usd: number;
  };
}

// ─── Tool Definitions ──────────────────────────────────────────

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, ToolParameter>;
      required?: string[];
    };
  };
}

export interface ToolParameter {
  type: string;
  description?: string;
  enum?: string[];
  items?: { type: string };
  properties?: Record<string, ToolParameter>;
  required?: string[];
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolResult {
  tool_call_id: string;
  role: "tool";
  content: string;
}

// ─── Agent Loop ────────────────────────────────────────────────

export interface AgentMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface AgentLoopOptions {
  agentType?: AgentRole;
  model?: string;
  maxTokens?: number;
  maxSteps?: number;
  onToolStart?: (name: string, args: Record<string, unknown>) => void;
  onToolFinish?: (name: string, args: Record<string, unknown>, result: unknown, durationMs: number) => void;
  forceModel?: boolean;
}

export interface AgentLoopResult {
  response: string;
  toolCalls: number;
  steps: number;
  model: string;
}

// ─── Config (derived from Zod schema) ─────────────────────────

export interface AppConfig {
  risk: {
    maxPositions: number;
    maxDeployAmount: number;
  };
  screening: ScreeningConfig;
  management: ManagementConfig;
  strategy: StrategyConfig;
  schedule: ScheduleConfig;
  llm: LlmConfig;
  darwin: DarwinConfig;
  tokens: TokenMints;
  hiveMind: HiveMindConfig;
  api: ApiConfig;
  pnl: PnlConfig;
  opportunity: OpportunityConfig;
  gmgn: GmgnConfig;
  jupiter: JupiterConfig;
  indicators: IndicatorConfig;
}

export interface ScreeningConfig {
  excludeHighSupplyConcentration: boolean;
  minFeeActiveTvlRatio: number;
  minTvl: number;
  maxTvl: number;
  minVolume: number;
  minOrganic: number;
  minQuoteOrganic: number;
  minHolders: number;
  minMcap: number;
  maxMcap: number;
  minBinStep: number;
  maxBinStep: number;
  timeframe: string;
  category: string;
  minTokenFeesSol: number;
  useDiscordSignals: boolean;
  discordSignalMode: string;
  avoidPvpSymbols: boolean;
  blockPvpSymbols: boolean;
  maxBotHoldersPct: number;
  maxTop10Pct: number;
  loneCandidateMinDegen: number;
  allowedLaunchpads: string[];
  blockedLaunchpads: string[];
  minTokenAgeHours: number | null;
  maxTokenAgeHours: number | null;
}

export interface ManagementConfig {
  minClaimAmount: number;
  autoSwapAfterClaim: boolean;
  autoSwapRetryAttempts: number;
  autoSwapRetryDelayMs: number;
  outOfRangeBinsToClose: number;
  outOfRangeWaitMinutes: number;
  oorCooldownTriggerCount: number;
  oorCooldownHours: number;
  repeatDeployCooldownEnabled: boolean;
  repeatDeployCooldownTriggerCount: number;
  repeatDeployCooldownHours: number;
  repeatDeployCooldownScope: string;
  repeatDeployCooldownMinFeeEarnedPct: number;
  minVolumeToRebalance: number;
  stopLossPct: number;
  takeProfitPct: number;
  minFeePerTvl24h: number;
  minAgeBeforeYieldCheck: number;
  minSolToOpen: number;
  deployAmountSol: number;
  gasReserve: number;
  positionSizePct: number;
  trailingTakeProfit: boolean;
  trailingTriggerPct: number;
  trailingDropPct: number;
  pnlSanityMaxDiffPct: number;
  solMode: boolean;
}

export interface StrategyConfig {
  strategy: string;
  minBinsBelow: number;
  maxBinsBelow: number;
  defaultBinsBelow: number;
}

export interface ScheduleConfig {
  managementIntervalMin: number;
  screeningIntervalMin: number;
  healthCheckIntervalMin: number;
}

export interface LlmConfig {
  temperature: number;
  maxTokens: number;
  maxSteps: number;
  managementModel: string;
  screeningModel: string;
  generalModel: string;
}

export interface DarwinConfig {
  enabled: boolean;
  windowDays: number;
  recalcEvery: number;
  boostFactor: number;
  decayFactor: number;
  weightFloor: number;
  weightCeiling: number;
  minSamples: number;
}

export interface TokenMints {
  SOL: string;
  USDC: string;
  USDT: string;
}

export interface HiveMindConfig {
  url: string | null;
  apiKey: string | null;
  agentId: string | null;
  pullMode: string;
}

export interface ApiConfig {
  url: string | null;
  publicApiKey: string | null;
  lpAgentRelayEnabled: boolean;
}

export interface PnlConfig {
  rpcUrl: string;
  source: string;
  pollIntervalSec: number;
  depositCacheTtlSec: number;
  confirmTicks: number;
}

export interface OpportunityConfig {
  enabled: boolean;
  pollIntervalSec: number;
  limit: number;
  minScore: number;
  smartWalletScoreBonus: number;
  targetVolRatio: number;
  targetLpCount: number;
  targetFeeRatio: number;
  targetLiquidity: number;
}

export interface GmgnConfig {
  apiKey: string | null;
  baseUrl: string;
  requestDelayMs: number;
  maxRetries: number;
  feeSource: string;
}

export interface JupiterConfig {
  apiKey: string;
  referralAccount: string;
  referralFeeBps: number;
}

export interface IndicatorConfig {
  enabled: boolean;
  entryPreset: string;
  exitPreset: string;
  rsiLength: number;
  intervals: string[];
  candles: number;
  rsiOversold: number;
  rsiOverbought: number;
  requireAllIntervals: boolean;
}

// ─── Exit Actions ──────────────────────────────────────────────

export type ExitAction =
  | "STOP_LOSS"
  | "TRAILING_TP"
  | "OUT_OF_RANGE"
  | "LOW_YIELD";

export interface ExitResult {
  action: ExitAction;
  reason: string;
  needs_confirmation?: boolean;
  peak_pnl_pct?: number;
  current_pnl_pct?: number;
  drop_from_peak_pct?: number;
}

// ─── State Summary ─────────────────────────────────────────────

export interface StateSummary {
  open_positions: number;
  closed_positions: number;
  total_fees_claimed_usd: number;
  positions: Array<{
    position: string;
    pool: string;
    strategy: string;
    deployed_at: string;
    out_of_range_since: string | null;
    minutes_out_of_range: number;
    total_fees_claimed_usd: number;
    initial_fee_tvl_24h: number;
    rebalance_count: number;
    instruction: string | null;
  }>;
  last_updated: string | null;
  recent_events: StateEvent[];
}

// ─── HiveMind ──────────────────────────────────────────────────

export interface HiveMindSharedLesson {
  id: string;
  rule: string;
  tags: string[];
  outcome: string;
  agentId?: string;
  createdAt?: string;
}

export interface HiveMindCache {
  sharedLessons: HiveMindSharedLesson[];
  presets: unknown[];
  pulledAt: string | null;
}
