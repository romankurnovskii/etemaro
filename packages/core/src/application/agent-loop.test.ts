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
