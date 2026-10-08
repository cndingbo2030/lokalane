import Anthropic from '@anthropic-ai/sdk'
import type { DocumentRef } from '../../shared/protocol.ts'
import { LOCAL_DOCUMENT_PREFIX } from '../documents.ts'
import type { LlmClient, LlmJsonRequest, LlmTextRequest, LlmUsage } from './types.ts'
import { LlmOutputError, LlmRefusalError } from './types.ts'

/**
 * Claude via the official SDK. Text calls stream so the UI can render tokens as
 * they arrive; JSON calls use structured outputs. Every call opts into
 * server-side refusal fallbacks (`fallbacks: "default"`) so a classifier false
 * positive never blanks a live suggestion.
 *
 * Prompt layout (most stable first, for prompt caching):
 *   system:   role instructions | meeting brief  ← cache breakpoint
 *   messages: documents…                        ← cache breakpoint
 *             shared prefix (e.g. transcript)   ← cache breakpoint
 *             volatile prompt (task)
 */
export class AnthropicLlm implements LlmClient {
  readonly name = 'anthropic'
  private readonly client: Anthropic

  constructor(client = new Anthropic()) {
    this.client = client
  }

  async *streamText(request: LlmTextRequest): AsyncIterable<string> {
    const stream = this.client.beta.messages.stream(this.params(request), { signal: request.signal })

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text
      }
    }

    const message = await stream.finalMessage()
    request.onUsage?.(usage(message.usage))
    if (message.stop_reason === 'refusal') {
      throw new LlmRefusalError(message.stop_details?.category ?? null)
    }
  }

  async prewarm(request: LlmTextRequest): Promise<void> {
    // Prefill only: writes the cache at the breakpoints, returns at once, bills no output tokens.
    // Same params as the real call (effort and thinking are part of the cached prefix), but not streamed.
    const message = await this.client.beta.messages.create(this.params({ ...request, maxTokens: 0 }), { signal: request.signal })
    request.onUsage?.(usage(message.usage))
  }

  async completeJson<T>(request: LlmJsonRequest): Promise<T> {
    const message = await this.client.beta.messages.create(
      {
        ...this.params(request),
        output_config: { effort: request.effort, format: { type: 'json_schema', schema: request.schema } },
      },
      { signal: request.signal },
    )
    request.onUsage?.(usage(message.usage))
    if (message.stop_reason === 'refusal') throw new LlmRefusalError(message.stop_details?.category ?? null)
    if (message.stop_reason === 'max_tokens') throw new LlmOutputError(`${request.task}: response was cut off (max_tokens)`)
    const text = message.content.find((block) => block.type === 'text')
    if (!text || text.type !== 'text') throw new LlmOutputError(`${request.task}: no JSON in the response`)
    try {
      return JSON.parse(text.text) as T
    } catch {
      throw new LlmOutputError(`${request.task}: response was not valid JSON`)
    }
  }

  private params(request: LlmTextRequest) {
    const cache: Anthropic.Beta.BetaCacheControlEphemeral = request.cacheTtl === '1h' ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' }
    // The breakpoint goes on the last system block: the brief when there is one, else the instructions.
    const system: Anthropic.Beta.BetaTextBlockParam[] = request.cachedContext
      ? [
          { type: 'text', text: request.system },
          { type: 'text', text: request.cachedContext, cache_control: cache },
        ]
      : [{ type: 'text', text: request.system, cache_control: cache }]

    const content: Anthropic.Beta.BetaContentBlockParam[] = documentBlocks(request.documents ?? [], cache)
    if (request.cachedPrompt) content.push({ type: 'text', text: request.cachedPrompt, cache_control: { type: 'ephemeral' } })
    content.push({ type: 'text', text: request.prompt })

    return {
      model: request.model,
      max_tokens: request.maxTokens,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default' as const,
      output_config: { effort: request.effort },
      system,
      messages: [{ role: 'user' as const, content }],
    }
  }
}

function usage(u: Anthropic.Beta.BetaUsage): LlmUsage {
  return {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    cacheWrite1hTokens: u.cache_creation?.ephemeral_1h_input_tokens ?? 0,
  }
}

/**
 * Documents uploaded while the server had no Claude key live only in the offline
 * store; sending their ids would make every request of the meeting fail with a 400.
 */
function documentBlocks(documents: DocumentRef[], cache: Anthropic.Beta.BetaCacheControlEphemeral): Anthropic.Beta.BetaRequestDocumentBlock[] {
  const files = documents.filter((doc) => !doc.id.startsWith(LOCAL_DOCUMENT_PREFIX))
  return files.map((doc, index) => ({
    type: 'document',
    source: { type: 'file', file_id: doc.id },
    title: doc.name,
    ...(index === files.length - 1 ? { cache_control: cache } : {}),
  }))
}
