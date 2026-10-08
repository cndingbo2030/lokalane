import type { BriefRequest, MeetingBriefDraft } from '../shared/brief.ts'
import type { SetupForm } from './components/SetupPanel.tsx'
import { postJson } from './net/api.ts'

export function requestBrief(request: BriefRequest): Promise<MeetingBriefDraft> {
  return postJson<MeetingBriefDraft>('/api/brief', request)
}

const MARKER = { zh: '———— AI 会前简报 ————', other: '———— AI pre-meeting brief ————' }

/**
 * Folds a generated brief into the setup form. The user's own role and goal win;
 * the AI part of the notes sits after a marker so regenerating replaces it
 * instead of piling up. Anticipated Q&A lands in the notes on purpose: the notes
 * are the live copilot's cached context, so prepared answers are reused in the meeting.
 */
export function mergeBriefIntoForm(form: SetupForm, brief: MeetingBriefDraft): SetupForm {
  const zh = form.targetLanguage === 'zh'
  const label = zh
    ? { background: '背景', agenda: '议程', qa: '预计问题与建议回答', open: '上次遗留事项', risks: '注意', q: '问', a: '答' }
    : { background: 'Background', agenda: 'Agenda', qa: 'Likely questions and suggested answers', open: 'Open items from earlier meetings', risks: 'Watch out', q: 'Q', a: 'A' }
  const sections = [
    brief.context && `${label.background}：\n${brief.context}`,
    brief.agenda.length > 0 && `${label.agenda}：\n${brief.agenda.map((item, i) => `${i + 1}. ${item}`).join('\n')}`,
    brief.anticipatedQuestions.length > 0 &&
      `${label.qa}：\n${brief.anticipatedQuestions.map((qa) => `${label.q}：${qa.question}\n${label.a}：${qa.answer}`).join('\n\n')}`,
    brief.openItems.length > 0 && `${label.open}：\n${brief.openItems.map((item) => `- ${item}`).join('\n')}`,
    brief.risks.length > 0 && `${label.risks}：\n${brief.risks.map((item) => `- ${item}`).join('\n')}`,
  ].filter(Boolean)

  const userNotes = stripGenerated(form.context)
  const generated = sections.length ? `${zh ? MARKER.zh : MARKER.other}\n${sections.join('\n\n')}` : ''
  return {
    ...form,
    myRole: form.myRole.trim() ? form.myRole : brief.myRole,
    goal: form.goal.trim() ? form.goal : brief.goal,
    context: [userNotes, generated].filter(Boolean).join('\n\n'),
  }
}

export function stripGenerated(context: string): string {
  const index = Math.min(...[MARKER.zh, MARKER.other].map((m) => context.indexOf(m)).filter((i) => i >= 0), context.length)
  return context.slice(0, index).trim()
}
