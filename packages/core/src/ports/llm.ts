/**
 * @file llm.ts
 * @description LLM port. Chat-completion seam so the agent loop depends on an
 * interface instead of a concrete vendor SDK.
 */

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
