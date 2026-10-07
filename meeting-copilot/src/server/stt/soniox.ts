import WebSocket from 'ws'
import type { LanguageCode } from '../../shared/protocol.ts'
import { AUDIO_SAMPLE_RATE } from '../../shared/protocol.ts'
import type { SttProvider, SttResult, SttStream, SttStreamOptions } from './types.ts'

const SONIOX_URL = 'wss://stt-rt.soniox.com/transcribe-websocket'
const END_TOKEN = '<end>'
const FIN_TOKEN = '<fin>'

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
 * until an `<end>` endpoint token (or a speaker change) closes the utterance.
 */
export class SonioxAccumulator {
  private finalTokens: SonioxToken[] = []

  handle(message: SonioxMessage): SttResult[] {
    const results: SttResult[] = []
    const nonFinal: SonioxToken[] = []

    for (const token of message.tokens ?? []) {
      if (token.text === FIN_TOKEN) continue
      if (token.text === END_TOKEN) {
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
      return results
    }

    const pending = [...this.finalTokens, ...nonFinal]
    const partial = toResult(pending, false)
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

export class SonioxProvider implements SttProvider {
  readonly name = 'soniox'

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  open(options: SttStreamOptions): SttStream {
    const socket = new WebSocket(SONIOX_URL)
    const accumulator = new SonioxAccumulator()
    const queue: Uint8Array[] = []
    let open = false
    let lastAudioAt = Date.now()

    const keepAlive = setInterval(() => {
      if (open && Date.now() - lastAudioAt > 5_000) socket.send(JSON.stringify({ type: 'keepalive' }))
    }, 5_000)

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
        options.onError(new Error(`Soniox ${message.error_code ?? ''}: ${message.error_message ?? 'unknown error'}`))
      }
      for (const result of accumulator.handle(message)) options.onResult(result)
    })

    socket.on('error', (error) => options.onError(error))
    socket.on('close', () => clearInterval(keepAlive))

    return {
      write(pcm) {
        lastAudioAt = Date.now()
        if (open && socket.readyState === WebSocket.OPEN) socket.send(pcm)
        else if (socket.readyState === WebSocket.CONNECTING && queue.length < 100) queue.push(pcm)
      },
      async close() {
        clearInterval(keepAlive)
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
