import { randomUUID } from 'node:crypto'
import type { AudioSource, ClientMessage, ServerMessage, SessionConfig, TranscriptSegment } from '../shared/protocol.ts'
import { decodeAudioFrame } from '../shared/protocol.ts'
import { Copilot } from './ai/copilot.ts'
import { briefBlock } from './ai/prompts.ts'
import { streamSummary } from './ai/summarizer.ts'
import { Translator } from './ai/translator.ts'
import { playDemo } from './demo.ts'
import type { LlmClient } from './llm/types.ts'
import type { SttProvider, SttResult, SttStream } from './stt/types.ts'
import { TranscriptStore } from './transcript.ts'
import { TriggerDetector } from './triggers.ts'

export interface SessionDeps {
  send: (message: ServerMessage) => void
  stt: SttProvider
  llm: LlmClient
  models: { copilot: string; translate: string; summary: string }
  log?: (message: string, extra?: unknown) => void
}

/**
 * One live meeting. Owns the STT streams (one per audio source), the transcript,
 * and the AI workers that react to it:
 *
 *   audio(me|remote) -> STT -> segments -> UI
 *                                 |-> Translator (finals, not in target language)
 *                                 |-> TriggerDetector -> Copilot (remote questions/objections)
 *                                 '-> TranscriptStore -> Summary (on demand)
 */
export class MeetingSession {
  readonly id = randomUUID()
  private readonly shortId = this.id.slice(0, 8)
  private config: SessionConfig | null = null
  private readonly streams = new Map<AudioSource, SttStream>()
  private readonly counters: Record<AudioSource, number> = { me: 0, remote: 0 }
  private readonly transcript = new TranscriptStore()
  private readonly triggers = new TriggerDetector()
  private translator: Translator | null = null
  private copilot: Copilot | null = null
  private demoController: AbortController | null = null
  private summaryController: AbortController | null = null
  private closed = false

  constructor(private readonly deps: SessionDeps) {}

  handleMessage(message: ClientMessage): void {
    switch (message.type) {
      case 'start':
        this.start(message.config)
        break
      case 'ask':
        this.ask(message.question)
        break
      case 'summary':
        void this.summarize()
        break
      case 'demo':
        this.runDemo()
        break
      case 'stop':
        void this.stopAudio()
        break
      case 'ping':
        this.deps.send({ type: 'pong' })
        break
    }
  }

  handleAudio(frame: Uint8Array): void {
    if (!this.config || this.closed) return
    const decoded = decodeAudioFrame(frame)
    if (!decoded) return
    this.streamFor(decoded.source).write(decoded.pcm)
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.demoController?.abort()
    this.summaryController?.abort()
    this.translator?.stop()
    this.copilot?.stop()
    await this.stopAudio()
  }

  /** Test helper: wait for in-flight AI work. */
  async idle(): Promise<void> {
    await Promise.all([this.translator?.idle(), this.copilot?.idle()])
  }

  private start(config: SessionConfig): void {
    if (this.config) {
      // A restart (e.g. reconnect) keeps the transcript but applies the new settings.
      this.translator?.stop()
      this.copilot?.stop()
    }
    this.config = config
    const cachedContext = briefBlock(config.brief)

    this.translator = config.translate
      ? new Translator({
          llm: this.deps.llm,
          model: this.deps.models.translate,
          target: config.targetLanguage,
          transcript: this.transcript,
          cachedContext,
          onTranslation: (segmentId, text) =>
            this.deps.send({ type: 'translation', segmentId, text, targetLanguage: config.targetLanguage }),
          onError: (error) => this.reportError('翻译失败', error),
        })
      : null

    this.copilot = config.copilot.enabled
      ? new Copilot({
          llm: this.deps.llm,
          model: this.deps.models.copilot,
          target: config.targetLanguage,
          transcript: this.transcript,
          cachedContext,
          idPrefix: this.shortId,
          events: {
            start: (id, trigger) => this.deps.send({ type: 'suggestion.start', id, trigger }),
            delta: (id, delta) => this.deps.send({ type: 'suggestion.delta', id, delta }),
            done: (id, error) => this.deps.send({ type: 'suggestion.done', id, error }),
          },
        })
      : null

    this.deps.send({ type: 'ready', sessionId: this.id, stt: this.deps.stt.name, llm: this.deps.llm.name })
  }

  private streamFor(source: AudioSource): SttStream {
    let stream = this.streams.get(source)
    if (!stream) {
      stream = this.deps.stt.open({
        source,
        languages: this.config?.spokenLanguages ?? ['auto'],
        // Diarize only the meeting audio; the microphone is always the user.
        diarize: source === 'remote',
        onResult: (result) => this.onSttResult(source, result),
        onError: (error) => this.reportError(`语音识别出错 (${source})`, error),
      })
      this.streams.set(source, stream)
    }
    return stream
  }

  private async stopAudio(): Promise<void> {
    const streams = [...this.streams.values()]
    this.streams.clear()
    await Promise.allSettled(streams.map((s) => s.close()))
  }

  /** Exposed for the demo and tests: feed a normalized STT result. */
  onSttResult(source: AudioSource, result: SttResult): void {
    if (this.closed) return
    const segment: TranscriptSegment = {
      id: `${this.shortId}-${source}-${this.counters[source]}`,
      source,
      speaker: result.speaker,
      text: result.text,
      isFinal: result.isFinal,
      startMs: result.startMs,
      endMs: result.endMs,
      language: result.language,
    }
    if (result.isFinal) this.counters[source]++
    this.deps.send({ type: 'transcript', segment })
    if (!segment.isFinal) return

    this.transcript.addFinal(segment)
    this.translator?.enqueue(segment)
    if (this.config?.copilot.enabled && this.config.copilot.autoTrigger) {
      const decision = this.triggers.evaluate(segment)
      if (decision) this.copilot?.trigger({ kind: decision.kind, segmentId: segment.id, text: segment.text })
    }
  }

  private ask(question?: string): void {
    if (!this.copilot) {
      this.deps.send({ type: 'error', message: 'AI 建议未开启', recoverable: true })
      return
    }
    const last = this.transcript.recent(60_000).filter((s) => s.source === 'remote').at(-1)
    this.copilot.trigger({ kind: 'manual', segmentId: last?.id, text: question?.trim() || last?.text || '' }, question?.trim() || undefined)
  }

  private async summarize(): Promise<void> {
    if (!this.config) return
    this.summaryController?.abort()
    const controller = new AbortController()
    this.summaryController = controller
    this.deps.send({ type: 'summary.start' })
    try {
      await streamSummary({
        llm: this.deps.llm,
        model: this.deps.models.summary,
        target: this.config.targetLanguage,
        transcript: this.transcript,
        cachedContext: briefBlock(this.config.brief),
        signal: controller.signal,
        onDelta: (delta) => this.deps.send({ type: 'summary.delta', delta }),
      })
      if (!controller.signal.aborted) this.deps.send({ type: 'summary.done' })
    } catch (error) {
      if (!controller.signal.aborted) this.deps.send({ type: 'summary.done', error: errorMessage(error) })
    }
  }

  private runDemo(): void {
    if (!this.config) return
    this.demoController?.abort()
    const controller = new AbortController()
    this.demoController = controller
    void playDemo((source, result) => this.onSttResult(source, result), { signal: controller.signal })
  }

  private reportError(context: string, error: unknown): void {
    const message = `${context}: ${errorMessage(error)}`
    this.deps.log?.(message, error)
    this.deps.send({ type: 'error', message, recoverable: true })
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
