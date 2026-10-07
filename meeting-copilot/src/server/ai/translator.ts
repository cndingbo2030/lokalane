import { isAlreadyInLanguage } from '../../shared/language.ts'
import type { LanguageCode, TranscriptSegment } from '../../shared/protocol.ts'
import type { LlmClient } from '../llm/types.ts'
import { collectText } from '../llm/types.ts'
import { formatTranscript, type SpeakerNames, type TranscriptStore } from '../transcript.ts'
import { translatorPrompt, translatorSystem } from './prompts.ts'

export interface TranslatorOptions {
  llm: LlmClient
  model: string
  target: Exclude<LanguageCode, 'auto'>
  transcript: TranscriptStore
  cachedContext?: string
  speakerNames?: () => SpeakerNames
  maxConcurrent?: number
  onTranslation: (segmentId: string, text: string) => void
  onError: (error: unknown) => void
}

/**
 * Translates finalized segments with a few lines of preceding context.
 * Bounded concurrency keeps latency predictable when people talk fast; the
 * queue is ordered so translations arrive roughly in speaking order.
 */
export class Translator {
  private readonly queue: TranscriptSegment[] = []
  private active = 0
  private readonly controller = new AbortController()

  constructor(private readonly options: TranslatorOptions) {}

  enqueue(segment: TranscriptSegment): void {
    if (!segment.isFinal || !segment.text.trim()) return
    if (isAlreadyInLanguage(segment.text, this.options.target, segment.language)) return
    this.queue.push(segment)
    this.pump()
  }

  stop(): void {
    this.queue.length = 0
    this.controller.abort()
  }

  /** Resolves when the queue is drained (used by tests and graceful shutdown). */
  async idle(): Promise<void> {
    while (this.active > 0 || this.queue.length > 0) await new Promise((r) => setTimeout(r, 5))
  }

  private pump(): void {
    const limit = this.options.maxConcurrent ?? 3
    while (this.active < limit && this.queue.length > 0) {
      const segment = this.queue.shift()!
      this.active++
      void this.translate(segment).finally(() => {
        this.active--
        this.pump()
      })
    }
  }

  private async translate(segment: TranscriptSegment): Promise<void> {
    const { llm, model, target, transcript, cachedContext } = this.options
    try {
      const context = formatTranscript(transcript.before(segment.id, 4), this.options.speakerNames?.())
      const text = await collectText(
        llm.streamText({
          model,
          system: translatorSystem(target),
          cachedContext,
          prompt: translatorPrompt(context, segment.text),
          maxTokens: 1024,
          effort: 'low',
          signal: this.controller.signal,
        }),
      )
      const clean = text.trim()
      if (clean && !this.controller.signal.aborted) this.options.onTranslation(segment.id, clean)
    } catch (error) {
      if (!this.controller.signal.aborted) this.options.onError(error)
    }
  }
}
