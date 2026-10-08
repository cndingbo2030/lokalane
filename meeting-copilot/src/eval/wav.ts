import { AUDIO_SAMPLE_RATE } from '../shared/protocol.ts'
import { floatTo16BitPcm, StreamingResampler } from '../shared/pcm.ts'

export interface DecodedWav {
  sampleRate: number
  channels: number
  /** Mono samples in -1..1. */
  samples: Float32Array
}

/** Decodes 16-bit PCM or 32-bit float WAV files (the formats recorders and ffmpeg emit). */
export function decodeWav(bytes: Uint8Array): DecodedWav {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4))
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file')

  let format = 0
  let channels = 0
  let sampleRate = 0
  let bitsPerSample = 0
  let offset = 12
  while (offset + 8 <= bytes.byteLength) {
    const id = tag(offset)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (id === 'fmt ') {
      format = view.getUint16(body, true)
      channels = view.getUint16(body + 2, true)
      sampleRate = view.getUint32(body + 4, true)
      bitsPerSample = view.getUint16(body + 14, true)
      if (format === 0xfffe) format = view.getUint16(body + 24, true) // WAVE_FORMAT_EXTENSIBLE sub-format
    } else if (id === 'data') {
      const pcm = format === 1 && bitsPerSample === 16
      const float = format === 3 && bitsPerSample === 32
      if (!pcm && !float) throw new Error(`Unsupported WAV encoding (format ${format}, ${bitsPerSample}-bit); convert with: ffmpeg -i in -ar 16000 -ac 1 -c:a pcm_s16le out.wav`)
      const bytesPerSample = bitsPerSample / 8
      const frames = Math.floor(Math.min(size, bytes.byteLength - body) / (bytesPerSample * channels))
      const samples = new Float32Array(frames)
      for (let i = 0; i < frames; i++) {
        let sum = 0
        for (let c = 0; c < channels; c++) {
          const at = body + (i * channels + c) * bytesPerSample
          sum += pcm ? view.getInt16(at, true) / 0x8000 : view.getFloat32(at, true)
        }
        samples[i] = sum / channels
      }
      return { sampleRate, channels, samples }
    }
    offset = body + size + (size % 2)
  }
  throw new Error('WAV file has no data chunk')
}

/** Converts a decoded WAV to the wire format: 16 kHz mono s16le, in 100 ms frames. */
export function toPcmFrames(wav: DecodedWav, frameMs = 100): Uint8Array[] {
  const resampled = new StreamingResampler(wav.sampleRate, AUDIO_SAMPLE_RATE).process(wav.samples)
  const pcm = floatTo16BitPcm(resampled)
  const frameSamples = (AUDIO_SAMPLE_RATE * frameMs) / 1000
  const frames: Uint8Array[] = []
  for (let i = 0; i < pcm.length; i += frameSamples) {
    const chunk = pcm.slice(i, i + frameSamples)
    frames.push(new Uint8Array(chunk.buffer))
  }
  return frames
}

/** Builds a 16-bit PCM WAV (used by tests and fixtures). */
export function encodeWav(samples: Int16Array, sampleRate: number, channels = 1): Uint8Array {
  const out = new Uint8Array(44 + samples.byteLength)
  const view = new DataView(out.buffer)
  const write = (offset: number, text: string) => [...text].forEach((ch, i) => (out[offset + i] = ch.charCodeAt(0)))
  write(0, 'RIFF')
  view.setUint32(4, 36 + samples.byteLength, true)
  write(8, 'WAVE')
  write(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * channels * 2, true)
  view.setUint16(32, channels * 2, true)
  view.setUint16(34, 16, true)
  write(36, 'data')
  view.setUint32(40, samples.byteLength, true)
  out.set(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength), 44)
  return out
}
