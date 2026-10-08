import { describe, expect, it } from 'vitest'
import { conversationInsights, conversationStats, formatMinutes } from './analytics.ts'
import type { TranscriptSegment } from './protocol.ts'

let n = 0
const seg = (source: 'me' | 'remote', startS: number, endS: number, text: string, speaker?: string): TranscriptSegment => ({
  id: `s${n++}`,
  source,
  speaker,
  text,
  isFinal: true,
  startMs: startS * 1000,
  endMs: endS * 1000,
})

describe('conversationStats', () => {
  it('splits talk time by speaker, merges turns and counts questions', () => {
    const stats = conversationStats(
      [
        seg('remote', 0, 10, 'Hi, thanks for joining. What does the enterprise plan include?', 'S1'),
        seg('me', 11, 41, '企业版包含五个席位、数据驻留新加坡和专属客户经理。'),
        seg('me', 42, 50, '你们现在每个月审核多少份合同？'), // < 2 s after the previous line: same turn
        seg('remote', 51, 61, 'About two hundred.', 'S1'),
        { ...seg('remote', 61, 62, 'partial'), isFinal: false },
      ],
      { S1: 'Alice' },
    )
    expect(stats.talkMs).toBe(58_000)
    expect(stats.spanMs).toBe(61_000)
    expect(stats.speakers.map((s) => [s.label, s.talkMs, s.turns, s.questions])).toEqual([
      ['我', 38_000, 1, 1],
      ['Alice', 20_000, 2, 1],
    ])
    expect(stats.myShare).toBeCloseTo(38 / 58)
    expect(stats.longestTurn).toEqual({ label: '我', ms: 39_000, startMs: 11_000 })
    expect(stats.speakers[0].pace?.unit).toBe('cpm')
    expect(stats.speakers[1].pace).toBeDefined()
    expect(stats.speakers[1].pace?.unit).toBe('wpm')
  })

  it('counts the speaker marked as the user as 我 and reports no share when the user is unknown', () => {
    const segments = [seg('remote', 0, 30, 'Let me explain our pricing.', 'S2'), seg('remote', 31, 40, 'Sounds good.', 'S1')]
    expect(conversationStats(segments).myShare).toBeNull()
    const marked = conversationStats(segments, {}, 'S2')
    expect(marked.speakers[0]).toMatchObject({ key: 'me', label: '我', isMe: true })
    expect(marked.myShare).toBeCloseTo(30 / 39)
  })

  it('handles an empty transcript', () => {
    expect(conversationStats([])).toEqual({ spanMs: 0, talkMs: 0, speakers: [], myShare: null, longestTurn: undefined })
  })
})

describe('conversationInsights', () => {
  it('notes a high talk share, a long monologue and no questions from the user', () => {
    const stats = conversationStats([
      seg('me', 0, 150, '我们的方案非常适合你们的团队。'),
      seg('remote', 152, 190, '你们支持私有化部署吗？', 'S1'),
      seg('me', 192, 240, '支持。'),
    ])
    const insights = conversationInsights(stats)
    expect(insights).toHaveLength(3)
    expect(insights[0]).toContain('你的发言占全部发言的')
    expect(insights[1]).toContain('2 分 30 秒')
    expect(insights[2]).toContain('你没有提问')
  })

  it('stays quiet for short meetings', () => {
    expect(conversationInsights(conversationStats([seg('me', 0, 60, '你好')]))).toEqual([])
  })

  it('formats durations', () => {
    expect(formatMinutes(45_000)).toBe('45 秒')
    expect(formatMinutes(150_000)).toBe('2 分 30 秒')
  })
})
