import { describe, it, expect, vi, beforeEach } from 'vitest';
import { agentLoop } from '../application/agent-loop.js';

const mockOpenAICreate = vi.fn();

vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: mockOpenAICreate,
        },
      };
    },
  };
});

function makeToolCall(id: string, name: string, args: Record<string, unknown> = {}) {
  return {
    id,
    type: 'function',
    function: {
      name,
      arguments: JSON.stringify(args),
    },
  };
}

describe('agent-loop — deploy_position duplicate guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks duplicate deploy_position calls in the same assistant message', async () => {
    const executeTool = vi.fn().mockResolvedValue({ success: true, position: 'pos_123' });
    const getTools = vi.fn().mockReturnValue([]);
    const getWalletBalances = vi.fn().mockResolvedValue({ sol: 10, tokens: [] });
    const getMyPositions = vi.fn().mockResolvedValue({ total_positions: 0, positions: [] });
    const getStateSummary = vi.fn().mockReturnValue(null);
    const getLessonsForPrompt = vi.fn().mockReturnValue(null);
    const getPerformanceSummary = vi.fn().mockReturnValue(null);
    const getDecisionSummary = vi.fn().mockReturnValue(null);

    // First LLM response: two deploy_position tool calls in one message
    mockOpenAICreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              makeToolCall('call_1', 'deploy_position', { pool_address: 'PoolA', amount_y: 0.1 }),
              makeToolCall('call_2', 'deploy_position', { pool_address: 'PoolB', amount_y: 0.1 }),
            ],
          },
        },
      ],
    });

    // Second LLM response: final text answer (so the loop terminates)
    mockOpenAICreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Done deploying.',
            tool_calls: null,
          },
        },
      ],
    });

    const result = await agentLoop('deploy to two pools', 3, [], 'SCREENER', null, null, {
      interactive: false,
      deps: {
        executeTool,
        getTools,
        getWalletBalances,
        getMyPositions,
        getStateSummary,
        getLessonsForPrompt,
        getPerformanceSummary,
        getDecisionSummary,
      },
    });

    expect(result.content).toBe('Done deploying.');
    // Only the first deploy_position should execute; the second should be blocked
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executeTool).toHaveBeenCalledWith('deploy_position', expect.objectContaining({ pool_address: 'PoolA' }));
  });
});

describe('agent-loop — resilient concurrent tool execution (Issue #133)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserves concurrent tool results and signatures when one tool throws an unhandled exception', async () => {
    const executeTool = vi.fn().mockImplementation(async (name: string) => {
      if (name === 'claim_fees') {
        return { success: true, tx_signature: '5xTestTxSig123', claimed_sol: 0.5 };
      }
      if (name === 'check_pool') {
        throw new Error('RPC endpoint rate-limited/unreachable');
      }
      return { success: true };
    });

    const getTools = vi.fn().mockReturnValue([]);
    const getWalletBalances = vi.fn().mockResolvedValue({ sol: 10, tokens: [] });
    const getMyPositions = vi.fn().mockResolvedValue({ total_positions: 1, positions: [] });
    const getStateSummary = vi.fn().mockReturnValue(null);
    const getLessonsForPrompt = vi.fn().mockReturnValue(null);
    const getPerformanceSummary = vi.fn().mockReturnValue(null);
    const getDecisionSummary = vi.fn().mockReturnValue(null);

    // Turn 1: Assistant requests two tools concurrently
    mockOpenAICreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              makeToolCall('call_claim', 'claim_fees', { position_address: 'pos_1' }),
              makeToolCall('call_check', 'check_pool', { pool_address: 'pool_error' }),
            ],
          },
        },
      ],
    });

    // Turn 2: Assistant receives tool responses (both claim and check) and replies
    let turn2Messages: any[] = [];
    mockOpenAICreate.mockImplementationOnce(async (payload: any) => {
      turn2Messages = payload.messages;
      return {
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Processed fee claim despite check_pool failure.',
              tool_calls: null,
            },
          },
        ],
      };
    });

    const onToolFinish = vi.fn();

    const result = await agentLoop('manage position', 3, [], 'MANAGER', null, null, {
      interactive: false,
      onToolFinish,
      deps: {
        executeTool,
        getTools,
        getWalletBalances,
        getMyPositions,
        getStateSummary,
        getLessonsForPrompt,
        getPerformanceSummary,
        getDecisionSummary,
      },
    });

    expect(result.content).toBe('Processed fee claim despite check_pool failure.');

    // Verify both tools were recorded in messages sent to the LLM in Turn 2
    const toolMessages = turn2Messages.filter((m: any) => m.role === 'tool');
    expect(toolMessages).toHaveLength(2);

    const claimResponse = toolMessages.find((m: any) => m.tool_call_id === 'call_claim');
    expect(claimResponse).toBeDefined();
    expect(JSON.parse(claimResponse.content)).toEqual(expect.objectContaining({ success: true, tx_signature: '5xTestTxSig123' }));

    const errorResponse = toolMessages.find((m: any) => m.tool_call_id === 'call_check');
    expect(errorResponse).toBeDefined();
    expect(JSON.parse(errorResponse.content)).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining('RPC endpoint rate-limited/unreachable'),
      }),
    );

    // Verify onToolFinish was called for both
    expect(onToolFinish).toHaveBeenCalledWith(expect.objectContaining({ name: 'claim_fees', success: true }));
    expect(onToolFinish).toHaveBeenCalledWith(expect.objectContaining({ name: 'check_pool', success: false }));
  });
});

describe('agent-loop — SCREENER tool enforcement & deploy_position lockout (Issue #127)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows SCREENER role to return ⛔ NO DEPLOY without tool calls on first step', async () => {
    const executeTool = vi.fn();
    const getTools = vi.fn().mockReturnValue([]);
    const getWalletBalances = vi.fn().mockResolvedValue({ sol: 10, tokens: [] });
    const getMyPositions = vi.fn().mockResolvedValue({ total_positions: 0, positions: [] });
    const getStateSummary = vi.fn().mockReturnValue(null);
    const getLessonsForPrompt = vi.fn().mockReturnValue(null);
    const getPerformanceSummary = vi.fn().mockReturnValue(null);
    const getDecisionSummary = vi.fn().mockReturnValue(null);

    // LLM response: ⛔ NO DEPLOY text on first turn without any tool calls
    mockOpenAICreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: 'assistant',
            content: '⛔ NO DEPLOY\n\nCycle finished with no valid entry.\n\nWHY SKIPPED\nAll candidate pools had low organic volume.',
            tool_calls: null,
          },
        },
      ],
    });

    const screeningGoal = `
SCREENING CYCLE
Positions: 0/2 | SOL: 10.000 | Deploy: 1.0 SOL
PRE-LOADED CANDIDATES (2 pools):
POOL: TEST/SOL (Pool1)
  metrics: bin_step=20, fee_pct=0.25%, windowed_fee/TVL(5m)=0.01

STEPS:
1. Decide if any candidate is actually worth deploying.
2. Call deploy_position if valid.
3. If no pool qualifies, report in this exact format:
   ⛔ NO DEPLOY
`;

    const result = await agentLoop(screeningGoal, 3, [], 'SCREENER', null, null, {
      interactive: false,
      deps: {
        executeTool,
        getTools,
        getWalletBalances,
        getMyPositions,
        getStateSummary,
        getLessonsForPrompt,
        getPerformanceSummary,
        getDecisionSummary,
      },
    });

    expect(result.content).toContain('⛔ NO DEPLOY');
    expect(result.content).not.toContain("couldn't complete that reliably because no tool call was made");
    expect(mockOpenAICreate).toHaveBeenCalledTimes(1);
    expect(executeTool).not.toHaveBeenCalled();
  });

  it('allows deploy_position fallback to a second candidate if the first candidate is blocked by pre-flight safety check', async () => {
    const executeTool = vi.fn().mockImplementation(async (name: string, args: any) => {
      if (name === 'deploy_position' && args.pool_address === 'UnsafePool') {
        return {
          blocked: true,
          reason: 'fee/active-TVL ratio 0.001 is below threshold 0.02',
        };
      }
      if (name === 'deploy_position' && args.pool_address === 'SafeBackupPool') {
        return {
          success: true,
          position: 'pos_safe_456',
          pool_name: 'SafeBackupPool',
        };
      }
      return { success: true };
    });

    const getTools = vi.fn().mockReturnValue([]);
    const getWalletBalances = vi.fn().mockResolvedValue({ sol: 10, tokens: [] });
    const getMyPositions = vi.fn().mockResolvedValue({ total_positions: 0, positions: [] });
    const getStateSummary = vi.fn().mockReturnValue(null);
    const getLessonsForPrompt = vi.fn().mockReturnValue(null);
    const getPerformanceSummary = vi.fn().mockReturnValue(null);
    const getDecisionSummary = vi.fn().mockReturnValue(null);

    // Turn 1: LLM tries deploying into UnsafePool
    mockOpenAICreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [makeToolCall('call_unsafe', 'deploy_position', { pool_address: 'UnsafePool', amount_y: 0.5 })],
          },
        },
      ],
    });

    // Turn 2: LLM sees safety block, tries fallback SafeBackupPool
    mockOpenAICreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [makeToolCall('call_safe', 'deploy_position', { pool_address: 'SafeBackupPool', amount_y: 0.5 })],
          },
        },
      ],
    });

    // Turn 3: LLM outputs final report
    mockOpenAICreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: 'assistant',
            content: '🚀 DEPLOYED\n\nSafeBackupPool\n\n◎ 0.5 SOL',
            tool_calls: null,
          },
        },
      ],
    });

    const result = await agentLoop('SCREENING CYCLE: Deploy: 0.5 SOL', 5, [], 'SCREENER', null, null, {
      interactive: false,
      deps: {
        executeTool,
        getTools,
        getWalletBalances,
        getMyPositions,
        getStateSummary,
        getLessonsForPrompt,
        getPerformanceSummary,
        getDecisionSummary,
      },
    });

    expect(result.content).toContain('🚀 DEPLOYED');
    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(executeTool).toHaveBeenNthCalledWith(1, 'deploy_position', expect.objectContaining({ pool_address: 'UnsafePool' }));
    expect(executeTool).toHaveBeenNthCalledWith(2, 'deploy_position', expect.objectContaining({ pool_address: 'SafeBackupPool' }));
  });

  it('locks deploy_position for subsequent steps if deploy_position was actually executed', async () => {
    const executeTool = vi.fn().mockResolvedValue({
      success: true,
      position: 'pos_123',
    });

    const getTools = vi.fn().mockReturnValue([]);
    const getWalletBalances = vi.fn().mockResolvedValue({ sol: 10, tokens: [] });
    const getMyPositions = vi.fn().mockResolvedValue({ total_positions: 0, positions: [] });
    const getStateSummary = vi.fn().mockReturnValue(null);
    const getLessonsForPrompt = vi.fn().mockReturnValue(null);
    const getPerformanceSummary = vi.fn().mockReturnValue(null);
    const getDecisionSummary = vi.fn().mockReturnValue(null);

    // Turn 1: LLM executes deploy_position
    mockOpenAICreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [makeToolCall('call_1', 'deploy_position', { pool_address: 'PoolA', amount_y: 0.5 })],
          },
        },
      ],
    });

    // Turn 2: LLM erroneously attempts a second deploy_position in turn 2
    let turn2ToolResponse: any = null;
    mockOpenAICreate.mockImplementationOnce(async (payload: any) => {
      turn2ToolResponse = payload.messages;
      return {
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [makeToolCall('call_2', 'deploy_position', { pool_address: 'PoolB', amount_y: 0.5 })],
            },
          },
        ],
      };
    });

    // Turn 3: LLM acknowledges block and concludes
    let turn3Messages: any[] = [];
    mockOpenAICreate.mockImplementationOnce(async (payload: any) => {
      turn3Messages = payload.messages;
      return {
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Deployment finished.',
              tool_calls: null,
            },
          },
        ],
      };
    });

    const result = await agentLoop('SCREENING CYCLE: Deploy: 0.5 SOL', 5, [], 'SCREENER', null, null, {
      interactive: false,
      deps: {
        executeTool,
        getTools,
        getWalletBalances,
        getMyPositions,
        getStateSummary,
        getLessonsForPrompt,
        getPerformanceSummary,
        getDecisionSummary,
      },
    });

    expect(result.content).toBe('Deployment finished.');
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executeTool).toHaveBeenCalledWith('deploy_position', expect.objectContaining({ pool_address: 'PoolA' }));

    // Verify turn 3 received the once-per-session block message for the second deploy_position attempt
    const turn3ToolMessages = turn3Messages.filter((m: any) => m.role === 'tool');
    const secondDeployToolMessage = turn3ToolMessages.find((m: any) => m.tool_call_id === 'call_2');
    expect(secondDeployToolMessage).toBeDefined();
    expect(JSON.parse(secondDeployToolMessage.content)).toEqual(
      expect.objectContaining({
        blocked: true,
        reason: expect.stringContaining('already attempted this session'),
      }),
    );
  });
});
