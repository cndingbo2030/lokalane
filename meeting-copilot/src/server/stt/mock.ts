import { AUDIO_SAMPLE_RATE } from '../../shared/protocol.ts'
import type { SttProvider, SttStream, SttStreamOptions } from './types.ts'

const SPEECH_RMS = 0.02
const SILENCE_TO_CLOSE_MS = 700

/**
 * Used when no STT key is configured. It cannot recognize words, but it runs a
 * simple energy VAD so you can verify that capture, framing and the transport
 * work end to end: each detected stretch of speech becomes a placeholder segment.
 */
export class MockSttProvider implements SttProvider {
  readonly name = 'mock'

  open(options: SttStreamOptions): SttStream {
    let elapsedMs = 0
    let speechStart: number | null = null
    let lastSpeech = 0

    return {
      write(pcm) {
        const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2))
        const frameMs = (samples.length / AUDIO_SAMPLE_RATE) * 1000
        let sum = 0
        for (let i = 0; i < samples.length; i++) sum += (samples[i] / 0x8000) ** 2
        const level = Math.sqrt(sum / Math.max(1, samples.length))
        elapsedMs += frameMs

        if (level >= SPEECH_RMS) {
          speechStart ??= elapsedMs - frameMs
          lastSpeech = elapsedMs
          const seconds = ((elapsedMs - speechStart) / 1000).toFixed(1)
          options.onResult({ text: `🎙 检测到语音 ${seconds}s…`, isFinal: false, startMs: speechStart, endMs: elapsedMs })
        } else if (speechStart !== null && elapsedMs - lastSpeech >= SILENCE_TO_CLOSE_MS) {
          const seconds = ((lastSpeech - speechStart) / 1000).toFixed(1)
          options.onResult({
            text: `🎙 语音 ${seconds}s（未配置 STT 密钥，仅检测到声音）`,
            isFinal: true,
            startMs: speechStart,
            endMs: lastSpeech,
          })
          speechStart = null
        }
      },
      async close() {},
    }
  }
}
