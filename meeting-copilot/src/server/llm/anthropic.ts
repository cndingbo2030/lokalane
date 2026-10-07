import Anthropic from '@anthropic-ai/sdk'
import type { LlmClient, LlmTextRequest } from './types.ts'
import { LlmRefusalError } from './types.ts'

/**
 * Claude via the official SDK. Every call streams so the UI can render tokens
 * as they arrive, and opts into server-side refusal fallbacks (`fallbacks:
 * "default"`) so a classifier false positive never blanks a live suggestion.
 */
export class AnthropicLlm implements LlmClient {
  readonly name = 'anthropic'
  private readonly client: Anthropic

  constructor(client = new Anthropic()) {
    this.client = client
  }

  async *streamText(request: LlmTextRequest): AsyncIterable<string> {
    const system: Anthropic.Beta.BetaTextBlockParam[] = [{ type: 'text', text: request.system }]
    if (request.cachedContext) {
      system.push({ type: 'text', text: request.cachedContext, cache_control: { type: 'ephemeral' } })
    }

    const stream = this.client.beta.messages.stream(
      {
        model: request.model,
        max_tokens: request.maxTokens,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: request.effort },
        system,
        messages: [{ role: 'user', content: request.prompt }],
      },
      { signal: request.signal },
    )

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text
      }
    }

    const message = await stream.finalMessage()
    if (message.stop_reason === 'refusal') {
      throw new LlmRefusalError(message.stop_details?.category ?? null)
    }
  }
}
