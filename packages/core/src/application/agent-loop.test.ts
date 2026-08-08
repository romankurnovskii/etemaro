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
