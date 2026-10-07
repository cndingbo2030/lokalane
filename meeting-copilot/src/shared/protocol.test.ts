import { describe, expect, it } from 'vitest'
import { decodeAudioFrame, encodeAudioFrame } from './protocol.ts'

describe('audio frames', () => {
  it('round-trips source and samples into an Int16-aligned buffer', () => {
    const samples = Int16Array.from([1, -2, 32767, -32768])
    const decoded = decodeAudioFrame(new Uint8Array(encodeAudioFrame('remote', samples, 123_456)))
    expect(decoded?.source).toBe('remote')
    expect(decoded?.captureMs).toBe(123_456)
    expect(decoded!.pcm.byteOffset % 2).toBe(0)
    expect(Array.from(new Int16Array(decoded!.pcm.buffer, decoded!.pcm.byteOffset, decoded!.pcm.byteLength / 2))).toEqual(Array.from(samples))
  })

  it('rejects unknown sources and malformed lengths', () => {
    expect(decodeAudioFrame(Uint8Array.from([7, 0, 0, 0, 0, 0, 0]))).toBeNull()
    expect(decodeAudioFrame(Uint8Array.from([0, 1]))).toBeNull()
    expect(decodeAudioFrame(Uint8Array.from([0, 0, 0, 0, 0, 1, 2, 3]))).toBeNull()
  })
})
