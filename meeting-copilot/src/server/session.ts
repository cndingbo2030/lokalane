import { randomUUID } from 'node:crypto'
import type { MeetingOutcomes } from '../shared/outcomes.ts'
import type {
  AudioSource,
  ClientMessage,
  DocumentRef,
  MeetingInfo,
  MetricsSnapshot,
  ServerMessage,
  SessionConfig,
  ShareSnapshot,
  SuggestionTrigger,
  TranscriptSegment,
} from '../shared/protocol.ts'
import { botJoinUrl, parseMeetingLink } from '../shared/meetingLink.ts'
import { AUDIO_SAMPLE_RATE, BOT_PLATFORMS, decodeAudioFrame } from '../shared/protocol.ts'
import { AudioClock } from '../shared/vad.ts'
import { Copilot } from './ai/copilot.ts'
import { briefBlock } from './ai/prompts.ts'
import { describeMeetingDate } from './ai/outcomes.ts'
import { extractOutcomes, streamSummary } from './ai/summarizer.ts'
import { Translator } from './ai/translator.ts'
import { botChatMessage, sanitizeBotName, type BotHandle, type BotLauncher } from './bot/types.ts'
import { playDemo } from './demo.ts'
import { sanitizeDocuments } from './documents.ts'
import type { LlmClient } from './llm/types.ts'
import { SessionMetrics } from './metrics.ts'
import type { SttProvider, SttResult, SttStream } from './stt/types.ts'
import { isMe, sanitizeSpeakerId, sanitizeSpeakerNames, TranscriptStore, type Speakers } from './transcript.ts'
import { TriggerDetector } from './triggers.ts'

export interface SessionDeps {
  send: (message: ServerMessage) => void
  stt: SttProvider
  llm: LlmClient
  models: { copilot: string; translate: string; summary: string }
  log?: (message: string, extra?: unknown) => void
  /** Receives the final metrics when the session closes (for structured logs). */
  onClosed?: (sessionId: string, metrics: MetricsSnapshot) => void
  /** How often changed metrics are pushed to the client; 0 disables the timer. */
  metricsIntervalMs?: number
  now?: () => number
  /** Meeting bots (bot mode); undefined when the server has no bot service configured. */
  bots?: BotLauncher
}

/**
 * One live meeting. Owns the STT streams (one per audio source), the transcript,
 * and the AI workers that react to it:
 *
 *   audio(me|remote) -> STT -> segments -> UI
 *                                 |-> Translator (finals, not in target language)
 *                                 |-> TriggerDetector -> Copilot (remote questions/objections)
 *                                 '-> TranscriptStore -> Summary (on demand)
 *
 * Audio comes from the client (tab / system audio + microphone) or, in bot mode,
 * from a meeting bot that joined the call. It may arrive with gaps (VAD), so each
 * source has an AudioClock that maps STT timestamps back to meeting time.
 */
export class MeetingSession {
  readonly id = randomUUID()
  private readonly shortId = this.id.slice(0, 8)
  private readonly now: () => number
  private config: SessionConfig | null = null
  private documents: DocumentRef[] = []
  private meetingInfo: MeetingInfo | undefined
  private speakers: Speakers = { names: {} }
  private readonly streams = new Map<AudioSource, SttStream>()
  private readonly clocks: Record<AudioSource, AudioClock> = { me: new AudioClock(), remote: new AudioClock() }
  private readonly counters: Record<AudioSource, number> = { me: 0, remote: 0 }
  private readonly finalizedAt = new Map<string, number>()
  private readonly transcript = new TranscriptStore()
  private readonly triggers: TriggerDetector
  private startedAt = 0
  private readonly metrics: SessionMetrics
  private translator: Translator | null = null
  private copilot: Copilot | null = null
  private demoController: AbortController | null = null
  private summaryController: AbortController | null = null
  private bot: BotHandle | null = null
  // Kept for live-link viewers who join mid-meeting.
  private readonly translations = new Map<string, string>()
  private readonly suggestionLog: Array<{ id: string; trigger: SuggestionTrigger; text: string; done: boolean; error?: string }> = []
  private summaryText = ''
  private outcomes: MeetingOutcomes | undefined
  private metricsTimer: ReturnType<typeof setInterval> | undefined
  private sentRevision = -1
  private closed = false

  constructor(private readonly deps: SessionDeps) {
    this.now = deps.now ?? Date.now
    this.metrics = new SessionMetrics(this.now)
    this.triggers = new TriggerDetector(6_000, this.now)
  }

  handleMessage(message: ClientMessage): void {
    switch (message.type) {
      case 'start':
        this.start(message.config)
        break
      case 'ask':
        this.ask(message.question)
        break
      case 'speakers':
        this.speakers = { names: sanitizeSpeakerNames(message.names), me: sanitizeSpeakerId(message.me) }
        this.deps.send({ type: 'speakers', names: { ...this.speakers.names }, me: this.speakers.me })
        break
      case 'feedback':
        if (typeof message.suggestionId === 'string' && message.suggestionId.startsWith(`${this.shortId}-`) && message.suggestionId.length <= 64) {
          this.metrics.rate(message.suggestionId, message.rating === 'up' || message.rating === 'down' ? message.rating : null)
          this.pushMetrics()
        }
        break
      case 'summary':
        void this.summarize()
        break
      case 'demo':
        this.runDemo()
        break
      case 'stop':
        void this.bot?.leave()
        void this.stopAudio().then(() => this.pushMetrics())
        break
      case 'ping':
        this.deps.send({ type: 'pong' })
        break
    }
  }

  handleAudio(frame: Uint8Array): void {
    if (!this.config || this.closed || this.bot) return
    const decoded = decodeAudioFrame(frame)
    if (decoded) this.ingest(decoded.source, decoded.pcm, decoded.captureMs)
  }

  /** `captureMs`: capture time, not arrival time, so audio buffered during a disconnect is placed exactly. */
  private ingest(source: AudioSource, pcm: Uint8Array, captureMs: number): void {
    if (!this.config || this.closed) return
    const durationMs = (pcm.byteLength / 2 / AUDIO_SAMPLE_RATE) * 1000
    this.clocks[source].record(captureMs, durationMs)
    this.metrics.addAudio(source, durationMs)
    this.streamFor(source).write(pcm)
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    clearInterval(this.metricsTimer)
    this.demoController?.abort()
    this.summaryController?.abort()
    this.translator?.stop()
    this.copilot?.stop()
    this.bot?.dispose()
    await this.stopAudio()
    if (this.config) this.deps.onClosed?.(this.id, this.metrics.snapshot())
  }

  /** Test helper: wait for in-flight AI work. */
  async idle(): Promise<void> {
    await Promise.all([this.translator?.idle(), this.copilot?.idle()])
  }

  /** A dropped client re-attached: confirm, with the same session id. */
  announceResumed(): void {
    this.deps.send({ type: 'ready', sessionId: this.id, stt: this.deps.stt.name, llm: this.deps.llm.name, resumed: true })
  }

  /** Everything a live-link viewer needs to catch up. The follow-up email draft stays private. */
  snapshot(includeSuggestions: boolean): ShareSnapshot {
    return {
      type: 'snapshot',
      title: this.meetingInfo?.title,
      startedAt: this.startedAt,
      segments: [...this.transcript.all()],
      translations: Object.fromEntries(this.translations),
      speakerNames: { ...this.speakers.names },
      me: this.speakers.me,
      suggestions: includeSuggestions
        ? this.suggestionLog.filter((s) => s.done && !s.error && s.text).map(({ id, trigger, text }) => ({ id, trigger, text }))
        : undefined,
      summary: this.summaryText || undefined,
      outcomes: this.outcomes ? { ...this.outcomes, followUpEmail: { subject: '', body: '' } } : undefined,
    }
  }

  /** How long to keep this meeting for its client after the socket drops (undefined: the default). */
  get detachedGraceMs(): number | undefined {
    // A bot keeps listening without the client (e.g. a phone that slept), so wait longer.
    return this.bot ? 15 * 60_000 : undefined
  }

  metricsSnapshot(): MetricsSnapshot {
    return this.metrics.snapshot()
  }

  private start(config: SessionConfig): void {
    if (this.config) {
      // A restart keeps the transcript but applies the new settings.
      this.translator?.stop()
      this.copilot?.stop()
    } else {
      this.startedAt = this.now()
    }
    this.config = config
    this.documents = sanitizeDocuments(config.documents)
    this.meetingInfo = sanitizeMeetingInfo(config.meeting)
    const cachedContext = briefBlock(config.brief, this.meetingInfo)
    const speakers = () => this.speakers

    this.translator = config.translate
      ? new Translator({
          llm: this.metrics.meter(this.deps.llm, 'translate'),
          model: this.deps.models.translate,
          target: config.targetLanguage,
          transcript: this.transcript,
          cachedContext,
          speakers,
          onTranslation: (segmentId, text) => {
            const finalAt = this.finalizedAt.get(segmentId)
            if (finalAt !== undefined) this.metrics.addTranslationLatency(this.now() - finalAt)
            this.finalizedAt.delete(segmentId)
            this.translations.set(segmentId, text)
            this.deps.send({ type: 'translation', segmentId, text, targetLanguage: config.targetLanguage })
          },
          onError: (error) => this.reportError('翻译失败', error),
        })
      : null

    this.copilot = config.copilot.enabled
      ? new Copilot({
          llm: this.metrics.meter(this.deps.llm, 'copilot'),
          model: this.deps.models.copilot,
          target: config.targetLanguage,
          transcript: this.transcript,
          cachedContext,
          documents: this.documents,
          speakers,
          idPrefix: this.shortId,
          events: {
            start: (id, trigger, waitedMs) => {
              this.metrics.suggestionShown(waitedMs)
              this.suggestionLog.unshift({ id, trigger, text: '', done: false })
              this.suggestionLog.splice(30)
              this.deps.send({ type: 'suggestion.start', id, trigger })
            },
            delta: (id, delta) => {
              const entry = this.suggestionLog.find((s) => s.id === id)
              if (entry) entry.text += delta
              this.deps.send({ type: 'suggestion.delta', id, delta })
            },
            done: (id, error) => {
              const entry = this.suggestionLog.find((s) => s.id === id)
              if (entry) Object.assign(entry, { done: true, error })
              this.deps.send({ type: 'suggestion.done', id, error })
            },
            skipped: () => this.metrics.suggestionSkipped(),
          },
        })
      : null

    this.deps.send({ type: 'ready', sessionId: this.id, stt: this.deps.stt.name, llm: this.deps.llm.name })
    if (config.bot && !this.bot) this.launchBot(config)

    clearInterval(this.metricsTimer)
    const interval = this.deps.metricsIntervalMs ?? 2_000
    if (interval > 0) this.metricsTimer = setInterval(() => this.pushMetrics(), interval)
  }

  private launchBot(config: SessionConfig): void {
    const link = parseMeetingLink(config.meetingUrl ?? '')
    const fail = (detail: string) => this.deps.send({ type: 'bot', state: 'fatal_error', detail })
    if (!this.deps.bots) return fail('服务器未开启会议机器人（需要配置 ATTENDEE_API_KEY 和 PUBLIC_URL）')
    if (!link || !BOT_PLATFORMS.includes(link.platform)) return fail('会议机器人支持 Zoom、Google Meet 和 Microsoft Teams 链接')
    const botName = sanitizeBotName(config.bot?.name)
    this.bot = this.deps.bots.launch({
      sessionId: this.id,
      meetingUrl: botJoinUrl(link),
      botName,
      chatMessage: botChatMessage(botName, config.spokenLanguages),
      meetingNowMs: () => this.now() - this.startedAt,
      // The bot hears the whole meeting, the user included: one diarized "remote" stream.
      onAudio: (pcm, captureMs) => this.ingest('remote', new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), captureMs),
      onStatus: (status) => this.deps.send({ type: 'bot', ...status }),
    })
  }

  private pushMetrics(): void {
    if (this.closed || !this.config || this.metrics.revision === this.sentRevision) return
    this.sentRevision = this.metrics.revision
    this.deps.send({ type: 'metrics', metrics: this.metrics.snapshot() })
  }

  private streamFor(source: AudioSource): SttStream {
    let stream = this.streams.get(source)
    if (!stream) {
      stream = this.deps.stt.open({
        source,
        languages: this.config?.spokenLanguages ?? ['auto'],
        // Diarize only the meeting audio; the microphone is always the user.
        diarize: source === 'remote',
        onResult: (result) => this.onSttResult(source, this.toMeetingTime(source, result)),
        onError: (error) => this.reportError(`语音识别出错 (${source})`, error),
      })
      this.streams.set(source, stream)
    }
    return stream
  }

  private toMeetingTime(source: AudioSource, result: SttResult): SttResult {
    const clock = this.clocks[source]
    return { ...result, startMs: clock.toWall(result.startMs), endMs: clock.toWall(result.endMs) }
  }

  private async stopAudio(): Promise<void> {
    const streams = [...this.streams.values()]
    this.streams.clear()
    await Promise.allSettled(streams.map((s) => s.close()))
  }

  /** Feed a normalized STT result (timestamps already in meeting time). Used by the demo and tests. */
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

    this.metrics.addFinal(source)
    this.transcript.addFinal(segment)
    if (this.translator) {
      this.finalizedAt.set(segment.id, this.now())
      this.translator.enqueue(segment)
    }
    if (this.config?.copilot.enabled && this.config.copilot.autoTrigger) {
      // The user's own voice in a diarized stream (bot / room mic) never triggers suggestions.
      const decision = this.triggers.evaluate(isMe(segment, this.speakers) ? { ...segment, source: 'me' } : segment)
      if (decision) {
        this.metrics.suggestionTriggered()
        this.copilot?.trigger({ kind: decision.kind, segmentId: segment.id, text: segment.text })
      }
    }
  }

  private ask(question?: string): void {
    if (!this.copilot) {
      this.deps.send({ type: 'error', message: 'AI 建议未开启', recoverable: true })
      return
    }
    const last = this.transcript.recent(60_000).filter((s) => !isMe(s, this.speakers)).at(-1)
    this.metrics.suggestionTriggered()
    this.copilot.trigger({ kind: 'manual', segmentId: last?.id, text: question?.trim() || last?.text || '' }, question?.trim() || undefined)
  }

  private async summarize(): Promise<void> {
    if (!this.config) return
    this.summaryController?.abort()
    const controller = new AbortController()
    this.summaryController = controller
    const analysis = {
      llm: this.metrics.meter(this.deps.llm, 'summary'),
      model: this.deps.models.summary,
      target: this.config.targetLanguage,
      transcript: this.transcript,
      cachedContext: briefBlock(this.config.brief, this.meetingInfo),
      documents: this.documents,
      speakers: this.speakers,
      signal: controller.signal,
    }
    this.summaryText = ''
    this.outcomes = undefined
    this.deps.send({ type: 'summary.start' })
    try {
      await streamSummary({
        ...analysis,
        onDelta: (delta) => {
          this.summaryText += delta
          this.deps.send({ type: 'summary.delta', delta })
        },
      })
      if (controller.signal.aborted) return
      this.deps.send({ type: 'summary.done' })
    } catch (error) {
      if (!controller.signal.aborted) this.deps.send({ type: 'summary.done', error: errorMessage(error) })
      this.pushMetrics()
      return
    }

    // Structured outcomes second: the transcript prefix is now cached.
    this.deps.send({ type: 'outcomes.start' })
    try {
      const outcomes = await extractOutcomes({ ...analysis, meetingDate: describeMeetingDate(this.startedAt, this.config.timeZone) })
      if (!controller.signal.aborted) {
        this.outcomes = outcomes
        this.deps.send({ type: 'outcomes', outcomes })
      }
    } catch (error) {
      if (!controller.signal.aborted) this.deps.send({ type: 'outcomes', error: errorMessage(error) })
    }
    this.pushMetrics()
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
    this.metrics.addError()
    this.deps.log?.(message, error)
    this.deps.send({ type: 'error', message, recoverable: true })
  }
}

/** Calendar data comes from the client: keep it short and plain. */
function sanitizeMeetingInfo(input: unknown): MeetingInfo | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  const { title, attendees } = input as MeetingInfo
  const clean = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/[\p{Cc}<>]/gu, ' ').trim().slice(0, max) : '')
  const info: MeetingInfo = {}
  if (clean(title, 200)) info.title = clean(title, 200)
  const names = Array.isArray(attendees) ? attendees.map((a) => clean(a, 100)).filter(Boolean).slice(0, 30) : []
  if (names.length) info.attendees = names
  return info.title || info.attendees ? info : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
