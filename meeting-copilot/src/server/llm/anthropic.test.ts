import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import { AnthropicLlm } from './anthropic.ts'
import { collectText, LlmRefusalError, type LlmUsage } from './types.ts'

function fakeClient(stopReason = 'end_turn') {
  const calls: unknown[] = []
  const client = {
    beta: {
      messages: {
        stream(params: unknown) {
          calls.push(params)
          return {
            async *[Symbol.asyncIterator]() {
              yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } }
            },
            finalMessage: async () => ({
              stop_reason: stopReason,
              stop_details: stopReason === 'refusal' ? { category: 'cyber' } : null,
              usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 500, cache_creation_input_tokens: null },
            }),
          }
        },
      },
    },
  }
  return { client: client as unknown as Anthropic, calls }
}

describe('AnthropicLlm', () => {
  it('lays out the request for caching: system + brief, then documents, then the prompt', async () => {
    const { client, calls } = fakeClient()
    let usage: LlmUsage | undefined
    const text = await collectText(
      new AnthropicLlm(client).streamText({
        model: 'claude-opus-5-5',
        system: 'rules',
        cachedContext: 'brief',
        documents: [
          { id: 'file_1', name: 'a.pdf', kind: 'pdf', sizeBytes: 1 },
          { id: 'file_2', name: 'b.txt', kind: 'text', sizeBytes: 1 },
        ],
        prompt: 'question',
        maxTokens: 100,
        effort: 'low',
        onUsage: (u) => (usage = u),
      }),
    )
    expect(text).toBe('Hi')
    expect(usage).toEqual({ inputTokens: 10, outputTokens: 2, cacheReadTokens: 500, cacheWriteTokens: 0 })
    const params = calls[0] as Record<string, unknown> & { system: unknown[]; messages: Array<{ content: Array<Record<string, unknown>> }> }
    expect(params).toMatchObject({ fallbacks: 'default', betas: ['server-side-fallback-2026-07-01'], output_config: { effort: 'low' } })
    expect(params.system).toEqual([
      { type: 'text', text: 'rules' },
      { type: 'text', text: 'brief', cache_control: { type: 'ephemeral' } },
    ])
    const content = params.messages[0].content
    expect(content.map((b) => b.type)).toEqual(['document', 'document', 'text'])
    expect(content[0]).not.toHaveProperty('cache_control')
    expect(content[1]).toMatchObject({ source: { type: 'file', file_id: 'file_2' }, title: 'b.txt', cache_control: { type: 'ephemeral' } })
  })

  it('throws a typed error on refusal', async () => {
    const { client } = fakeClient('refusal')
    await expect(
      collectText(new AnthropicLlm(client).streamText({ model: 'm', system: 's', prompt: 'p', maxTokens: 1, effort: 'low' })),
    ).rejects.toBeInstanceOf(LlmRefusalError)
  })
})
