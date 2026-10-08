import { describe, expect, it } from 'vitest'
import { BotAudioIngest, decodePcm16 } from './ingest.ts'

/** A mixed-audio message as the bot service sends it. */
function message(samples: Int16Array, timestampMs: number, sampleRate = 16_000) {
  return {
    bot_id: 'bot_1',
    trigger: 'realtime_audio.mixed',
    data: { chunk: Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength).toString('base64'), sample_rate: sampleRate, timestamp_ms: timestampMs },
  }
}

const tone = (n: number, amplitude = 8_000) => Int16Array.from({ length: n }, (_, i) => Math.round(amplitude * Math.sin(i / 3)))

function setup(meetingNow: number, vad = false) {
  const frames: Array<{ length: number; captureMs: number; first: number }> = []
  let now = meetingNow
  const ingest = new BotAudioIngest({ vad, meetingNowMs: () => now, onFrame: (pcm, captureMs) => frames.push({ length: pcm.length, captureMs, first: pcm[0] }) })
  return { ingest, frames, setNow: (ms: number) => (now = ms) }
}

describe('BotAudioIngest', () => {
  it('re-frames 20 ms chunks into 100 ms frames timed from the sample count', () => {
    const { ingest, frames } = setup(5_000)
    const t0 = 1_700_000_000_000
    // 25 chunks × 20 ms = 500 ms; timestamps jitter but the audio is continuous.
    for (let i = 0; i < 25; i++) ingest.push(message(tone(320), t0 + i * 20 + (i % 3) * 7))
    expect(frames.map((f) => f.length)).toEqual([1600, 1600, 1600, 1600, 1600])
    // The first chunk ends at meeting time 5000, so audio starts at 4980.
    expect(frames.map((f) => f.captureMs)).toEqual([4980, 5080, 5180, 5280, 5380])
  })

  it('jumps ahead after a real gap and drops the partial frame from before it', () => {
    const { ingest, frames } = setup(1_000)
    const t0 = 1_700_000_000_000
    for (let i = 0; i < 7; i++) ingest.push(message(tone(320), t0 + i * 20)) // 140 ms: one frame + 40 ms pending
    ingest.push(message(tone(1600), t0 + 5_000)) // sent 5 s after the first chunk (socket reconnected)
    // First chunk ended at meeting time 1000; this 100 ms chunk ended 5 s later.
    expect(frames.map((f) => f.captureMs)).toEqual([980, 1_000 + 5_000 - 100])
  })

  it('resamples other rates to 16 kHz', () => {
    const { ingest, frames } = setup(0)
    ingest.push(message(tone(800), 1_000, 8_000)) // 100 ms at 8 kHz
    ingest.push(message(tone(800), 1_100, 8_000))
    expect(frames.length).toBeGreaterThanOrEqual(1)
    expect(frames[0]).toMatchObject({ length: 1600, captureMs: 0 })
  })

  it('gates silence out like the client does', () => {
    const { ingest, frames } = setup(0, true)
    for (let i = 0; i < 30; i++) ingest.push(message(new Int16Array(1600), 1_000 + i * 100)) // 3 s of silence
    expect(frames).toHaveLength(0)
    for (let i = 30; i < 35; i++) ingest.push(message(tone(1600), 1_000 + i * 100))
    expect(frames.length).toBeGreaterThanOrEqual(5)
    // Pre-roll frames keep their own (earlier) times.
    expect(frames[0].captureMs).toBeLessThan(frames.at(-1)!.captureMs)
  })

  it('ignores other messages', () => {
    const { ingest, frames } = setup(0)
    expect(ingest.push({ trigger: 'realtime_audio.per_participant', data: {} })).toBe(false)
    expect(ingest.push({ trigger: 'realtime_audio.mixed', data: { chunk: 'AAAA', sample_rate: 44_100, timestamp_ms: 1 } })).toBe(false)
    expect(ingest.push(null)).toBe(false)
    expect(frames).toHaveLength(0)
  })
})

describe('decodePcm16', () => {
  it('reads little-endian samples and ignores a trailing odd byte', () => {
    expect(Array.from(decodePcm16(Buffer.from([0x01, 0x00, 0xff, 0xff, 0x7f]).toString('base64')))).toEqual([1, -1])
  })
})
