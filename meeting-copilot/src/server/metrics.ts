import type { AudioSource, LatencyStats, LlmRole, MetricsSnapshot, RoleMetrics } from '../shared/protocol.ts'
import type { LlmClient, LlmJsonRequest, LlmTextRequest, LlmUsage } from './llm/types.ts'

/** USD per million tokens (list prices). Cache writes: 1.25× input for the 5-minute TTL, 2× for 1 hour. Unknown models cost 0. */
const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number; cacheWrite1h: number }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5, cacheWrite1h: 8 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5, cacheWrite1h: 4 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25, cacheWrite1h: 2 },
}

export function estimateCostUsd(model: string, usage: LlmUsage): number {
  const price = PRICES[model]
  if (!price) return 0
  const write1h = Math.min(usage.cacheWrite1hTokens ?? 0, usage.cacheWriteTokens)
  return (
    (usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      usage.cacheReadTokens * price.cacheRead +
      (usage.cacheWriteTokens - write1h) * price.cacheWrite +
      write1h * price.cacheWrite1h) /
    1_000_000
  )
}

/** Keeps a bounded sample window and reports percentiles. */
class Samples {
  private readonly values: number[] = []
  constructor(private readonly limit = 500) {}

  add(value: number): void {
    this.values.push(value)
    if (this.values.length > this.limit) this.values.shift()
  }

  stats(): LatencyStats {
    if (this.values.length === 0) return { count: 0, p50: null, p95: null }
    const sorted = [...this.values].sort((a, b) => a - b)
    const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
    return { count: this.values.length, p50: Math.round(at(0.5)), p95: Math.round(at(0.95)) }
  }
}

interface RoleState extends Omit<RoleMetrics, 'ttftMs'> {
  ttft: Samples
}

const ROLES: LlmRole[] = ['translate', 'copilot', 'summary']

/**
 * Per-meeting telemetry: what the user experienced (latency), what it cost
 * (tokens, audio minutes) and whether it helped (suggestion feedback).
 */
export class SessionMetrics {
  private readonly audioMs: Record<AudioSource, number> = { me: 0, remote: 0 }
  private readonly finals: Record<AudioSource, number> = { me: 0, remote: 0 }
  private readonly translationLatency = new Samples()
  private readonly suggestionLatency = new Samples()
  private readonly roles = Object.fromEntries(
    ROLES.map((role) => [role, { calls: 0, errors: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, ttft: new Samples() }]),
  ) as Record<LlmRole, RoleState>
  private readonly suggestionCounts = { triggered: 0, shown: 0, skipped: 0, up: 0, down: 0 }
  private readonly ratings = new Map<string, 'up' | 'down'>()
  private errorCount = 0
  private version = 0

  constructor(private readonly now: () => number = Date.now) {}

  /** Bumps on every change, so callers can skip sending identical snapshots. */
  get revision(): number {
    return this.version
  }

  addAudio(source: AudioSource, ms: number): void {
    this.audioMs[source] += ms
    this.version++
  }

  addFinal(source: AudioSource): void {
    this.finals[source]++
    this.version++
  }

  addTranslationLatency(ms: number): void {
    this.translationLatency.add(ms)
    this.version++
  }

  suggestionTriggered(): void {
    this.suggestionCounts.triggered++
    this.version++
  }

  suggestionShown(latencyMs: number): void {
    this.suggestionCounts.shown++
    this.suggestionLatency.add(latencyMs)
    this.version++
  }

  suggestionSkipped(): void {
    this.suggestionCounts.skipped++
    this.version++
  }

  rate(suggestionId: string, rating: 'up' | 'down' | null): void {
    const previous = this.ratings.get(suggestionId)
    // A meeting has at most a few hundred suggestions; bound memory against a misbehaving client.
    if (!previous && this.ratings.size >= 500) return
    if (previous) this.suggestionCounts[previous]--
    if (rating) {
      this.ratings.set(suggestionId, rating)
      this.suggestionCounts[rating]++
    } else {
      this.ratings.delete(suggestionId)
    }
    this.version++
  }

  addError(): void {
    this.errorCount++
    this.version++
  }

  addUsage(role: LlmRole, model: string, usage: LlmUsage): void {
    const state = this.roles[role]
    state.inputTokens += usage.inputTokens
    state.outputTokens += usage.outputTokens
    state.cacheReadTokens += usage.cacheReadTokens
    state.cacheWriteTokens += usage.cacheWriteTokens
    state.costUsd += estimateCostUsd(model, usage)
    this.version++
  }

  /** Wraps an LLM client so every call for `role` is timed and its usage recorded. */
  meter(llm: LlmClient, role: LlmRole): LlmClient {
    return {
      name: llm.name,
      streamText: (request) => this.meteredStream(llm, role, request),
      completeJson: (request) => this.meteredJson(llm, role, request),
      // Costs money but is not a call the user waits for: usage only, no call count or latency.
      prewarm: (request) =>
        llm.prewarm({
          ...request,
          onUsage: (usage) => {
            this.addUsage(role, request.model, usage)
            request.onUsage?.(usage)
          },
        }),
    }
  }

  private async meteredJson<T>(llm: LlmClient, role: LlmRole, request: LlmJsonRequest): Promise<T> {
    const state = this.roles[role]
    state.calls++
    this.version++
    try {
      return await llm.completeJson<T>({
        ...request,
        onUsage: (usage) => {
          this.addUsage(role, request.model, usage)
          request.onUsage?.(usage)
        },
      })
    } catch (error) {
      if (!request.signal?.aborted) {
        state.errors++
        this.version++
      }
      throw error
    }
  }

  private async *meteredStream(llm: LlmClient, role: LlmRole, request: LlmTextRequest): AsyncIterable<string> {
    const state = this.roles[role]
    state.calls++
    this.version++
    const started = this.now()
    let first = true
    try {
      for await (const delta of llm.streamText({
        ...request,
        onUsage: (usage) => {
          this.addUsage(role, request.model, usage)
          request.onUsage?.(usage)
        },
      })) {
        if (first) {
          first = false
          state.ttft.add(this.now() - started)
          this.version++
        }
        yield delta
      }
    } catch (error) {
      if (!request.signal?.aborted) {
        state.errors++
        this.version++
      }
      throw error
    }
  }

  snapshot(): MetricsSnapshot {
    const llm = Object.fromEntries(
      ROLES.map((role) => {
        const { ttft, ...rest } = this.roles[role]
        return [role, { ...rest, costUsd: round(rest.costUsd), ttftMs: ttft.stats() }]
      }),
    ) as Record<LlmRole, RoleMetrics>
    return {
      audioSentSeconds: { me: round(this.audioMs.me / 1000, 1), remote: round(this.audioMs.remote / 1000, 1) },
      finalSegments: { ...this.finals },
      translationLatencyMs: this.translationLatency.stats(),
      suggestionLatencyMs: this.suggestionLatency.stats(),
      llm,
      suggestions: { ...this.suggestionCounts },
      errors: this.errorCount,
      costUsd: round(ROLES.reduce((sum, role) => sum + this.roles[role].costUsd, 0)),
    }
  }
}

function round(value: number, digits = 4): number {
  const f = 10 ** digits
  return Math.round(value * f) / f
}
