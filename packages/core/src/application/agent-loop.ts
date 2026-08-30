/**
 * @file agent-loop.ts
 * @description Core ReAct autonomous agent loop orchestrating LLM reasoning, tool definitions, tool execution, and session state.
 *
 * @features
 * - Sends system and user messages to OpenAI-compatible LLM providers
 * - Parses and executes tool calls with JSON repair, retry fallback, and role permissions
 * - Emits real-time live progress updates to Telegram and Desktop UI sinks
 *
 * @dependencies OpenAI, jsonrepair, Config, ToolDefinitions, ToolExecutor
 * @sideEffects LLM inference network requests and automated tool action execution
 */

import OpenAI from 'openai';
import { jsonrepair } from 'jsonrepair';
import { buildSystemPrompt } from './prompt-builder.js';
import { config } from '../config/Config.js';
import { log, logStructured, createCorrelationId, setCorrelationId, createTimer } from '../shared/logger.js';
import type { AgentRole, AgentMessage, WalletBalances, OnChainPosition, StateSummary } from '../shared/types.js';

// ─── Tool definitions (imported dynamically at call site via adapter) ───

export interface ToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

type ToolExecutorFn = (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
type GetToolsFn = () => ToolDef[];
type GetWalletFn = () => Promise<WalletBalances>;
type GetPositionsFn = (opts?: { force?: boolean }) => Promise<{ positions: OnChainPosition[]; total_positions: number }>;
type GetStateSummaryFn = () => StateSummary;
type GetLessonsFn = (opts: { agentType: AgentRole }) => string | null;
type GetPerfSummaryFn = () => string | null;
type GetDecisionSummaryFn = () => string | null;
type GetWeightsSummaryFn = () => string | null;

// ─── Tool Set Definitions ───────────────────────────────────────

export const MANAGER_TOOLS = new Set(['close_position', 'claim_fees', 'swap_token', 'get_position_pnl', 'get_my_positions', 'get_wallet_balance']);

export const SCREENER_TOOLS = new Set([
  'deploy_position',
  'get_active_bin',
  'get_top_candidates',
  'check_smart_wallets_on_pool',
  'get_token_holders',
  'get_token_narrative',
  'get_token_info',
  'search_pools',
  'get_pool_memory',
  'get_wallet_balance',
  'get_my_positions',
]);

export const GENERAL_INTENT_ONLY_TOOLS = new Set([
  'self_update',
  'update_config',
  'add_to_blacklist',
  'remove_from_blacklist',
  'block_deployer',
  'unblock_deployer',
  'add_pool_note',
  'set_position_note',
  'add_smart_wallet',
  'remove_smart_wallet',
  'add_lesson',
  'pin_lesson',
  'unpin_lesson',
  'clear_lessons',
  'add_strategy',
  'remove_strategy',
  'set_active_strategy',
]);

// Intent → tool subsets for GENERAL role
export const INTENT_TOOLS: Record<string, Set<string>> = {
  decisions: new Set(['get_recent_decisions']),
  deploy: new Set([
    'deploy_position',
    'get_top_candidates',
    'get_active_bin',
    'get_pool_memory',
    'check_smart_wallets_on_pool',
    'get_token_holders',
    'get_token_narrative',
    'get_token_info',
    'search_pools',
    'get_wallet_balance',
    'get_my_positions',
    'add_pool_note',
  ]),
  close: new Set(['close_position', 'get_my_positions', 'get_position_pnl', 'get_wallet_balance', 'swap_token']),
  claim: new Set(['claim_fees', 'get_my_positions', 'get_position_pnl', 'get_wallet_balance']),
  swap: new Set(['swap_token', 'get_wallet_balance']),
  config: new Set(['update_config']),
  blocklist: new Set(['add_to_blacklist', 'remove_from_blacklist', 'list_blacklist', 'block_deployer', 'unblock_deployer', 'list_blocked_deployers']),
  selfupdate: new Set(['self_update']),
  balance: new Set(['get_wallet_balance', 'get_my_positions', 'get_wallet_positions']),
  positions: new Set(['get_my_positions', 'get_position_pnl', 'get_wallet_balance', 'set_position_note', 'get_wallet_positions']),
  strategy: new Set([
    'list_strategies',
    'get_strategy',
    'add_strategy',
    'update_strategy',
    'delete_strategy',
    'remove_strategy',
    'set_active_strategy',
  ]),
  screen: new Set([
    'get_top_candidates',
    'get_token_holders',
    'get_token_narrative',
    'get_token_info',
    'search_pools',
    'check_smart_wallets_on_pool',
    'get_pool_detail',
    'get_my_positions',
    'discover_pools',
  ]),
  memory: new Set(['get_pool_memory', 'add_pool_note', 'list_blacklist', 'add_to_blacklist', 'remove_from_blacklist']),
  smartwallet: new Set(['add_smart_wallet', 'remove_smart_wallet', 'list_smart_wallets', 'check_smart_wallets_on_pool']),
  study: new Set([
    'study_top_lpers',
    'get_top_lpers',
    'get_pool_detail',
    'search_pools',
    'get_token_info',
    'discover_pools',
    'add_smart_wallet',
    'list_smart_wallets',
  ]),
  performance: new Set(['get_performance_history', 'get_my_positions', 'get_position_pnl']),
  lessons: new Set(['add_lesson', 'pin_lesson', 'unpin_lesson', 'list_lessons', 'clear_lessons']),
};

export const INTENT_PATTERNS: Array<{ intent: string; re: RegExp }> = [
  {
    intent: 'decisions',
    re: /\b(why did you|why'd you|why was (?:this|that|it)|what made you|what was the reason|why no deploy|why didn't you deploy|why did you close|why did you deploy|why did you skip)\b/i,
  },
  { intent: 'deploy', re: /\b(deploy|open|add liquidity|lp into|invest in)\b/i },
  { intent: 'close', re: /\b(close|exit|withdraw|remove liquidity|shut down)\b/i },
  { intent: 'claim', re: /\b(claim|harvest|collect)\b.*\bfee/i },
  { intent: 'swap', re: /\b(swap|convert|sell|exchange)\b/i },
  { intent: 'selfupdate', re: /\b(self.?update|git pull|pull latest|update (the )?bot|update (the )?agent|update yourself)\b/i },
  { intent: 'blocklist', re: /\b(blacklist|block|unblock|blocklist|blocked deployer|rugger|block dev|block deployer)\b/i },
  { intent: 'config', re: /\b(config|setting|threshold|update|set |change)\b/i },
  { intent: 'balance', re: /\b(balance|wallet|sol|how much)\b/i },
  { intent: 'positions', re: /\b(position|portfolio|open|pnl|yield|range)\b/i },
  { intent: 'strategy', re: /\b(strategy|strategies)\b/i },
  { intent: 'screen', re: /\b(screen|candidate|find pool|search|research|token)\b/i },
  { intent: 'memory', re: /\b(memory|pool history|note|remember)\b/i },
  {
    intent: 'smartwallet',
    re: /\b(smart wallet|kol|whale|watch.?list|add wallet|remove wallet|list wallet|tracked wallet|check pool|who.?s in|wallets in|add to (smart|watch|kol))\b/i,
  },
  { intent: 'study', re: /\b(study top|top lpers?|best lpers?|who.?s lping|lp behavior|lpers?)\b/i },
  { intent: 'performance', re: /\b(performance|history|how.?s the bot|how.?s it doing|stats|report)\b/i },
  { intent: 'lessons', re: /\b(lesson|learned|teach|pin|unpin|clear lesson|what did you learn)\b/i },
];

export const ONCE_PER_SESSION = new Set(['deploy_position', 'swap_token', 'close_position']);
export const NO_RETRY_TOOLS = new Set(['deploy_position']);

const MUTATING_TOOL_INTENTS =
  /\b(deploy|open position|add liquidity|lp into|invest in|close|exit|withdraw|remove liquidity|claim|harvest|collect|swap|convert|sell|exchange|block|unblock|blacklist|add smart wallet|remove smart wallet|add wallet|remove wallet|pin|unpin|clear lesson|add lesson|set active strategy|remove strategy|add strategy|set |change |update |self.?update|pull latest|git pull|update yourself)\b/i;
const LIVE_DATA_TOOL_INTENTS =
  /\b(balance|wallet|position|portfolio|pnl|yield|range|show positions|open positions|screen|candidate|find pool|search|research|analyze|check pool|token holders|narrative|study top|top lpers?|lp behavior|who.?s lping|performance|history|stats|report|list smart wallets|list blacklist|list blocked deployers|list lessons)\b/i;
const CONFIG_READ_ONLY_INTENTS = /\b(check|show|what(?:'s| is)?|review|inspect|see)\b.*\b(config|settings?|thresholds?)\b/i;
const DECISION_EXPLANATION_INTENTS =
  /\b(why did you|why'd you|why was (?:this|that|it)|what made you|what was the reason|why no deploy|why didn't you deploy|why did you close|why did you deploy|why did you skip)\b/i;
const ACTION_INTENTS = /\b(deploy|open|add liquidity|close|exit|withdraw|claim|swap|block|unblock)\b/i;

// ─── Helpers ────────────────────────────────────────────────────

function getToolsForRole(agentType: AgentRole, allTools: ToolDef[], goal = ''): ToolDef[] {
  if (agentType === 'MANAGER') return allTools.filter((t) => MANAGER_TOOLS.has(t.function.name));
  if (agentType === 'SCREENER') return allTools.filter((t) => SCREENER_TOOLS.has(t.function.name));

  // GENERAL: match intent from goal, combine matched tool sets
  const matched = new Set<string>();
  for (const { intent, re } of INTENT_PATTERNS) {
    if (re.test(goal)) {
      const tools = INTENT_TOOLS[intent];
      if (tools) for (const t of tools) matched.add(t);
    }
  }

  // Fall back to all tools if no intent matched
  if (matched.size === 0) return allTools.filter((t) => !GENERAL_INTENT_ONLY_TOOLS.has(t.function.name));
  return allTools.filter((t) => matched.has(t.function.name));
}

function shouldRequireRealToolUse(goal: string, agentType: AgentRole, interactive = false): boolean {
  if (agentType === 'MANAGER') return false;
  if (DECISION_EXPLANATION_INTENTS.test(goal)) return false;
  if (CONFIG_READ_ONLY_INTENTS.test(goal)) return false;
  if (MUTATING_TOOL_INTENTS.test(goal)) return true;
  return interactive && LIVE_DATA_TOOL_INTENTS.test(goal);
}

function buildMessages(
  systemPrompt: string,
  sessionHistory: AgentMessage[],
  goal: string,
  providerMode: 'system' | 'user_embedded' = 'system',
): AgentMessage[] {
  if (providerMode === 'user_embedded') {
    return [
      ...sessionHistory,
      {
        role: 'user',
        content: `[SYSTEM INSTRUCTIONS]\n${systemPrompt}\n\n[USER REQUEST]\n${goal}`,
      },
    ];
  }

  return [{ role: 'system', content: systemPrompt }, ...sessionHistory, { role: 'user', content: goal }];
}

function isSystemRoleError(error: unknown): boolean {
  const message = String((error as any)?.message || (error as any)?.error?.message || error || '');
  return /invalid message role:\s*system/i.test(message);
}

function isToolChoiceRequiredError(error: unknown): boolean {
  const message = String((error as any)?.message || (error as any)?.error?.message || error || '');
  return /tool_choice/i.test(message) && /required/i.test(message);
}

function isThinkingModeToolChoiceError(error: unknown): boolean {
  const message = String((error as any)?.message || (error as any)?.error?.message || error || '');
  return /thinking mode does not support/i.test(message) && /tool_choice/i.test(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Summarize tool args for structured logging — truncates long values,
 * strips sensitive fields, and keeps only first-level keys.
 */
function summarizeToolArgs(args: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  const SENSITIVE_KEYS = new Set(['private_key', 'secret', 'api_key', 'apiKey', 'token']);
  for (const [key, value] of Object.entries(args)) {
    if (SENSITIVE_KEYS.has(key)) {
      summary[key] = '[REDACTED]';
    } else if (typeof value === 'string') {
      summary[key] = value.length > 100 ? value.slice(0, 100) + '...' : value;
    } else {
      summary[key] = value;
    }
  }
  return summary;
}

/**
 * Summarize a tool result for structured logging — extracts key fields
 * and truncates large payloads.
 */
function summarizeToolResult(result: Record<string, unknown>): Record<string, unknown> | string {
  if (!result) return 'null';
  const str = JSON.stringify(result);
  if (str.length > 500) {
    try {
      const summary: Record<string, unknown> = {};
      for (const key of ['success', 'error', 'blocked', 'reason', 'tx', 'position', 'pool', 'pnl_usd', 'pnl_pct']) {
        if (key in result) summary[key] = result[key];
      }
      return Object.keys(summary).length > 0 ? summary : str.slice(0, 500) + '...(truncated)';
    } catch {
      return str.slice(0, 500) + '...(truncated)';
    }
  }
  return result;
}

// ─── Agent Loop Options ─────────────────────────────────────────

export interface AgentLoopCallbacks {
  onToolStart?: (info: { name: string; args: Record<string, unknown>; step: number }) => void | Promise<void>;
  onToolFinish?: (info: {
    name: string;
    args: Record<string, unknown>;
    result: Record<string, unknown>;
    success: boolean;
    step: number;
  }) => void | Promise<void>;
}

export interface AgentLoopResult {
  content: string;
  userMessage: string;
}

export interface AgentLoopDeps {
  executeTool: ToolExecutorFn;
  getTools: GetToolsFn;
  getWalletBalances: GetWalletFn;
  getMyPositions: GetPositionsFn;
  getStateSummary: GetStateSummaryFn;
  getLessonsForPrompt: GetLessonsFn;
  getPerformanceSummary: GetPerfSummaryFn;
  getDecisionSummary: GetDecisionSummaryFn;
  getWeightsSummary?: GetWeightsSummaryFn;
}

// ─── Core ReAct Agent Loop ──────────────────────────────────────

export async function agentLoop(
  goal: string,
  maxSteps: number = config.llm.maxSteps,
  sessionHistory: AgentMessage[] = [],
  agentType: AgentRole = 'GENERAL',
  model: string | null = null,
  maxOutputTokens: number | null = null,
  options: AgentLoopCallbacks & { interactive?: boolean } & { deps: AgentLoopDeps },
): Promise<AgentLoopResult> {
  const { interactive = false, onToolStart = null, onToolFinish = null, deps } = options;

  // Generate correlation ID for this agent loop invocation
  const correlationId = createCorrelationId();
  setCorrelationId(correlationId);
  logStructured({
    category: 'agent_loop_start',
    message: `Agent loop started (type=${agentType}, maxSteps=${maxSteps}): ${goal.slice(0, 120)}`,
    metadata: { goal, agentType, maxSteps, correlationId },
  });

  // Build dynamic system prompt with current portfolio state
  const [portfolio, positions] = await Promise.all([deps.getWalletBalances(), deps.getMyPositions()]);
  const stateSummary = deps.getStateSummary();
  const lessons = deps.getLessonsForPrompt({ agentType });
  const perfSummary = deps.getPerformanceSummary();
  const decisionSummary = deps.getDecisionSummary();
  let weightsSummary: string | null = null;
  if (agentType === 'SCREENER' && deps.getWeightsSummary) {
    try {
      if (config.darwin?.enabled) weightsSummary = deps.getWeightsSummary();
    } catch {
      /* signal-weights not critical */
    }
  }
  const systemPrompt = buildSystemPrompt(agentType, portfolio, positions, stateSummary, lessons, perfSummary, weightsSummary, decisionSummary);

  let providerMode: 'system' | 'user_embedded' = 'system';
  let messages = buildMessages(systemPrompt, sessionHistory, goal, providerMode);

  // Track write tools fired this session — prevent the model from calling the same
  // destructive tool twice (e.g. deploy twice, swap twice after auto-swap)
  const firedOnce = new Set<string>();
  const mustUseRealTool = shouldRequireRealToolUse(goal, agentType, interactive);
  let sawToolCall = false;
  let noToolRetryCount = 0;
  // Stays true for the whole run once a thinking-mode provider rejects tool_choice
  let omitToolChoice = false;

  const allTools = deps.getTools();

  // Initialize OpenAI client
  const client = new OpenAI({
    baseURL: process.env.LLM_BASE_URL || 'https://openrouter.ai/api/v1',
    apiKey: process.env.LLM_API_KEY,
    timeout: 5 * 60 * 1000,
  });

  const DEFAULT_MODEL = process.env.LLM_MODEL || 'openrouter/healer-alpha';
  const FALLBACK_MODEL = 'stepfun/step-3.5-flash:free';

  const emptyStreak = 0;
  for (let step = 0; step < maxSteps; step++) {
    log('agent', `Step ${step + 1}/${maxSteps}`);

    try {
      const activeModel = model || DEFAULT_MODEL;

      let response: any;
      let usedModel = activeModel;
      let toolChoice: 'required' | 'auto' = step === 0 && (ACTION_INTENTS.test(goal) || mustUseRealTool) ? 'required' : 'auto';

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const reqParams: Record<string, unknown> = {
            model: usedModel,
            messages,
            tools: getToolsForRole(agentType, allTools, goal),
            temperature: config.llm.temperature,
            max_tokens: maxOutputTokens ?? config.llm.maxTokens,
          };
          if (!omitToolChoice) reqParams.tool_choice = toolChoice;
          response = await client.chat.completions.create(reqParams as any);
        } catch (error) {
          if (providerMode === 'system' && isSystemRoleError(error)) {
            providerMode = 'user_embedded';
            messages = buildMessages(systemPrompt, sessionHistory, goal, providerMode);
            log('agent', 'Provider rejected system role — retrying with embedded system instructions');
            attempt -= 1;
            continue;
          }
          if (toolChoice === 'required' && isToolChoiceRequiredError(error)) {
            toolChoice = 'auto';
            log('agent', 'Provider rejected tool_choice=required — retrying with tool_choice=auto');
            attempt -= 1;
            continue;
          }
          if (!omitToolChoice && isThinkingModeToolChoiceError(error)) {
            omitToolChoice = true;
            log('agent', 'Provider thinking mode does not support tool_choice — retrying without it');
            attempt -= 1;
            continue;
          }
          throw error;
        }
        if (response.choices?.length) break;
        const errCode = response.error?.code;
        if (errCode === 502 || errCode === 503 || errCode === 529) {
          const wait = (attempt + 1) * 5000;
          if (attempt === 1 && usedModel !== FALLBACK_MODEL) {
            usedModel = FALLBACK_MODEL;
            log('agent', `Switching to fallback model ${FALLBACK_MODEL}`);
          } else {
            log('agent', `Provider error ${errCode}, retrying in ${wait / 1000}s (attempt ${attempt + 1}/3)`);
            await sleep(wait);
          }
        } else {
          break;
        }
      }

      if (!response.choices?.length) {
        log('error', `Bad API response: ${JSON.stringify(response).slice(0, 200)}`);
        throw new Error(`API returned no choices: ${response.error?.message || JSON.stringify(response)}`);
      }
      const msg = response.choices[0].message;
      log('llm', `Model ${usedModel} response: ${JSON.stringify(msg).slice(0, 4000)}`);
      const invalidToolArgErrors = new Map<string, string>();
      // Keep tool-call history API-valid, but never execute unrecoverable args.
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          if (tc.function?.arguments) {
            try {
              JSON.parse(tc.function.arguments);
            } catch {
              try {
                tc.function.arguments = JSON.stringify(JSON.parse(jsonrepair(tc.function.arguments)));
                log('warn', `Repaired malformed JSON args for ${tc.function.name}`);
              } catch {
                tc.function.arguments = '{}';
                const error = `Invalid tool arguments for ${tc.function.name}`;
                invalidToolArgErrors.set(tc.id, error);
                log('error', `${error}: could not repair JSON`);
              }
            }
          }
        }
      }
      messages.push(msg);

      // If the model didn't call any tools, it's done
      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        // Hermes sometimes returns null content — pop the empty message and retry once
        if (!msg.content) {
          messages.pop(); // remove the empty assistant message
          log('agent', 'Empty response, retrying...');
          continue;
        }
        if (mustUseRealTool && !sawToolCall) {
          noToolRetryCount += 1;
          messages.pop();
          log('agent', `Rejected no-tool final answer (${noToolRetryCount}/2) for tool-required request`);
          log('agent', `No-tool content was: ${msg.content?.slice(0, 1000)}`);
          logStructured({
            category: 'anti_hallucination_reject',
            message: `No-tool answer rejected (${noToolRetryCount}/2)`,
            metadata: { retryCount: noToolRetryCount, maxRetries: 2, goal, rejectedContentSnippet: (msg.content || '').slice(0, 200) },
          });
          if (noToolRetryCount >= 2) {
            return {
              content: "I couldn't complete that reliably because no tool call was made. Please retry after checking the logs.",
              userMessage: goal,
            };
          }
          messages.push({
            role: providerMode === 'system' ? 'system' : 'user',
            content:
              providerMode === 'system'
                ? 'You have not used any tool yet. This request requires real tool execution or live tool-backed data. Do not answer from memory or inference. Call the appropriate tool first, then report only the real result.'
                : '[SYSTEM REMINDER]\nYou have not used any tool yet. This request requires real tool execution or live tool-backed data. Do not answer from memory or inference. Call the appropriate tool first, then report only the real result.',
          });
          continue;
        }
        log('agent', 'Final answer reached');
        log('agent', msg.content);
        logStructured({
          category: 'agent_loop_end',
          message: 'Agent loop completed with final answer',
          metadata: { goal, agentType, stepsUsed: step + 1, correlationId },
        });
        setCorrelationId(null);
        return { content: msg.content, userMessage: goal };
      }
      sawToolCall = true;

      // Pre-filter duplicate deploy_position calls within the same assistant message
      // to avoid race conditions in parallel execution.
      const deploySeenInMessage = new Set<string>();
      const blockedInMessage: Array<{ toolCall: any; functionName: string; functionArgs: Record<string, unknown> }> = [];

      for (const tc of msg.tool_calls) {
        const fn = tc.function.name.replace(/<.*$/, '').trim();
        if (fn === 'deploy_position') {
          if (deploySeenInMessage.has(fn)) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(tc.function.arguments);
            } catch {
              /* best-effort */
            }
            blockedInMessage.push({ toolCall: tc, functionName: fn, functionArgs: args });
          } else {
            deploySeenInMessage.add(fn);
          }
        }
      }

      const blockedIds = new Set(blockedInMessage.map((b) => b.toolCall.id));
      const toolCallsToExecute = msg.tool_calls.filter((tc: any) => !blockedIds.has(tc.id));

      // Execute each tool call in parallel
      const toolResults = await Promise.all(
        toolCallsToExecute.map(async (toolCall: any) => {
          const functionName = toolCall.function.name.replace(/<.*$/, '').trim();
          let functionArgs: Record<string, unknown>;

          if (invalidToolArgErrors.has(toolCall.id)) {
            const result: Record<string, unknown> = {
              success: false,
              error: invalidToolArgErrors.get(toolCall.id),
              blocked: true,
            };
            await onToolFinish?.({ name: functionName, args: {}, result, success: false, step });
            return {
              role: 'tool' as const,
              tool_call_id: toolCall.id,
              content: JSON.stringify(result),
            };
          }

          try {
            functionArgs = JSON.parse(toolCall.function.arguments);
          } catch {
            try {
              functionArgs = JSON.parse(jsonrepair(toolCall.function.arguments));
              log('warn', `Repaired malformed JSON args for ${functionName}`);
            } catch (parseError: any) {
              log('error', `Failed to parse args for ${functionName}: ${parseError.message}`);
              const result: Record<string, unknown> = {
                success: false,
                error: `Invalid tool arguments for ${functionName}`,
                blocked: true,
              };
              await onToolFinish?.({ name: functionName, args: {}, result, success: false, step });
              return {
                role: 'tool' as const,
                tool_call_id: toolCall.id,
                content: JSON.stringify(result),
              };
            }
          }

          // Block once-per-session tools from firing a second time
          if (ONCE_PER_SESSION.has(functionName) && firedOnce.has(functionName)) {
            log('agent', `Blocked duplicate ${functionName} call — already executed this session`);
            logStructured({
              category: 'tool_blocked',
              message: `Duplicate ${functionName} blocked (once-per-session)`,
              metadata: { tool: functionName, step, reason: 'once_per_session' },
            });
            const blockedResult = {
              blocked: true,
              reason: `${functionName} already attempted this session — do not retry. If it failed, report the error and stop.`,
            };
            await onToolFinish?.({
              name: functionName,
              args: functionArgs,
              result: blockedResult,
              success: false,
              step,
            });
            return {
              role: 'tool' as const,
              tool_call_id: toolCall.id,
              content: JSON.stringify(blockedResult),
            };
          }

          let result: Record<string, unknown>;
          let toolSuccess: boolean;
          const toolTimer = createTimer();

          try {
            await onToolStart?.({ name: functionName, args: functionArgs, step });
          } catch (startErr: any) {
            log('warn', `onToolStart hook failed for ${functionName}: ${startErr?.message || startErr}`);
          }

          try {
            logStructured({
              category: 'tool_start',
              message: `Tool executing: ${functionName}`,
              metadata: { tool: functionName, step, args: summarizeToolArgs(functionArgs) },
            });
            result = await deps.executeTool(functionName, functionArgs);
            toolSuccess = result?.success !== false && !result?.error && !result?.blocked;
          } catch (execErr: any) {
            const errorMessage = execErr instanceof Error ? execErr.message : String(execErr);
            log('error', `Tool execution threw unhandled exception for ${functionName}: ${errorMessage}`);
            result = {
              success: false,
              error: `Unhandled tool error in ${functionName}: ${errorMessage}`,
            };
            toolSuccess = false;
          }

          const toolDurationMs = toolTimer.stop();
          logStructured({
            category: toolSuccess ? 'tool_finish' : 'tool_blocked',
            message: `Tool ${toolSuccess ? 'completed' : 'finished'}: ${functionName} (${toolDurationMs}ms)`,
            metadata: { tool: functionName, step, duration_ms: toolDurationMs, success: toolSuccess, result_summary: summarizeToolResult(result) },
          });

          try {
            await onToolFinish?.({
              name: functionName,
              args: functionArgs,
              result,
              success: toolSuccess,
              step,
            });
          } catch (finishErr: any) {
            log('warn', `onToolFinish hook failed for ${functionName}: ${finishErr?.message || finishErr}`);
          }

          // Lock deploy_position after first attempt regardless of outcome — retrying is never right
          // For close/swap: only lock on success so genuine failures can be retried
          if (NO_RETRY_TOOLS.has(functionName)) firedOnce.add(functionName);
          else if (ONCE_PER_SESSION.has(functionName) && result?.success === true) firedOnce.add(functionName);

          return {
            role: 'tool' as const,
            tool_call_id: toolCall.id,
            content: JSON.stringify(result),
          };
        }),
      );

      // Build results in original tool_call order, inserting blocked duplicates
      const resultsById = new Map<string, any>();
      for (const r of toolResults) resultsById.set(r.tool_call_id, r);

      const orderedResults = msg.tool_calls.map((tc: any) => {
        if (blockedIds.has(tc.id)) {
          const block = blockedInMessage.find((b) => b.toolCall.id === tc.id)!;
          log('agent', `Blocked duplicate ${block.functionName} call in same message — already executed this turn`);
          logStructured({
            category: 'tool_blocked',
            message: `Duplicate ${block.functionName} blocked (same message)`,
            metadata: { tool: block.functionName, step, reason: 'duplicate_in_message' },
          });
          const blockedResult = {
            blocked: true,
            reason: 'Only one deploy_position per message is allowed. If you need to deploy to multiple pools, send separate messages.',
          };
          onToolFinish?.({
            name: block.functionName,
            args: block.functionArgs,
            result: blockedResult,
            success: false,
            step,
          });
          return {
            role: 'tool' as const,
            tool_call_id: tc.id,
            content: JSON.stringify(blockedResult),
          };
        }
        return resultsById.get(tc.id)!;
      });

      messages.push(...orderedResults);
    } catch (error: any) {
      log('error', `Agent loop error at step ${step}: ${error.message}`);
      logStructured({
        category: 'agent_loop_error',
        message: `Agent loop error at step ${step}: ${error.message}`,
        metadata: { step, error: error.message, stack: error.stack?.slice(0, 500), goal, agentType },
      });

      // If it's a rate limit, wait and retry
      if (error.status === 429) {
        log('agent', 'Rate limited, waiting 30s...');
        await sleep(30000);
        continue;
      }

      // For other errors, break the loop
      throw error;
    }
  }

  log('agent', 'Max steps reached without final answer');
  logStructured({
    category: 'agent_loop_end',
    message: 'Max steps reached without final answer',
    metadata: { goal, agentType, maxSteps, correlationId },
  });
  setCorrelationId(null);
  return { content: 'Max steps reached. Review logs for partial progress.', userMessage: goal };
}
