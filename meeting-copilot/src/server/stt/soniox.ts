import WebSocket from 'ws'
import type { LanguageCode } from '../../shared/protocol.ts'
import { AUDIO_SAMPLE_RATE } from '../../shared/protocol.ts'
import { closeDetail, HANDSHAKE_TIMEOUT_MS, isFatalStatus, MAX_QUEUED_FRAMES, watchLiveness } from './socket.ts'
import type { SttProvider, SttResult, SttStream, SttStreamOptions } from './types.ts'

const SONIOX_URL = 'wss://stt-rt.soniox.com/transcribe-websocket'
const END_TOKEN = '<end>'
const FIN_TOKEN = '<fin>'

/**
 * How long the audio must pause before we ask Soniox to finalize. Soniox only detects
 * an endpoint from audio it receives (up to 2 s of silence by default). Client-side VAD
 * keeps sending 2.5 s past the end of speech so that normally suffices; this is the
 * backstop for when a sentence is still open once the audio stops (a longer endpoint
 * delay, bot audio), so it never waits for the speaker to talk again.
 */
export const FINALIZE_AFTER_GAP_MS = 500

interface SonioxToken {
  text: string
  is_final: boolean
  start_ms?: number
  end_ms?: number
  speaker?: string | number
  language?: string
}

interface SonioxMessage {
  tokens?: SonioxToken[]
  finished?: boolean
  error_code?: number | string
  error_message?: string
}

/**
 * Turns Soniox token streams into utterance results. Final tokens are buffered
 * until an `<end>` endpoint token, a `<fin>` (a finalize request completed) or a
 * speaker change closes the utterance.
 */
export class SonioxAccumulator {
  private finalTokens: SonioxToken[] = []
  private open = false

  /** Speech is recognized but no `<end>` / `<fin>` has closed it yet. */
  get hasOpenUtterance(): boolean {
    return this.open
  }

  handle(message: SonioxMessage): SttResult[] {
    const results: SttResult[] = []
    const nonFinal: SonioxToken[] = []

    for (const token of message.tokens ?? []) {
      if (token.text === END_TOKEN || token.text === FIN_TOKEN) {
        if (token.is_final) {
          const flushed = this.flush()
          if (flushed) results.push(flushed)
        }
        continue
      }
      if (token.is_final) {
        const current = this.finalTokens[0]
        if (current && token.speaker !== undefined && current.speaker !== undefined && String(token.speaker) !== String(current.speaker)) {
          const flushed = this.flush()
          if (flushed) results.push(flushed)
        }
        this.finalTokens.push(token)
      } else {
        nonFinal.push(token)
      }
    }

    if (message.finished) {
      const flushed = this.flush()
      if (flushed) results.push(flushed)
      this.open = false
      return results
    }

    const partial = toResult([...this.finalTokens, ...nonFinal], false)
    this.open = partial !== null
    if (partial) results.push(partial)
    return results
  }

  private flush(): SttResult | null {
    const result = toResult(this.finalTokens, true)
    this.finalTokens = []
    return result
  }
}

function toResult(tokens: SonioxToken[], isFinal: boolean): SttResult | null {
  const text = tokens.map((t) => t.text).join('').trim()
  if (!text) return null
  const first = tokens[0]
  const last = tokens.at(-1)!
  return {
    text,
    isFinal,
    speaker: first.speaker !== undefined && first.speaker !== '' ? `S${first.speaker}` : undefined,
    language: mostCommon(tokens.map((t) => t.language).filter((l): l is string => Boolean(l))),
    startMs: first.start_ms ?? 0,
    endMs: last.end_ms ?? first.start_ms ?? 0,
  }
}

function mostCommon(values: string[]): string | undefined {
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best: string | undefined
  let bestCount = 0
  for (const [v, c] of counts) if (c > bestCount) [best, bestCount] = [v, c]
  return best
}

export function sonioxLanguageHints(languages: LanguageCode[]): string[] {
  return languages.filter((l) => l !== 'auto')
}

/**
 * Decides when to send Soniox a `finalize` request: once per pause in the audio,
 * and only while an utterance is open. Soniox asks for ~200 ms of silence before
 * finalizing and warns that calling it too often can drop the connection; the
 * VAD hangover provides the silence, one call per pause keeps the rate low.
 * With continuous audio (VAD off) there are no pauses and endpoint detection
 * closes utterances on its own.
 */
export class PauseFinalizer {
  private timer: ReturnType<typeof setTimeout> | undefined
  private paused = false
  private armed = false

  constructor(
    private readonly gapMs: number,
    private readonly canFinalize: () => boolean,
    private readonly finalize: () => void,
  ) {}

  /** Audio was just sent. */
  onAudio(): void {
    this.armed = true
    this.paused = false
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.paused = true
      this.onResults()
    }, this.gapMs)
  }

  /** Results arrived: the last words of a sentence can be recognized after the pause began. */
  onResults(): void {
    if (!this.paused || !this.armed || !this.canFinalize()) return
    this.armed = false
    this.finalize()
  }

  stop(): void {
    clearTimeout(this.timer)
  }
}

export interface SonioxSettings {
  /** Upper bound for Soniox endpoint detection, 500–3000 ms (Soniox's default: 2000). Unset: not sent. */
  maxEndpointDelayMs?: number
  /** Tests point the provider at a local fake server. */
  url?: string
  finalizeAfterGapMs?: number
  livenessIntervalMs?: number
}

export class SonioxProvider implements SttProvider {
  readonly name = 'soniox'

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly settings: SonioxSettings = {},
  ) {}

  open(options: SttStreamOptions): SttStream {
    const socket = new WebSocket(this.settings.url ?? SONIOX_URL, { handshakeTimeout: HANDSHAKE_TIMEOUT_MS })
    const accumulator = new SonioxAccumulator()
    const queue: Uint8Array[] = []
    let open = false
    let closing = false
    // Soniox reports an error (HTTP-style status) and then closes the connection.
    let errorStatus: number | undefined
    let lastAudioAt = Date.now()

    const keepAlive = setInterval(() => {
      if (open && socket.readyState === WebSocket.OPEN && Date.now() - lastAudioAt > 3_000) {
        socket.send(JSON.stringify({ type: 'keepalive' }))
      }
    }, 3_000)
    const stopWatching = watchLiveness(socket, this.settings.livenessIntervalMs)
    const finalizer = new PauseFinalizer(
      this.settings.finalizeAfterGapMs ?? FINALIZE_AFTER_GAP_MS,
      () => open && socket.readyState === WebSocket.OPEN && accumulator.hasOpenUtterance,
      () => socket.send(JSON.stringify({ type: 'finalize' })),
    )

    socket.on('open', () => {
      socket.send(
        JSON.stringify({
          api_key: this.apiKey,
          model: this.model,
          audio_format: 'pcm_s16le',
          sample_rate: AUDIO_SAMPLE_RATE,
          num_channels: 1,
          language_hints: sonioxLanguageHints(options.languages),
          enable_language_identification: true,
          enable_speaker_diarization: options.diarize,
          enable_endpoint_detection: true,
          ...(this.settings.maxEndpointDelayMs ? { max_endpoint_delay_ms: this.settings.maxEndpointDelayMs } : {}),
          client_reference_id: `meeting-copilot-${options.source}`,
        }),
      )
      open = true
      for (const chunk of queue.splice(0)) socket.send(chunk)
    })

    socket.on('message', (data, isBinary) => {
      if (isBinary) return
      let message: SonioxMessage
      try {
        message = JSON.parse(data.toString()) as SonioxMessage
      } catch {
        return
      }
      if (message.error_code || message.error_message) {
        errorStatus = Number(message.error_code) || undefined
        options.onError(new Error(`Soniox ${message.error_code ?? ''}: ${message.error_message ?? 'unknown error'}`))
      }
      for (const result of accumulator.handle(message)) options.onResult(result)
      finalizer.onResults()
    })

    socket.on('error', (error) => options.onError(error))
    socket.on('close', (code, reason) => {
      clearInterval(keepAlive)
      finalizer.stop()
      stopWatching()
      if (!closing) options.onClose?.({ detail: closeDetail('Soniox', code, reason, errorStatus), fatal: isFatalStatus(errorStatus) })
    })

    return {
      write(pcm) {
        lastAudioAt = Date.now()
        finalizer.onAudio()
        if (open && socket.readyState === WebSocket.OPEN) socket.send(pcm)
        else if (socket.readyState === WebSocket.CONNECTING && queue.length < MAX_QUEUED_FRAMES) queue.push(pcm)
      },
      async close() {
        closing = true
        clearInterval(keepAlive)
        finalizer.stop()
        stopWatching()
        if (socket.readyState === WebSocket.OPEN) {
          // An empty frame asks Soniox to finalize remaining audio and close.
          socket.send('')
          await waitForClose(socket, 3_000)
        } else {
          socket.terminate()
        }
      },
    }
  }
}

export function waitForClose(socket: WebSocket, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (socket.readyState === WebSocket.CLOSED) return resolve()
    const timer = setTimeout(() => {
      socket.terminate()
      resolve()
    }, timeoutMs)
    socket.once('close', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}
