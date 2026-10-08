import { describe, expect, it } from 'vitest'
import { MockLlm } from './llm/mock.ts'
import { collectText, type LlmClient } from './llm/types.ts'
import { estimateCostUsd, SessionMetrics } from './metrics.ts'

describe('estimateCostUsd', () => {
  it('prices Opus 5.5 tokens including cache reads and writes', () => {
    const cost = estimateCostUsd('claude-opus-5-5', { inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 })
    expect(cost).toBeCloseTo(4 + 2 + 0.2)
  })

  it('prices 1-hour cache writes at twice the input price', () => {
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 1_000_000, cacheWrite1hTokens: 400_000 }
    expect(estimateCostUsd('claude-opus-5-5', usage)).toBeCloseTo(0.6 * 5 + 0.4 * 8)
  })

  it('returns 0 for unknown models', () => {
    expect(estimateCostUsd('mystery', { inputTokens: 1e6, outputTokens: 1e6, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(0)
  })
})

describe('SessionMetrics', () => {
  it('meters calls, time to first token and usage per role', async () => {
    let now = 0
    const metrics = new SessionMetrics(() => now)
    const slow: LlmClient = {
      name: 'slow',
      completeJson: async () => ({}) as never,
      prewarm: async () => {},
      async *streamText(request) {
        now += 800
        yield 'hello'
        request.onUsage?.({ inputTokens: 100, outputTokens: 10, cacheReadTokens: 900, cacheWriteTokens: 0 })
      },
    }
    await collectText(metrics.meter(slow, 'copilot').streamText({ model: 'claude-opus-5-5', system: '', prompt: '', maxTokens: 10, effort: 'low' }))
    const snap = metrics.snapshot()
    expect(snap.llm.copilot).toMatchObject({ calls: 1, errors: 0, inputTokens: 100, cacheReadTokens: 900, ttftMs: { count: 1, p50: 800 } })
    expect(snap.costUsd).toBeGreaterThan(0)
  })

  it('counts errors but not user aborts', async () => {
    const metrics = new SessionMetrics()
    const failing: LlmClient = {
      name: 'x',
      completeJson: async () => {
        throw new Error('boom')
      },
      prewarm: async () => {},
      // eslint-disable-next-line require-yield
      async *streamText() {
        throw new Error('boom')
      },
    }
    await expect(collectText(metrics.meter(failing, 'translate').streamText({ model: 'm', system: '', prompt: '', maxTokens: 1, effort: 'low' }))).rejects.toThrow()
    const controller = new AbortController()
    controller.abort()
    await expect(
      collectText(metrics.meter(failing, 'translate').streamText({ model: 'm', system: '', prompt: '', maxTokens: 1, effort: 'low', signal: controller.signal })),
    ).rejects.toThrow()
    expect(metrics.snapshot().llm.translate.errors).toBe(1)
  })

  it('reports percentiles and lets feedback be changed or cleared', () => {
    const metrics = new SessionMetrics()
    for (const ms of [100, 200, 300, 400, 1_000]) metrics.addTranslationLatency(ms)
    expect(metrics.snapshot().translationLatencyMs).toEqual({ count: 5, p50: 300, p95: 1_000 })
    metrics.rate('a', 'up')
    metrics.rate('a', 'down')
    metrics.rate('b', 'up')
    metrics.rate('b', null)
    expect(metrics.snapshot().suggestions).toMatchObject({ up: 0, down: 1 })
  })

  it('records the cost of a cache pre-warm without counting it as a call', async () => {
    const metrics = new SessionMetrics()
    await metrics.meter(new MockLlm(), 'copilot').prewarm({ model: 'claude-opus-5-5', system: 'x'.repeat(4_000), prompt: 'warmup', maxTokens: 0, effort: 'low' })
    const copilot = metrics.snapshot().llm.copilot
    expect(copilot.calls).toBe(0)
    expect(copilot.cacheWriteTokens).toBeGreaterThan(0)
    expect(copilot.costUsd).toBeGreaterThan(0)
  })

  it('meters structured (JSON) calls too', async () => {
    const metrics = new SessionMetrics()
    const result = await metrics
      .meter(new MockLlm(), 'summary')
      .completeJson<{ decisions: string[] }>({ model: 'claude-opus-5-5', system: 's', prompt: 'p', maxTokens: 10, effort: 'low', schema: {}, task: 'outcomes' })
    expect(result.decisions.length).toBeGreaterThan(0)
    expect(metrics.snapshot().llm.summary).toMatchObject({ calls: 1, errors: 0 })
    expect(metrics.snapshot().llm.summary.outputTokens).toBeGreaterThan(0)
  })

  it('works with the mock LLM usage estimate', async () => {
    const metrics = new SessionMetrics()
    await collectText(metrics.meter(new MockLlm(), 'summary').streamText({ model: 'claude-opus-5-5', system: 'x'.repeat(400), prompt: 'y', maxTokens: 10, effort: 'low' }))
    expect(metrics.snapshot().llm.summary.inputTokens).toBeGreaterThanOrEqual(100)
  })
})
