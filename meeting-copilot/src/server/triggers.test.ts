import { describe, expect, it } from 'vitest'
import type { TranscriptSegment } from '../shared/protocol.ts'
import { classifySegment, TriggerDetector } from './triggers.ts'

const seg = (text: string, source: 'me' | 'remote' = 'remote', isFinal = true): TranscriptSegment => ({
  id: text,
  source,
  text,
  isFinal,
  startMs: 0,
  endMs: 1000,
})

describe('classifySegment', () => {
  it.each([
    ['你们的价格是多少？', 'question'],
    ['这个能不能下周上线', 'question'],
    ['数据是存在新加坡的吗', 'question'],
    ['How do you handle data residency', 'question'],
    ['Could you walk me through the onboarding.', 'question'],
    ['说实话这个报价有点太贵了', 'objection'],
    ["Honestly, I'm worried about the integration timeline.", 'objection'],
    ['We are comparing you with a competitor right now.', 'objection'],
  ])('%s -> %s', (text, kind) => {
    expect(classifySegment(text)).toBe(kind)
  })

  it.each(['好的，谢谢', 'Sounds good.', 'OK', '我们今天主要过一下进度。'])('ignores statements: %s', (text) => {
    expect(classifySegment(text)).toBeNull()
  })
})

describe('TriggerDetector', () => {
  it('only fires for final remote segments', () => {
    const detector = new TriggerDetector(0)
    expect(detector.evaluate(seg('价格是多少？', 'me'))).toBeNull()
    expect(detector.evaluate(seg('价格是多少？', 'remote', false))).toBeNull()
    expect(detector.evaluate(seg('价格是多少？'))?.kind).toBe('question')
  })

  it('applies a cooldown to questions but not objections', () => {
    let now = 0
    const detector = new TriggerDetector(6_000, () => now)
    expect(detector.evaluate(seg('What is the price?'))).not.toBeNull()
    now = 2_000
    expect(detector.evaluate(seg('And the timeline?'))).toBeNull()
    expect(detector.evaluate(seg('That is too expensive for us.'))?.kind).toBe('objection')
    now = 9_000
    expect(detector.evaluate(seg('What about support?'))).not.toBeNull()
  })
})
