/**
 * @file OpenAiChatAdapter.ts
 * @description Default LlmPort implementation backed by the OpenAI-compatible SDK.
 * Owns client construction so the agent loop no longer imports a vendor SDK.
 */
import OpenAI from 'openai'
import type { ConfigPort } from '../../ports/config.js'
import type { LlmChatRequest, LlmChatResponse, LlmPort } from '../../ports/llm.js'

export class OpenAiChatAdapter implements LlmPort {
  readonly name = 'openai'
  private readonly client: OpenAI

  constructor(cfg: Pick<ConfigPort, 'llm'>) {
    this.client = new OpenAI({
      baseURL: cfg.llm.baseUrl,
      apiKey: cfg.llm.apiKey,
      timeout: 5 * 60 * 1000,
    })
  }

  async chat(request: LlmChatRequest): Promise<LlmChatResponse> {
    const params: Record<string, unknown> = {
      model: request.model,
      messages: request.messages,
      tools: request.tools,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
    }
    if (request.toolChoice) params.tool_choice = request.toolChoice
    const response = await this.client.chat.completions.create(params as any)
    return response as unknown as LlmChatResponse
  }
}
