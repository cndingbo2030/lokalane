import { rms16 } from './pcm.ts'

export interface VoiceGateOptions {
  /** Frames kept before speech onset so the first syllable is not clipped. */
  preRollFrames?: number
  /** Frames still sent after speech stops, so the STT engine can detect the endpoint. */
  hangoverFrames?: number
  /** Absolute floor for the speech threshold (RMS, 0..1). */
  minThreshold?: number
  /** Speech when level > noise floor × this ratio. */
  noiseRatio?: number
}

/**
 * Client-side voice activity gate: forwards only speech (plus pre-roll and
 * hangover) to the server. Long silences — a muted microphone, the other side
 * listening — are not streamed, which cuts per-minute STT cost substantially.
 *
 * The threshold adapts to the room: an EMA tracks the noise floor, so a noisy
 * fan does not count as talking. Being energy-only, it treats any perfectly
 * stationary sound as noise after a while; real speech always has quieter
 * gaps between syllables that pull the floor back down. A neural VAD (e.g.
 * Silero in WASM) is the upgrade path if noisy rooms prove a problem.
 */
export class VoiceGate {
  private readonly preRoll: Int16Array[] = []
  private hangover = 0
  private noiseFloor = 0.003
  private readonly options: Required<VoiceGateOptions>

  constructor(options: VoiceGateOptions = {}) {
    this.options = {
      preRollFrames: options.preRollFrames ?? 3,
      hangoverFrames: options.hangoverFrames ?? 15,
      minThreshold: options.minThreshold ?? 0.008,
      noiseRatio: options.noiseRatio ?? 3,
    }
  }

  /** Returns the frames to send now (possibly none, possibly pre-roll + this frame). */
  push(frame: Int16Array): Int16Array[] {
    const level = rms16(frame)
    const threshold = Math.max(this.options.minThreshold, this.noiseFloor * this.options.noiseRatio)
    const speech = level > threshold

    // Track the noise floor: fall fast, rise slowly — very slowly while "speaking", so
    // a long monologue is not mistaken for noise, but a constant hum is learned in seconds.
    const rise = speech ? 0.002 : 0.02
    this.noiseFloor = level < this.noiseFloor ? (level + this.noiseFloor) / 2 : this.noiseFloor + (level - this.noiseFloor) * rise

    if (speech) {
      const out = this.hangover > 0 ? [frame] : [...this.preRoll, frame]
      this.preRoll.length = 0
      this.hangover = this.options.hangoverFrames
      return out
    }

    if (this.hangover > 0) {
      this.hangover--
      return [frame]
    }
    this.preRoll.push(frame)
    if (this.preRoll.length > this.options.preRollFrames) this.preRoll.shift()
    return []
  }

  get active(): boolean {
    return this.hangover > 0
  }
}

/**
 * Maps STT provider timestamps (which count only the audio actually sent) back
 * to meeting wall-clock time. A breakpoint is recorded whenever audio resumes
 * after a gap, so a few entries describe an hour of gated audio.
 */
export class AudioClock {
  private readonly breakpoints: Array<{ providerMs: number; wallMs: number }> = []
  private sentMs = 0
  private lastWallEnd = Number.NEGATIVE_INFINITY

  constructor(private readonly gapToleranceMs = 400) {}

  /** Record `durationMs` of audio received at `wallMs` (ms since session start). */
  record(wallMs: number, durationMs: number): void {
    // Frames arrive in bursts (network jitter); only a real pause creates a breakpoint.
    if (this.breakpoints.length === 0 || wallMs - this.lastWallEnd > this.gapToleranceMs) {
      this.breakpoints.push({ providerMs: this.sentMs, wallMs })
      this.lastWallEnd = wallMs + durationMs
    } else {
      this.lastWallEnd += durationMs
    }
    this.sentMs += durationMs
  }

  get sentSeconds(): number {
    return this.sentMs / 1000
  }

  toWall(providerMs: number): number {
    if (this.breakpoints.length === 0) return providerMs
    let lo = 0
    let hi = this.breakpoints.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.breakpoints[mid].providerMs <= providerMs) lo = mid
      else hi = mid - 1
    }
    const bp = this.breakpoints[lo]
    return Math.round(bp.wallMs + (providerMs - bp.providerMs))
  }
}
