import Anthropic from '@anthropic-ai/sdk'
import type { DocumentRef } from '../../shared/protocol.ts'
import type { LlmClient, LlmTextRequest } from './types.ts'
import { LlmRefusalError } from './types.ts'

/**
 * Claude via the official SDK. Every call streams so the UI can render tokens
 * as they arrive, and opts into server-side refusal fallbacks (`fallbacks:
 * "default"`) so a classifier false positive never blanks a live suggestion.
 *
 * Prompt layout (most stable first, for prompt caching):
 *   system:   role instructions | meeting brief  ← cache breakpoint
 *   messages: documents…                        ← cache breakpoint
 *             volatile prompt (recent transcript + task)
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

    const content: Anthropic.Beta.BetaContentBlockParam[] = documentBlocks(request.documents ?? [])
    content.push({ type: 'text', text: request.prompt })

    const stream = this.client.beta.messages.stream(
      {
        model: request.model,
        max_tokens: request.maxTokens,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: request.effort },
        system,
        messages: [{ role: 'user', content }],
      },
      { signal: request.signal },
    )

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text
      }
    }

    const message = await stream.finalMessage()
    request.onUsage?.({
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    })
    if (message.stop_reason === 'refusal') {
      throw new LlmRefusalError(message.stop_details?.category ?? null)
    }
  }
}

function documentBlocks(documents: DocumentRef[]): Anthropic.Beta.BetaRequestDocumentBlock[] {
  return documents.map((doc, index) => ({
    type: 'document',
    source: { type: 'file', file_id: doc.id },
    title: doc.name,
    ...(index === documents.length - 1 ? { cache_control: { type: 'ephemeral' as const } } : {}),
  }))
}
