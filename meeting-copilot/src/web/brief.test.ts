import { describe, expect, it } from 'vitest'
import type { MeetingBriefDraft } from '../shared/brief.ts'
import { mergeBriefIntoForm } from './brief.ts'
import { defaultForm } from './components/SetupPanel.tsx'
import { relatedMeetings, type MeetingRecord } from './history/model.ts'

const brief: MeetingBriefDraft = {
  myRole: 'Sales lead',
  goal: 'Agree the pilot scope',
  context: '- Pilot: 2 months',
  agenda: ['Scope', 'Pricing'],
  anticipatedQuestions: [{ question: '数据存在哪里？', answer: '新加坡 AWS（待确认）' }],
  openItems: ['DPA 未签'],
  risks: ['不要承诺折扣'],
}

describe('mergeBriefIntoForm', () => {
  it('keeps the user’s own role and goal, and appends the AI section to the notes', () => {
    const form = mergeBriefIntoForm({ ...defaultForm, myRole: '创始人', goal: '', context: '报价 SGD 2,000/月' }, brief)
    expect(form.myRole).toBe('创始人')
    expect(form.goal).toBe('Agree the pilot scope')
    expect(form.context.startsWith('报价 SGD 2,000/月\n\n———— AI 会前简报 ————')).toBe(true)
    expect(form.context).toContain('问：数据存在哪里？\n答：新加坡 AWS（待确认）')
    expect(form.context).toContain('1. Scope\n2. Pricing')
    expect(form.context).toContain('- DPA 未签')
  })

  it('replaces the previous AI section when regenerating', () => {
    const once = mergeBriefIntoForm({ ...defaultForm, context: 'my notes' }, brief)
    const twice = mergeBriefIntoForm(once, { ...brief, agenda: ['Only item'] })
    expect(twice.context.match(/AI 会前简报/g)).toHaveLength(1)
    expect(twice.context).toContain('1. Only item')
    expect(twice.context).not.toContain('2. Pricing')
    expect(twice.context.startsWith('my notes')).toBe(true)
  })

  it('uses English labels for English output', () => {
    expect(mergeBriefIntoForm({ ...defaultForm, targetLanguage: 'en' }, brief).context).toContain('Q：数据存在哪里？')
  })
})

describe('relatedMeetings', () => {
  const record = (id: string, startedAt: number, extra: Partial<MeetingRecord>): MeetingRecord => ({
    id,
    title: id,
    platform: 'zoom',
    startedAt,
    endedAt: startedAt,
    targetLanguage: 'zh',
    segments: [],
    translations: {},
    suggestions: [],
    summary: `summary of ${id}`,
    speakerNames: {},
    ...extra,
  })

  it('prefers the same series, then shared participants, ignoring the user who attends everything', () => {
    const me = 'me@lawgorithm.sg'
    const records = [
      record('weekly-1', 1, { seriesId: 'weekly', attendees: [me] }),
      record('weekly-2', 2, { seriesId: 'weekly', attendees: [me] }),
      record('weekly-3', 3, { seriesId: 'weekly', attendees: [me] }),
      record('client-call', 4, { attendees: [me, 'wang@client.com'] }),
      record('other', 5, { attendees: [me, 'someone@else.com'] }),
      record('no-summary', 6, { seriesId: 'weekly', summary: '' }),
    ]
    const ids = (event: Parameters<typeof relatedMeetings>[1]) => relatedMeetings(records, event).map((r) => r.id)
    expect(ids({ seriesId: 'weekly', attendees: [{ email: me }] })).toEqual(['weekly-3', 'weekly-2'])
    expect(ids({ attendees: [{ email: 'WANG@client.com' }, { email: me }] })).toEqual(['client-call'])
    expect(ids({ attendees: [{ email: me }] })).toEqual([])
  })
})
