import { describe, expect, it } from 'vitest'
import { ClientError } from '../errors.ts'
import { MockLlm } from '../llm/mock.ts'
import type { LlmJsonRequest } from '../llm/types.ts'
import { BRIEF_SCHEMA, briefPrompt, generateBrief, normalizeBrief, sanitizeBriefRequest } from './brief.ts'

const event = {
  title: 'Lawgorithm x Client — pilot review',
  start: '2026-10-09T06:00:00Z',
  end: '2026-10-09T07:00:00Z',
  description: 'Agenda: pilot scope, pricing, data residency',
  organizer: { name: 'Alice Tan', email: 'alice@lawgorithm.sg' },
  attendees: [{ name: 'Wang Lei', email: 'wang@client.com' }, { email: 'alice@lawgorithm.sg' }],
}

describe('brief request', () => {
  it('requires something to work from', () => {
    expect(() => sanitizeBriefRequest({ targetLanguage: 'zh' })).toThrow(ClientError)
    expect(() => sanitizeBriefRequest({ notes: { goal: 'close the pilot' } })).not.toThrow()
  })

  it('bounds untrusted input and keeps only useful past meetings', () => {
    const request = sanitizeBriefRequest({
      event: { ...event, description: 'x'.repeat(10_000) },
      targetLanguage: 'klingon',
      pastMeetings: [
        { title: 'Kickoff', date: '2026-09-30', summary: 'Agreed to a 2-month pilot', openActionItems: ['Send DPA'] },
        { title: 'Empty', date: '2026-09-01', summary: '' },
        ...Array.from({ length: 5 }, (_, i) => ({ title: `m${i}`, date: '', summary: 's' })),
      ],
      documents: [{ id: '../x', name: 'bad', kind: 'pdf', sizeBytes: 1 }],
    })
    expect(request.targetLanguage).toBe('zh')
    expect(request.event?.description).toHaveLength(3_000)
    expect(request.pastMeetings?.map((m) => m.title)).toEqual(['Kickoff', 'm0'])
    expect(request.documents).toEqual([])
  })

  it('renders the event, participants, history and the user’s notes into the prompt', () => {
    const prompt = briefPrompt(
      sanitizeBriefRequest({
        event,
        notes: { myRole: '销售负责人', goal: '' },
        pastMeetings: [{ title: 'Kickoff', date: '2026-09-30', summary: 'Agreed to a 2-month pilot', openActionItems: ['Send DPA'] }],
        targetLanguage: 'zh',
      }),
    )
    expect(prompt).toContain('Title: Lawgorithm x Client — pilot review')
    expect(prompt).toContain('Wang Lei <wang@client.com>')
    expect(prompt).toContain('<earlier_meeting title="Kickoff" date="2026-09-30">')
    expect(prompt).toContain('- Send DPA')
    expect(prompt).toContain('Role: 销售负责人')
  })
})

describe('generateBrief', () => {
  it('asks Claude for schema-constrained JSON with the documents attached', async () => {
    const requests: LlmJsonRequest[] = []
    const llm = new MockLlm(undefined, (request) => {
      requests.push(request)
      return {
        myRole: ' Sales lead ',
        goal: 'Agree the pilot scope',
        context: '- Pilot: 2 months',
        agenda: ['Scope', '', 'Pricing'],
        anticipatedQuestions: [{ question: 'Where is data stored?', answer: 'Singapore AWS region' }, { question: 'no answer', answer: '' }],
        openItems: ['DPA still unsigned'],
        risks: [],
      }
    })
    const docs = [{ id: 'file_1', name: '报价单.pdf', kind: 'pdf', sizeBytes: 10 }]
    const brief = await generateBrief(llm, 'claude-opus-5-5', { event, documents: docs, targetLanguage: 'en' })
    expect(brief).toEqual({
      myRole: 'Sales lead',
      goal: 'Agree the pilot scope',
      context: '- Pilot: 2 months',
      agenda: ['Scope', 'Pricing'],
      anticipatedQuestions: [{ question: 'Where is data stored?', answer: 'Singapore AWS region' }],
      openItems: ['DPA still unsigned'],
      risks: [],
    })
    expect(requests[0]).toMatchObject({ task: 'brief', model: 'claude-opus-5-5', effort: 'medium', schema: BRIEF_SCHEMA, documents: docs })
    expect(requests[0].system).toContain('English')
    expect(requests[0].system).toContain('(待确认)')
  })

  it('reports model failures as a friendly 502', async () => {
    const llm = new MockLlm(undefined, () => {
      throw new Error('overloaded')
    })
    await expect(generateBrief(llm, 'm', { event, targetLanguage: 'zh' })).rejects.toMatchObject({ status: 502 })
  })

  it('normalizes missing or malformed fields', () => {
    expect(normalizeBrief(null)).toEqual({ myRole: '', goal: '', context: '', agenda: [], anticipatedQuestions: [], openItems: [], risks: [] })
  })
})
