import { describe, expect, it } from 'vitest'
import { floatTo16BitPcm, PcmFramer, rms16, StreamingResampler } from './pcm.ts'

describe('StreamingResampler', () => {
  it('downsamples 48k to 16k with the right length across chunk boundaries', () => {
    const resampler = new StreamingResampler(48_000, 16_000)
    let total = 0
    // 1 second of audio delivered in 128-sample render quanta (what AudioWorklet gives us).
    for (let i = 0; i < 375; i++) total += resampler.process(new Float32Array(128).fill(0.5)).length
    expect(total).toBe(16_000)
  })

  it('handles non-integer ratios (44.1k) without drifting', () => {
    const resampler = new StreamingResampler(44_100, 16_000)
    let total = 0
    for (let i = 0; i < 441; i++) total += resampler.process(new Float32Array(100)).length
    expect(Math.abs(total - 16_000)).toBeLessThanOrEqual(1)
  })

  it('preserves DC level when averaging', () => {
    const out = new StreamingResampler(48_000, 16_000).process(new Float32Array(480).fill(0.25))
    expect(out.every((v) => Math.abs(v - 0.25) < 1e-6)).toBe(true)
  })

  it('passes audio through unchanged at equal rates', () => {
    const input = Float32Array.from([0.1, -0.2, 0.3])
    expect(Array.from(new StreamingResampler(16_000, 16_000).process(input))).toEqual(Array.from(input))
  })

  it('upsamples with linear interpolation', () => {
    const out = new StreamingResampler(8_000, 16_000).process(Float32Array.from([0, 1, 0]))
    expect(Array.from(out)).toEqual([0, 0.5, 1, 0.5])
  })
})

describe('floatTo16BitPcm', () => {
  it('clamps and scales', () => {
    expect(Array.from(floatTo16BitPcm(Float32Array.from([-2, -1, 0, 1, 2])))).toEqual([-32768, -32768, 0, 32767, 32767])
  })
})

describe('PcmFramer', () => {
  it('emits fixed frames and keeps the remainder', () => {
    const framer = new PcmFramer(4)
    expect(framer.push(Int16Array.from([1, 2, 3]))).toHaveLength(0)
    const frames = framer.push(Int16Array.from([4, 5, 6, 7, 8, 9]))
    expect(frames.map((f) => Array.from(f))).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
    ])
  })
})

describe('rms16', () => {
  it('is 0 for silence and ~1 for full scale', () => {
    expect(rms16(new Int16Array(10))).toBe(0)
    expect(rms16(new Int16Array(10).fill(-32768))).toBeCloseTo(1)
  })
})
