import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import { AnthropicLlm } from './anthropic.ts'
import { collectText, LlmOutputError, LlmRefusalError, type LlmUsage } from './types.ts'

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
    expect(usage).toEqual({ inputTokens: 10, outputTokens: 2, cacheReadTokens: 500, cacheWriteTokens: 0, cacheWrite1hTokens: 0 })
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

  it('leaves out documents uploaded without a Claude key, which the API would reject', async () => {
    const { client, calls } = fakeClient()
    await collectText(
      new AnthropicLlm(client).streamText({
        model: 'm',
        system: 'rules',
        documents: [
          { id: 'file_1', name: 'a.pdf', kind: 'pdf', sizeBytes: 1 },
          { id: 'local_5f0c2d1e', name: 'old.pdf', kind: 'pdf', sizeBytes: 1 },
        ],
        prompt: 'q',
        maxTokens: 10,
        effort: 'low',
      }),
    )
    const content = (calls[0] as { messages: Array<{ content: Array<Record<string, unknown>> }> }).messages[0].content
    expect(content.map((b) => b.type)).toEqual(['document', 'text'])
    // The cache breakpoint moves to the last document actually sent.
    expect(content[0]).toMatchObject({ source: { type: 'file', file_id: 'file_1' }, cache_control: { type: 'ephemeral' } })
  })

  it('applies a 1-hour TTL to the stable prefix and caches the instructions when there is no brief', async () => {
    const { client, calls } = fakeClient()
    const llm = new AnthropicLlm(client)
    const docs = [{ id: 'file_1', name: 'a.pdf', kind: 'pdf' as const, sizeBytes: 1 }]
    await collectText(llm.streamText({ model: 'm', system: 'rules', documents: docs, cacheTtl: '1h', prompt: 'q', maxTokens: 10, effort: 'low' }))
    const params = calls[0] as { system: unknown[]; messages: Array<{ content: Array<Record<string, unknown>> }> }
    expect(params.system).toEqual([{ type: 'text', text: 'rules', cache_control: { type: 'ephemeral', ttl: '1h' } }])
    expect(params.messages[0].content[0]).toMatchObject({ cache_control: { type: 'ephemeral', ttl: '1h' } })
    expect(params.messages[0].content[1]).toEqual({ type: 'text', text: 'q' })
  })

  it('pre-warms with max_tokens 0 and exactly the prefix of the real request', async () => {
    const created: Array<Record<string, unknown>> = []
    const streamed: Array<Record<string, unknown>> = []
    const client = {
      beta: {
        messages: {
          create: async (params: Record<string, unknown>) => {
            created.push(params)
            return { content: [], stop_reason: 'max_tokens', usage: { input_tokens: 3, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 2_000, cache_creation: { ephemeral_1h_input_tokens: 2_000, ephemeral_5m_input_tokens: 0 } } }
          },
          stream: (params: Record<string, unknown>) => {
            streamed.push(params)
            return { async *[Symbol.asyncIterator]() {}, finalMessage: async () => ({ stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }) }
          },
        },
      },
    } as unknown as Anthropic
    const llm = new AnthropicLlm(client)
    const base = { model: 'claude-opus-5-5', system: 'rules', cachedContext: 'brief', cacheTtl: '1h' as const, effort: 'low' as const }
    let usage: LlmUsage | undefined
    await llm.prewarm({ ...base, prompt: 'warmup', maxTokens: 0, onUsage: (u) => (usage = u) })
    await collectText(llm.streamText({ ...base, prompt: 'real question', maxTokens: 2048 }))
    expect(created[0]).toMatchObject({ max_tokens: 0, output_config: { effort: 'low' } })
    expect(created[0]).not.toHaveProperty('stream')
    // Everything up to the breakpoint is identical, so the real request reads what the warm-up wrote.
    expect(created[0].system).toEqual(streamed[0].system)
    expect(created[0].output_config).toEqual(streamed[0].output_config)
    expect(usage).toMatchObject({ cacheWriteTokens: 2_000, cacheWrite1hTokens: 2_000, outputTokens: 0 })
  })

  it('throws a typed error on refusal', async () => {
    const { client } = fakeClient('refusal')
    await expect(
      collectText(new AnthropicLlm(client).streamText({ model: 'm', system: 's', prompt: 'p', maxTokens: 1, effort: 'low' })),
    ).rejects.toBeInstanceOf(LlmRefusalError)
  })
})

function fakeJsonClient(reply: { stop_reason: string; text?: string }) {
  const calls: unknown[] = []
  const client = {
    beta: {
      messages: {
        create: async (params: unknown) => {
          calls.push(params)
          return {
            stop_reason: reply.stop_reason,
            stop_details: reply.stop_reason === 'refusal' ? { category: 'cyber' } : null,
            content: reply.text === undefined ? [] : [{ type: 'text', text: reply.text }],
            usage: { input_tokens: 5, output_tokens: 3, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 },
          }
        },
      },
    },
  }
  return { client: client as unknown as Anthropic, calls }
}

describe('AnthropicLlm.completeJson', () => {
  const base = { model: 'claude-opus-5-5', system: 'analyst', prompt: 'extract', maxTokens: 100, effort: 'medium' as const, task: 'outcomes', schema: { type: 'object' } }

  it('requests structured output and caches the shared transcript prefix', async () => {
    const { client, calls } = fakeJsonClient({ stop_reason: 'end_turn', text: '{"decisions":["go"]}' })
    let usage: LlmUsage | undefined
    const result = await new AnthropicLlm(client).completeJson<{ decisions: string[] }>({ ...base, cachedPrompt: 'TRANSCRIPT', onUsage: (u) => (usage = u) })
    expect(result).toEqual({ decisions: ['go'] })
    expect(usage?.cacheReadTokens).toBe(900)
    const params = calls[0] as { output_config: unknown; fallbacks: string; messages: Array<{ content: Array<Record<string, unknown>> }> }
    expect(params.output_config).toEqual({ effort: 'medium', format: { type: 'json_schema', schema: { type: 'object' } } })
    expect(params.fallbacks).toBe('default')
    expect(params.messages[0].content).toEqual([
      { type: 'text', text: 'TRANSCRIPT', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'extract' },
    ])
  })

  it('turns refusals, truncation and bad JSON into typed errors', async () => {
    await expect(new AnthropicLlm(fakeJsonClient({ stop_reason: 'refusal' }).client).completeJson(base)).rejects.toBeInstanceOf(LlmRefusalError)
    await expect(new AnthropicLlm(fakeJsonClient({ stop_reason: 'max_tokens', text: '{"a":' }).client).completeJson(base)).rejects.toBeInstanceOf(LlmOutputError)
    await expect(new AnthropicLlm(fakeJsonClient({ stop_reason: 'end_turn', text: 'not json' }).client).completeJson(base)).rejects.toThrow('not valid JSON')
  })
})
