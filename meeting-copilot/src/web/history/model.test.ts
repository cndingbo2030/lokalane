import { describe, expect, it } from 'vitest'
import type { TranscriptSegment } from '../../shared/protocol.ts'
import { initialState, type AppState } from '../state/reducer.ts'
import { buildRecord, searchMeetings, titleFromSummary, type MeetingRecord } from './model.ts'

const seg = (id: string, text: string, isFinal = true): TranscriptSegment => ({ id, source: 'remote', text, isFinal, startMs: 0, endMs: 1 })

const meta = { id: 'm1', platform: 'zoom' as const, startedAt: new Date(2026, 9, 7, 9, 30).getTime(), endedAt: 0, targetLanguage: 'zh' as const }

describe('buildRecord', () => {
  it('keeps finals, their translations and finished suggestions', () => {
    const state: AppState = {
      ...initialState,
      segments: [seg('a', 'Hello'), seg('b', 'partial', false)],
      translations: { a: '你好', b: '部分' },
      suggestions: [
        { id: 's1', trigger: { kind: 'question', text: 'q' }, text: 'answer', done: true, rating: 'up' },
        { id: 's2', trigger: { kind: 'question', text: 'q' }, text: '', done: false },
      ],
      speakerNames: { S1: '王总' },
    }
    const record = buildRecord(state, meta)
    expect(record.segments.map((s) => s.id)).toEqual(['a'])
    expect(record.translations).toEqual({ a: '你好' })
    expect(record.suggestions.map((s) => s.id)).toEqual(['s1'])
    expect(record.title).toBe('Zoom 会议 · 2026-10-07 09:30')
    expect(record.summary).toBe('')
  })

  it('titles the meeting from the summary TL;DR', () => {
    const summary = '## 一句话总结 / TL;DR\n- **双方同意下周启动新加坡试点**\n\n## 关键讨论点\n- x'
    expect(titleFromSummary(summary)).toBe('双方同意下周启动新加坡试点')
    expect(titleFromSummary('no headings here')).toBeUndefined()
    const record = buildRecord({ ...initialState, summary: { status: 'done', text: summary } }, meta)
    expect(record.title).toBe('双方同意下周启动新加坡试点')
    expect(record.summary).toBe(summary)
    expect(buildRecord(initialState, meta, { demo: true }).title).toBe('演示会议 · 2026-10-07 09:30')
    expect(buildRecord({ ...initialState, summary: { status: 'done', text: summary } }, meta, { demo: true }).title).toBe('演示 · 双方同意下周启动新加坡试点')
  })

  it('stores finished outcomes with their done state and the attendee emails', () => {
    const outcomes = { decisions: ['d'], actionItems: [{ id: 'a1', owner: '我', task: 't', due: null, done: true }], followUpEmail: { subject: 's', body: 'b' } }
    const record = buildRecord({ ...initialState, outcomes: { status: 'done', data: outcomes } }, { ...meta, attendeeEmails: ['a@example.com'] })
    expect(record.outcomes).toEqual(outcomes)
    expect(record.attendeeEmails).toEqual(['a@example.com'])
    expect(buildRecord({ ...initialState, outcomes: { status: 'loading' } }, meta).outcomes).toBeUndefined()
  })
})

describe('searchMeetings', () => {
  const record = (id: string, startedAt: number, extra: Partial<MeetingRecord>): MeetingRecord => ({
    id,
    title: `会议 ${id}`,
    platform: 'zoom',
    startedAt,
    endedAt: startedAt,
    targetLanguage: 'zh',
    segments: [],
    translations: {},
    suggestions: [],
    summary: '',
    speakerNames: {},
    ...extra,
  })
  const records = [
    record('old', 1, { segments: [seg('a', 'We need data residency in Singapore for compliance reasons.')] }),
    record('new', 2, { summary: '## 待办\n- 发送报价单' }),
    record('pricing', 3, { title: 'Pricing review' }),
  ]

  it('returns everything newest first for an empty query', () => {
    expect(searchMeetings(records, ' ').map((h) => h.record.id)).toEqual(['pricing', 'new', 'old'])
  })

  it('matches titles, transcript and summary with a snippet', () => {
    expect(searchMeetings(records, 'pricing')).toEqual([{ record: records[2], snippet: '' }])
    const [hit] = searchMeetings(records, 'SINGAPORE')
    expect(hit.record.id).toBe('old')
    expect(hit.snippet).toContain('Singapore')
    expect(searchMeetings(records, '报价单')[0].record.id).toBe('new')
    expect(searchMeetings(records, 'nothing-like-this')).toEqual([])
  })
})
