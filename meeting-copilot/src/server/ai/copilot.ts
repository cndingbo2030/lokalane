import type { LanguageCode, SuggestionTrigger } from '../../shared/protocol.ts'
import type { LlmClient } from '../llm/types.ts'
import { formatTranscript, speakerLabel, type TranscriptStore } from '../transcript.ts'
import { copilotPrompt, copilotSystem } from './prompts.ts'

export interface CopilotEvents {
  start(id: string, trigger: SuggestionTrigger): void
  delta(id: string, delta: string): void
  done(id: string, error?: string): void
}

export interface CopilotOptions {
  llm: LlmClient
  model: string
  target: Exclude<LanguageCode, 'auto'>
  transcript: TranscriptStore
  cachedContext?: string
  events: CopilotEvents
  /** Window of transcript sent with each request. */
  windowMs?: number
  idPrefix: string
}

interface PendingRequest {
  trigger: SuggestionTrigger
  question?: string
  queuedAt: number
}

const SKIP = 'SKIP'
/** Auto triggers older than this are dropped instead of answered late. */
const STALE_MS = 20_000

/**
 * Runs one suggestion at a time. While a suggestion streams, newer automatic
 * triggers replace each other (only the latest is worth answering); a manual
 * request interrupts whatever automatic suggestion is in flight.
 */
export class Copilot {
  private counter = 0
  private running: { controller: AbortController; manual: boolean } | null = null
  private pending: PendingRequest | null = null
  private readonly sessionController = new AbortController()

  constructor(private readonly options: CopilotOptions) {}

  trigger(trigger: SuggestionTrigger, question?: string): void {
    const request: PendingRequest = { trigger, question, queuedAt: Date.now() }
    const manual = trigger.kind === 'manual'
    if (this.running) {
      if (manual && !this.running.manual) this.running.controller.abort()
      // Never let an automatic trigger displace a queued manual request.
      if (manual || this.pending?.trigger.kind !== 'manual') this.pending = request
      return
    }
    void this.run(request)
  }

  stop(): void {
    this.pending = null
    this.sessionController.abort()
    this.running?.controller.abort()
  }

  async idle(): Promise<void> {
    while (this.running || this.pending) await new Promise((r) => setTimeout(r, 5))
  }

  private async run(request: PendingRequest): Promise<void> {
    const manual = request.trigger.kind === 'manual'
    const controller = new AbortController()
    const abortOnStop = () => controller.abort()
    this.sessionController.signal.addEventListener('abort', abortOnStop)
    this.running = { controller, manual }

    const id = `${this.options.idPrefix}-sg${++this.counter}`
    const { llm, model, target, transcript, cachedContext, events } = this.options
    const recent = transcript.recent(this.options.windowMs ?? 4 * 60_000)
    const focusSegment = recent.find((s) => s.id === request.trigger.segmentId)
    const focus = focusSegment ? `${speakerLabel(focusSegment)}: ${focusSegment.text}` : request.trigger.text

    // Buffer the first few characters so a "SKIP" answer never flashes a card.
    let buffer = ''
    let started = false
    const flushStart = () => {
      if (started) return
      started = true
      events.start(id, request.trigger)
      if (buffer) events.delta(id, buffer)
    }

    let error: string | undefined
    try {
      const stream = llm.streamText({
        model,
        system: copilotSystem(target),
        cachedContext,
        prompt: copilotPrompt(request.trigger.kind, formatTranscript(recent), focus, request.question),
        maxTokens: 2048,
        effort: 'low',
        signal: controller.signal,
      })
      for await (const delta of stream) {
        if (started) {
          events.delta(id, delta)
          continue
        }
        buffer += delta
        const trimmed = buffer.trimStart()
        if (!manual && trimmed.length < SKIP.length && SKIP.startsWith(trimmed)) continue
        if (!manual && trimmed.startsWith(SKIP)) {
          controller.abort()
          break
        }
        flushStart()
      }
      if (!started && buffer.trim() && !buffer.trim().startsWith(SKIP)) flushStart()
    } catch (err) {
      if (!controller.signal.aborted) error = err instanceof Error ? err.message : String(err)
    } finally {
      this.sessionController.signal.removeEventListener('abort', abortOnStop)
      if (started || error) {
        if (!started) events.start(id, request.trigger)
        events.done(id, error ?? (controller.signal.aborted && started ? 'interrupted' : undefined))
      }
      this.running = null
      this.runNext()
    }
  }

  private runNext(): void {
    const next = this.pending
    this.pending = null
    if (!next || this.sessionController.signal.aborted) return
    if (next.trigger.kind !== 'manual' && Date.now() - next.queuedAt > STALE_MS) return
    void this.run(next)
  }
}
