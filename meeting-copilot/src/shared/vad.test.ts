import { describe, expect, it } from 'vitest'
import { AudioClock, VoiceGate } from './vad.ts'

const frame = (amplitude: number, id = amplitude) => {
  const f = new Int16Array(1600).fill(amplitude)
  f[0] = id // tag frames so tests can tell them apart
  return f
}

describe('VoiceGate', () => {
  it('drops silence, sends pre-roll on onset and hangover after speech', () => {
    const gate = new VoiceGate({ preRollFrames: 2, hangoverFrames: 2 })
    expect(gate.push(frame(0, 1))).toEqual([])
    expect(gate.push(frame(0, 2))).toEqual([])
    expect(gate.push(frame(0, 3))).toEqual([])
    const onset = gate.push(frame(6000, 4))
    expect(onset.map((f) => f[0])).toEqual([2, 3, 4]) // 2 pre-roll + speech
    expect(gate.push(frame(6000, 5))).toHaveLength(1)
    expect(gate.push(frame(0, 6))).toHaveLength(1) // hangover 1
    expect(gate.push(frame(0, 7))).toHaveLength(1) // hangover 2
    expect(gate.push(frame(0, 8))).toEqual([])
  })

  it('keeps sending 2.5 s after speech by default, longer than Soniox’s 2 s endpoint delay', () => {
    const gate = new VoiceGate()
    expect(gate.push(frame(6000))).toHaveLength(1)
    let sent = 0
    for (let i = 0; i < 40; i++) sent += gate.push(frame(0)).length
    expect(sent).toBe(25) // 25 × 100 ms frames
  })

  it('does not cut off a long monologue', () => {
    const gate = new VoiceGate()
    let sent = 0
    // 30 s of speech: syllables are loud, with a quieter frame every ~half second.
    for (let i = 0; i < 300; i++) sent += gate.push(frame(i % 5 === 4 ? 200 : 5000)).length
    expect(sent).toBe(300)
  })

  it('adapts to a steady noise floor', () => {
    const gate = new VoiceGate({ hangoverFrames: 0 })
    // A constant hum just above the absolute floor stops counting as speech once learned.
    const hum = () => frame(400, 400)
    let sent = 0
    for (let i = 0; i < 200; i++) sent += gate.push(hum()).length
    const late = gate.push(hum()).length
    expect(late).toBe(0)
    expect(sent).toBeLessThan(200)
    expect(gate.push(frame(8000)).length).toBeGreaterThan(0)
  })
})

describe('AudioClock', () => {
  it('is the identity for continuous audio', () => {
    const clock = new AudioClock()
    for (let i = 0; i < 10; i++) clock.record(i * 100 + (i % 2) * 30, 100) // jittery arrival
    expect(clock.toWall(0)).toBe(0)
    expect(clock.toWall(750)).toBe(750)
    expect(clock.sentSeconds).toBe(1)
  })

  it('maps provider time across gaps in gated audio', () => {
    const clock = new AudioClock()
    clock.record(1_000, 100)
    clock.record(1_100, 100) // speech 1: wall 1000–1200, provider 0–200
    clock.record(10_000, 100) // speech 2 resumes after a long silence: provider 200–300
    expect(clock.toWall(50)).toBe(1_050)
    expect(clock.toWall(199)).toBe(1_199)
    expect(clock.toWall(250)).toBe(10_050)
  })
})
