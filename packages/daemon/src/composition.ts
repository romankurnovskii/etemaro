/**
 * @file composition.ts
 * @description Composition root for the daemon. Binds the concrete core adapter namespaces
 * and agent-loop dependencies (ports) into the DaemonAdapters container, so Daemon.ts stays
 * free of concrete wiring and adapters/providers can be swapped in one place.
 */
import {
  type AgentLoopDeps,
  briefing,
  desktop,
  domain,
  hivemind,
  meteora,
  OpenAiChatAdapter,
  screening,
  telegram,
  token,
  toolExecutor,
  tools,
  wallet,
} from '@etemaro/core'
import type { DaemonAdapters } from './Daemon.js'

/** Agent-loop ports (tool execution, portfolio/position/lesson providers). */
export function createAgentLoopDeps(): AgentLoopDeps {
  return {
    executeTool: toolExecutor.executeTool,
    createLlm: (cfg) => new OpenAiChatAdapter(cfg),
    getTools: () => tools,
    getWalletBalances: async () => {
      const bal = await wallet.getWalletBalances()
      return {
        sol: bal.sol,
        usd: bal.sol_usd,
        tokens: bal.tokens.map((t: any) => ({
          mint: t.mint,
          symbol: t.symbol,
          amount: t.amount,
          usd: t.usd,
        })),
      }
    },
    getMyPositions: meteora.getMyPositions,
    getStateSummary: domain.getStateSummary,
    getLessonsForPrompt: (opts: any) => domain.getLessonsForPrompt(opts),
    getPerformanceSummary: () => {
      const summary = domain.getPerformanceSummary()
      return summary ? JSON.stringify(summary) : null
    },
    getDecisionSummary: domain.getDecisionSummary,
    getWeightsSummary: domain.getWeightsSummary,
  }
}

/** The full adapter container the Daemon is constructed with. */
export function createDaemonAdapters(): DaemonAdapters {
  return {
    meteora,
    wallet,
    screening,
    toolExecutor,
    telegram,
    desktop,
    briefing,
    hivemind,
    domain: {
      ...domain,
      addPoolNote: (pool: string, note: string) => domain.addPoolNote({ pool_address: pool, note }),
      getTokenNarrative: token.getTokenNarrative,
      getTokenInfo: token.getTokenInfo,
    },
    agentLoopDeps: createAgentLoopDeps(),
  }
}
