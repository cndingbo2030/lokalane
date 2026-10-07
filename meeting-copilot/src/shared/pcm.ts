/**
 * Streaming PCM helpers used by the browser capture pipeline. Kept free of DOM
 * APIs so they are unit-testable in Node.
 */

/**
 * Converts a stream of Float32 chunks at `inputRate` to `outputRate`.
 * Downsampling uses a box (averaging) filter, which is a cheap anti-alias filter
 * that is good enough for speech recognition; upsampling uses linear interpolation.
 */
export class StreamingResampler {
  private readonly ratio: number
  private pending: Float32Array = new Float32Array(0)
  /** Fractional read position into `pending` for the next output sample. */
  private position = 0

  constructor(
    readonly inputRate: number,
    readonly outputRate: number,
  ) {
    if (inputRate <= 0 || outputRate <= 0) throw new Error('Sample rates must be positive')
    this.ratio = inputRate / outputRate
  }

  process(input: Float32Array): Float32Array {
    if (this.ratio === 1) return input.slice()

    const buffer = new Float32Array(this.pending.length + input.length)
    buffer.set(this.pending, 0)
    buffer.set(input, this.pending.length)

    const output: number[] = []
    let pos = this.position

    if (this.ratio > 1) {
      while (pos + this.ratio <= buffer.length) {
        const start = Math.floor(pos)
        const end = Math.floor(pos + this.ratio)
        let sum = 0
        for (let i = start; i < end; i++) sum += buffer[i]
        output.push(sum / Math.max(1, end - start))
        pos += this.ratio
      }
    } else {
      while (pos + 1 < buffer.length) {
        const index = Math.floor(pos)
        const frac = pos - index
        output.push(buffer[index] * (1 - frac) + buffer[index + 1] * frac)
        pos += this.ratio
      }
    }

    const consumed = Math.floor(pos)
    this.pending = buffer.slice(consumed)
    this.position = pos - consumed
    return Float32Array.from(output)
  }
}

export function floatTo16BitPcm(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

/** Accumulates samples and emits fixed-size frames. */
export class PcmFramer {
  private buffer: Int16Array
  private filled = 0

  constructor(readonly frameSamples: number) {
    this.buffer = new Int16Array(frameSamples)
  }

  push(samples: Int16Array): Int16Array[] {
    const frames: Int16Array[] = []
    let offset = 0
    while (offset < samples.length) {
      const take = Math.min(this.frameSamples - this.filled, samples.length - offset)
      this.buffer.set(samples.subarray(offset, offset + take), this.filled)
      this.filled += take
      offset += take
      if (this.filled === this.frameSamples) {
        frames.push(this.buffer)
        this.buffer = new Int16Array(this.frameSamples)
        this.filled = 0
      }
    }
    return frames
  }
}

/** Root-mean-square level of 16-bit PCM, normalized to 0..1. */
export function rms16(samples: Int16Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] / 0x8000
    sum += v * v
  }
  return Math.sqrt(sum / samples.length)
}
