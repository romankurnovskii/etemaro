/**
 * @file llm.ts
 * @description LLM port. Chat-completion seam so the agent loop depends on an
 * interface instead of a concrete vendor SDK.
 */
import type { ConfigPort } from './config.js'

export interface LlmChatRequest {
  model: string
  messages: unknown[]
  tools?: unknown[]
  toolChoice?: 'required' | 'auto'
  temperature?: number
  maxTokens?: number
}

export interface LlmChatResponse {
  choices: Array<{
    message: {
      role?: string
      content?: string | null
      tool_calls?: unknown[] | null
    }
  }>
}

export interface LlmPort {
  readonly name: string
  chat(request: LlmChatRequest): Promise<LlmChatResponse>
}

/** Factory for the default LLM provider, supplied by the composition root. */
export type LlmFactory = (cfg: ConfigPort) => LlmPort
