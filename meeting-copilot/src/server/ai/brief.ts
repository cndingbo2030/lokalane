import type { BriefRequest, MeetingBriefDraft } from '../../shared/brief.ts'
import { LANGUAGE_NAMES } from '../../shared/language.ts'
import { sanitizeDocuments } from '../documents.ts'
import { ClientError } from '../errors.ts'
import type { LlmClient } from '../llm/types.ts'

const LANGS = Object.keys(LANGUAGE_NAMES) as Array<keyof typeof LANGUAGE_NAMES>

/** Strict schema for structured outputs: every property required, nothing extra. */
export const BRIEF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['myRole', 'goal', 'context', 'agenda', 'anticipatedQuestions', 'openItems', 'risks'],
  properties: {
    myRole: { type: 'string', description: "The user's role in this meeting, one line. Empty string if unknown." },
    goal: { type: 'string', description: 'What the user should aim to achieve, at most two sentences.' },
    context: { type: 'string', description: 'Key background the user should have in mind: short bullet lines starting with "- ".' },
    agenda: { type: 'array', items: { type: 'string' }, description: 'Likely agenda items, in order.' },
    anticipatedQuestions: {
      type: 'array',
      description: 'Questions the other side is likely to ask, with suggested answers grounded in the materials.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['question', 'answer'],
        properties: { question: { type: 'string' }, answer: { type: 'string' } },
      },
    },
    openItems: { type: 'array', items: { type: 'string' }, description: 'Unresolved follow-ups from earlier meetings.' },
    risks: { type: 'array', items: { type: 'string' }, description: 'Things to watch out for (commitments, sensitive topics, unknowns).' },
  },
} as const

export class BriefRequestError extends ClientError {}

const clean = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.replace(/\p{Cc}/gu, (c) => (c === '\n' ? '\n' : ' ')).trim().slice(0, max) : ''

/** The request comes from the browser: bound every field. */
export function sanitizeBriefRequest(input: unknown): BriefRequest {
  const body = (input ?? {}) as Partial<BriefRequest>
  const targetLanguage = LANGS.includes(body.targetLanguage as (typeof LANGS)[number]) ? (body.targetLanguage as BriefRequest['targetLanguage']) : 'zh'
  const person = (p: unknown) => {
    const { name, email } = (p ?? {}) as { name?: unknown; email?: unknown }
    const out = { name: clean(name, 100) || undefined, email: clean(email, 200) || undefined }
    return out.name || out.email ? out : undefined
  }
  const event = body.event && typeof body.event === 'object'
    ? {
        title: clean(body.event.title, 200),
        start: clean(body.event.start, 40) || undefined,
        end: clean(body.event.end, 40) || undefined,
        description: clean(body.event.description, 3_000) || undefined,
        location: clean(body.event.location, 300) || undefined,
        organizer: person(body.event.organizer),
        attendees: (Array.isArray(body.event.attendees) ? body.event.attendees : []).map(person).filter((p) => p !== undefined).slice(0, 40),
      }
    : undefined
  const pastMeetings = (Array.isArray(body.pastMeetings) ? body.pastMeetings : []).slice(0, 3).map((m) => ({
    title: clean(m?.title, 200),
    date: clean(m?.date, 40),
    summary: clean(m?.summary, 4_000),
    openActionItems: (Array.isArray(m?.openActionItems) ? m.openActionItems : []).map((a) => clean(a, 300)).filter(Boolean).slice(0, 20),
  }))
  const notes = {
    myRole: clean(body.notes?.myRole, 500),
    goal: clean(body.notes?.goal, 1_000),
    context: clean(body.notes?.context, 6_000),
  }
  const request: BriefRequest = {
    event: event?.title ? event : undefined,
    meetingUrl: clean(body.meetingUrl, 500) || undefined,
    notes,
    pastMeetings: pastMeetings.filter((m) => m.summary || m.openActionItems.length),
    documents: sanitizeDocuments(body.documents),
    targetLanguage,
  }
  if (!request.event && !notes.goal && !notes.context && !request.pastMeetings?.length) {
    throw new BriefRequestError('请先关联一个日历会议，或填写会议目标 / 背景资料')
  }
  return request
}

export function briefSystem(target: BriefRequest['targetLanguage']): string {
  const language = LANGUAGE_NAMES[target].english
  return [
    '[role:brief]',
    `You prepare a concise pre-meeting brief, written in ${language}, for someone about to join a business meeting.`,
    'Use only the calendar event, the earlier meeting notes, the user’s own notes and any attached documents. Never invent facts, prices, dates, names or commitments.',
    'Participants from a different organization (a different email domain from the organizer or the user) are usually "the other side".',
    'Anticipated questions: the 3–6 questions the other side is most likely to raise given the agenda, the participants and the history. Each answer must be something the user can say, grounded in the materials; when the materials do not contain the answer, give a safe holding reply and end it with "(待确认)".',
    'Open items: unresolved action items or questions from earlier meetings that are likely to come up.',
    'Keep it short enough to read in two minutes. If the user already wrote a role or goal, keep its meaning and only sharpen it.',
  ].join('\n')
}

export function briefPrompt(request: BriefRequest): string {
  const parts: string[] = []
  const event = request.event
  if (event) {
    const people = (event.attendees ?? []).map((a) => [a.name, a.email && `<${a.email}>`].filter(Boolean).join(' ')).join('\n')
    parts.push(
      [
        '<calendar_event>',
        `Title: ${event.title}`,
        event.start ? `Time: ${event.start}${event.end ? ` – ${event.end}` : ''}` : '',
        event.organizer ? `Organizer: ${[event.organizer.name, event.organizer.email].filter(Boolean).join(' ')}` : '',
        people ? `Invited:\n${people}` : '',
        event.location ? `Location: ${event.location}` : '',
        event.description ? `Description:\n${event.description}` : '',
        '</calendar_event>',
      ]
        .filter(Boolean)
        .join('\n'),
    )
  } else if (request.meetingUrl) {
    parts.push(`<meeting_link>${request.meetingUrl}</meeting_link>`)
  }
  for (const meeting of request.pastMeetings ?? []) {
    parts.push(
      [
        `<earlier_meeting title="${meeting.title.replace(/"/g, "'")}" date="${meeting.date}">`,
        meeting.summary,
        meeting.openActionItems?.length ? `Open action items:\n${meeting.openActionItems.map((a) => `- ${a}`).join('\n')}` : '',
        '</earlier_meeting>',
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }
  const notes = request.notes ?? {}
  if (notes.myRole || notes.goal || notes.context) {
    parts.push(
      ['<user_notes>', notes.myRole && `Role: ${notes.myRole}`, notes.goal && `Goal: ${notes.goal}`, notes.context && `Notes:\n${notes.context}`, '</user_notes>']
        .filter(Boolean)
        .join('\n'),
    )
  }
  parts.push('Write the brief.')
  return parts.join('\n\n')
}

/** Defensive normalization of the model output (bounded lengths, no empty items). */
export function normalizeBrief(raw: unknown): MeetingBriefDraft {
  const value = (raw ?? {}) as Partial<MeetingBriefDraft>
  const list = (items: unknown, max: number, len: number) => (Array.isArray(items) ? items.map((i) => clean(i, len)).filter(Boolean).slice(0, max) : [])
  return {
    myRole: clean(value.myRole, 300),
    goal: clean(value.goal, 600),
    context: clean(value.context, 3_000),
    agenda: list(value.agenda, 10, 200),
    anticipatedQuestions: (Array.isArray(value.anticipatedQuestions) ? value.anticipatedQuestions : [])
      .map((q) => ({ question: clean(q?.question, 300), answer: clean(q?.answer, 800) }))
      .filter((q) => q.question && q.answer)
      .slice(0, 8),
    openItems: list(value.openItems, 10, 300),
    risks: list(value.risks, 8, 300),
  }
}

export async function generateBrief(llm: LlmClient, model: string, input: unknown): Promise<MeetingBriefDraft> {
  const request = sanitizeBriefRequest(input)
  try {
    const raw = await llm.completeJson<MeetingBriefDraft>({
      task: 'brief',
      model,
      system: briefSystem(request.targetLanguage),
      documents: request.documents,
      prompt: briefPrompt(request),
      maxTokens: 8_000,
      effort: 'medium',
      schema: BRIEF_SCHEMA,
    })
    return normalizeBrief(raw)
  } catch (error) {
    if (error instanceof ClientError) throw error
    throw new ClientError('AI 简报生成失败，请稍后重试或手动填写', 502)
  }
}
