import WebSocket from 'ws'
import { joinText } from '../../shared/language.ts'
import type { LanguageCode } from '../../shared/protocol.ts'
import { AUDIO_SAMPLE_RATE } from '../../shared/protocol.ts'
import { waitForClose } from './soniox.ts'
import type { SttProvider, SttResult, SttStream, SttStreamOptions } from './types.ts'

interface DeepgramWord {
  word: string
  start: number
  end: number
  speaker?: number
  language?: string
}

interface DeepgramMessage {
  type?: string
  is_final?: boolean
  speech_final?: boolean
  start?: number
  duration?: number
  channel?: {
    alternatives?: Array<{ transcript: string; words?: DeepgramWord[]; languages?: string[] }>
  }
}

/**
 * Deepgram sends interim results that are replaced until `is_final`, and an
 * utterance may span several `is_final` chunks until `speech_final` (or an
 * `UtteranceEnd` event). We accumulate committed chunks into one utterance.
 */
export class DeepgramAccumulator {
  private committed = ''
  private startMs: number | null = null
  private endMs = 0
  private speaker: string | undefined
  private language: string | undefined

  handle(message: DeepgramMessage): SttResult[] {
    if (message.type === 'UtteranceEnd') {
      const flushed = this.flush()
      return flushed ? [flushed] : []
    }
    if (message.type !== 'Results') return []

    const alternative = message.channel?.alternatives?.[0]
    const transcript = alternative?.transcript?.trim() ?? ''
    const startMs = Math.round((message.start ?? 0) * 1000)
    const endMs = Math.round(((message.start ?? 0) + (message.duration ?? 0)) * 1000)

    if (transcript) {
      if (this.startMs === null) this.startMs = startMs
      const speakerId = alternative?.words?.find((w) => w.speaker !== undefined)?.speaker
      if (speakerId !== undefined && this.speaker === undefined) this.speaker = `S${speakerId + 1}`
      this.language ??= alternative?.languages?.[0] ?? alternative?.words?.find((w) => w.language)?.language
    }

    if (message.is_final) {
      if (transcript) {
        this.committed = joinText(this.committed, transcript)
        this.endMs = endMs
      }
      if (message.speech_final) {
        const flushed = this.flush()
        return flushed ? [flushed] : []
      }
      return this.committed ? [this.result(this.committed, false, endMs)] : []
    }

    const text = joinText(this.committed, transcript)
    return text ? [this.result(text, false, endMs)] : []
  }

  private result(text: string, isFinal: boolean, endMs: number): SttResult {
    return {
      text,
      isFinal,
      speaker: this.speaker,
      language: this.language,
      startMs: this.startMs ?? 0,
      endMs,
    }
  }

  private flush(): SttResult | null {
    const result = this.committed ? this.result(this.committed, true, this.endMs) : null
    this.committed = ''
    this.startMs = null
    this.speaker = undefined
    this.language = undefined
    return result
  }
}

/**
 * Nova-3 `multi` code-switches across a fixed set of languages that does not
 * include Chinese, so a meeting that mixes zh and en should use Soniox. When a
 * single language is configured we pin it; otherwise we ask for `multi`.
 */
export function deepgramLanguage(languages: LanguageCode[]): string {
  const concrete = languages.filter((l) => l !== 'auto')
  if (concrete.length !== 1) return 'multi'
  return concrete[0] === 'zh' ? 'zh-CN' : concrete[0]
}

export class DeepgramProvider implements SttProvider {
  readonly name = 'deepgram'

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  open(options: SttStreamOptions): SttStream {
    const params = new URLSearchParams({
      model: this.model,
      language: deepgramLanguage(options.languages),
      encoding: 'linear16',
      sample_rate: String(AUDIO_SAMPLE_RATE),
      channels: '1',
      interim_results: 'true',
      smart_format: 'true',
      punctuate: 'true',
      endpointing: '400',
      utterance_end_ms: '1200',
      vad_events: 'true',
      diarize: String(options.diarize),
    })
    const socket = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, {
      headers: { Authorization: `Token ${this.apiKey}` },
    })
    const accumulator = new DeepgramAccumulator()
    const queue: Uint8Array[] = []
    let lastAudioAt = Date.now()

    const keepAlive = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN && Date.now() - lastAudioAt > 3_000) {
        socket.send(JSON.stringify({ type: 'KeepAlive' }))
      }
    }, 3_000)

    socket.on('open', () => {
      for (const chunk of queue.splice(0)) socket.send(chunk)
    })
    socket.on('message', (data, isBinary) => {
      if (isBinary) return
      try {
        for (const result of accumulator.handle(JSON.parse(data.toString()) as DeepgramMessage)) options.onResult(result)
      } catch {
        // ignore malformed provider frames
      }
    })
    socket.on('unexpected-response', (_req, res) => {
      options.onError(new Error(`Deepgram rejected the connection (HTTP ${res.statusCode})`))
    })
    socket.on('error', (error) => options.onError(error))
    socket.on('close', () => clearInterval(keepAlive))

    return {
      write(pcm) {
        lastAudioAt = Date.now()
        if (socket.readyState === WebSocket.OPEN) socket.send(pcm)
        else if (socket.readyState === WebSocket.CONNECTING && queue.length < 100) queue.push(pcm)
      },
      async close() {
        clearInterval(keepAlive)
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'CloseStream' }))
          await waitForClose(socket, 3_000)
        } else {
          socket.terminate()
        }
      },
    }
  }
}
