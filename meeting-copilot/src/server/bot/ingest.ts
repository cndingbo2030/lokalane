import { floatTo16BitPcm, PcmFramer, StreamingResampler } from '../../shared/pcm.ts'
import { AUDIO_FRAME_MS, AUDIO_SAMPLE_RATE } from '../../shared/protocol.ts'
import { VoiceGate } from '../../shared/vad.ts'

const FRAME_SAMPLES = (AUDIO_SAMPLE_RATE * AUDIO_FRAME_MS) / 1000
/** A jump in the bot's timestamps bigger than this is a real gap (e.g. its socket reconnected). */
const GAP_MS = 250

interface MixedAudioMessage {
  trigger: 'realtime_audio.mixed'
  data: { chunk: string; sample_rate: number; timestamp_ms: number }
}

function isMixedAudio(value: unknown): value is MixedAudioMessage {
  const message = value as Partial<MixedAudioMessage> | null
  return (
    message?.trigger === 'realtime_audio.mixed' &&
    typeof message.data?.chunk === 'string' &&
    [8_000, 16_000, 24_000].includes(message.data.sample_rate) &&
    Number.isFinite(message.data.timestamp_ms)
  )
}

/**
 * Turns the bot's mixed-audio messages (base64 PCM16 chunks of any size) into
 * the 100 ms, 16 kHz frames the STT pipeline expects, each stamped with its
 * meeting time.
 *
 * Time comes from the sample count, so it stays exact under network jitter;
 * the bot's own timestamps are used only to notice real gaps (audio lost while
 * its socket reconnected), so later speech is still placed at the right time.
 * Silence is gated out like on the client, to save STT cost on long pauses.
 */
export class BotAudioIngest {
  private anchor: { ts: number; meetingMs: number } | null = null
  /** Meeting time just after the last sample received. */
  private cursorMs = 0
  private framer = new PcmFramer(FRAME_SAMPLES)
  private framerStartMs = 0
  private framed = 0
  private resampler: StreamingResampler | null = null
  private readonly gate: VoiceGate | null
  private readonly frameTimes = new Map<Int16Array, number>()

  constructor(
    private readonly options: {
      onFrame: (pcm: Int16Array, captureMs: number) => void
      /** Milliseconds since the meeting session started. */
      meetingNowMs: () => number
      vad?: boolean
    },
  ) {
    this.gate = options.vad === false ? null : new VoiceGate()
  }

  /** Returns false for messages that are not mixed audio (ignored). */
  push(message: unknown): boolean {
    if (!isMixedAudio(message)) return false
    const { chunk, sample_rate: rate, timestamp_ms: ts } = message.data
    let pcm = decodePcm16(chunk)
    if (pcm.length === 0) return true
    if (rate !== AUDIO_SAMPLE_RATE) {
      if (this.resampler?.inputRate !== rate) this.resampler = new StreamingResampler(rate, AUDIO_SAMPLE_RATE)
      pcm = floatTo16BitPcm(this.resampler.process(Float32Array.from(pcm, (s) => s / 0x8000)))
    }
    const durationMs = (pcm.length / AUDIO_SAMPLE_RATE) * 1000

    // The bot stamps each chunk when it sends it, i.e. about when the chunk ends.
    const first = !this.anchor
    this.anchor ??= { ts, meetingMs: this.options.meetingNowMs() }
    const byTimestamp = this.anchor.meetingMs + (ts - this.anchor.ts) - durationMs
    if (first) this.restart(Math.max(0, byTimestamp))
    else if (byTimestamp - this.cursorMs > GAP_MS) this.restart(byTimestamp)
    this.cursorMs += durationMs

    for (const frame of this.framer.push(pcm)) {
      this.frameTimes.set(frame, Math.round(this.framerStartMs + this.framed++ * AUDIO_FRAME_MS))
      for (const out of this.gate ? this.gate.push(frame) : [frame]) {
        this.options.onFrame(out, this.frameTimes.get(out) ?? 0)
        this.frameTimes.delete(out)
      }
      // Frames the gate dropped (or still holds as pre-roll) are forgotten after a while.
      if (this.frameTimes.size > 8) this.frameTimes.delete(this.frameTimes.keys().next().value!)
    }
    return true
  }

  /** Start a new continuous run at `meetingMs`; a partial frame from before the gap is dropped. */
  private restart(meetingMs: number): void {
    this.framer = new PcmFramer(FRAME_SAMPLES)
    this.framerStartMs = meetingMs
    this.framed = 0
    this.cursorMs = meetingMs
  }
}

/** Base64 little-endian PCM16 → samples (copied, so alignment never matters). */
export function decodePcm16(base64: string): Int16Array {
  const bytes = Buffer.from(base64, 'base64')
  const samples = new Int16Array(bytes.length >> 1)
  for (let i = 0; i < samples.length; i++) samples[i] = bytes.readInt16LE(i * 2)
  return samples
}
