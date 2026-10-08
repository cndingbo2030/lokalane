import { LANGUAGE_NAMES } from '../../shared/language.ts'
import type { LanguageCode, MeetingBrief, MeetingInfo, SuggestionKind } from '../../shared/protocol.ts'

type Target = Exclude<LanguageCode, 'auto'>

const LATENCY_HINT = 'Latency-sensitive; begin your visible answer immediately.'

/** Rendered once per session and cached by the API (stable prefix). */
export function briefBlock(brief: MeetingBrief, meeting?: MeetingInfo): string | undefined {
  const attendees = meeting?.attendees?.filter(Boolean) ?? []
  const parts = [
    meeting?.title?.trim() && `<meeting_title>\n${meeting.title.trim()}\n</meeting_title>`,
    attendees.length > 0 && `<invited_participants>\n${attendees.join('\n')}\n</invited_participants>`,
    brief.myRole.trim() && `<my_role>\n${brief.myRole.trim()}\n</my_role>`,
    brief.goal.trim() && `<meeting_goal>\n${brief.goal.trim()}\n</meeting_goal>`,
    brief.context.trim() && `<background_knowledge>\n${brief.context.trim()}\n</background_knowledge>`,
  ].filter(Boolean)
  if (parts.length === 0) return undefined
  return `Meeting brief provided by the user before the meeting:\n\n${parts.join('\n\n')}`
}

export function translatorSystem(target: Target): string {
  const language = LANGUAGE_NAMES[target].english
  return [
    '[role:translator]',
    `You are a professional simultaneous interpreter for live business meetings. Translate the line inside <translate> into ${language}.`,
    'The earlier lines are context only, for resolving pronouns, names and terminology; never translate them.',
    'Speech recognition output can contain small errors: translate the intended meaning, keep names, numbers, amounts, dates and product terms exact, and keep the speaker’s tone (formal stays formal).',
    'If the brief contains terminology, use it consistently.',
    `Output only the ${language} translation of that one line, with no quotes, notes or explanations.`,
    LATENCY_HINT,
  ].join('\n')
}

export function translatorPrompt(context: string, line: string): string {
  return `${context ? `<context>\n${context}\n</context>\n\n` : ''}<translate>\n${line}\n</translate>`
}

const COPILOT_LABELS: Record<'zh' | 'other', { reply: string; points: string; caution: string }> = {
  zh: { reply: '建议回应', points: '要点', caution: '注意' },
  other: { reply: 'Suggested reply', points: 'Key points', caution: 'Watch out' },
}

export function copilotSystem(target: Target, hasDocuments = false): string {
  const labels = target === 'zh' ? COPILOT_LABELS.zh : COPILOT_LABELS.other
  const language = LANGUAGE_NAMES[target].english
  return [
    '[role:copilot]',
    'You are a discreet real-time meeting copilot. The user is in a live call and glances at your card for a few seconds while the other side waits, so every word must earn its place.',
    'Lines marked 我(ME) are the user; lines marked 对方 are the other participants (diarized as S1, S2…, with a name when the user provided one). Help the user respond to the most recent thing the other side said (or to the user’s explicit question when one is given).',
    '',
    'Respond in this exact Markdown shape:',
    `**${labels.reply}**: 1–3 sentences the user can say out loud right now, written in the reply language given in <reply_language> (the language the other side is speaking; if none is given, use the language of the line being answered). Natural spoken register, no filler.`,
    `↳ the same reply translated into ${language}, so the user knows exactly what they are about to say. Include this line only when the reply language is not ${language}.`,
    `**${labels.points}**`,
    `- 2–3 short bullets in ${language}: the facts, numbers or reasoning behind the reply, or what to ask next.`,
    `**${labels.caution}**: optional, one line in ${language}, only for a real risk (legal/commercial commitment, a claim you cannot verify, a trap in the question).`,
    '',
    'Rules:',
    `- Ground facts in the meeting brief${hasDocuments ? ', the attached documents' : ''} and transcript. Never invent prices, dates, figures, clients or commitments; if the needed fact is missing, the reply should buy time or ask a clarifying question, and say what to check.`,
    ...(hasDocuments
      ? ['- When a bullet relies on an attached document, end it with the source in parentheses, e.g. (来源：报价单.pdf p.2), so the user can check it quickly.']
      : []),
    '- Do not over-promise on the user’s behalf; prefer replies that keep options open.',
    '- Stay under 120 words in total.',
    '- If the latest line needs no help (small talk, a statement already handled, the user is the one asking), output exactly SKIP and nothing else.',
    LATENCY_HINT,
  ].join('\n')
}

const KIND_HINTS: Record<SuggestionKind, string> = {
  question: 'The other side just asked a question. Help the user answer it.',
  objection: 'The other side just raised a concern or objection. Help the user acknowledge it and respond constructively.',
  action: 'The other side just asked for an action or follow-up. Help the user respond and commit appropriately.',
  manual: 'The user explicitly asked for help right now.',
}

export function copilotPrompt(kind: SuggestionKind, transcript: string, focus: string, userQuestion?: string, replyLanguage?: string): string {
  return [
    `<transcript>\n${transcript || '(no speech yet)'}\n</transcript>`,
    `<focus>\n${focus || '(latest exchange)'}\n</focus>`,
    userQuestion ? `<user_question>\n${userQuestion}\n</user_question>` : '',
    replyLanguage ? `<reply_language>${replyLanguage}</reply_language>` : '',
    KIND_HINTS[kind],
  ]
    .filter(Boolean)
    .join('\n\n')
}

/**
 * Shared by the summary and the outcome extraction: identical system prompt and
 * transcript block, so the second call reads the whole transcript from the cache.
 */
export function analystSystem(target: Target): string {
  const language = LANGUAGE_NAMES[target].english
  return [
    '[role:analyst]',
    `You analyze a business meeting from its speech-recognition transcript and write in ${language}.`,
    'Lines marked 我(ME) are the user; 对方 lines are other participants (S1, S2… are diarized speakers, with names when known).',
    'Be faithful to the transcript: never invent decisions, owners, dates or numbers; quote numbers exactly; mark anything uncertain as such.',
    'Do the task given after the transcript.',
  ].join('\n')
}

export function transcriptBlock(transcript: string): string {
  return `<transcript>\n${transcript || '(empty)'}\n</transcript>`
}

export function summaryTask(target: Target): string {
  return [
    `Task: write the meeting notes in ${LANGUAGE_NAMES[target].english}, using these Markdown headings:`,
    '## 一句话总结 / TL;DR',
    '## 关键讨论点',
    '## 已达成的决定',
    '## 待办事项 (each: owner — task — due date if stated)',
    '## 未决问题与风险',
    'Translate the headings into the output language when it is not Chinese.',
  ].join('\n')
}

export function outcomesTask(target: Target, meetingDate: string): string {
  return [
    'Task: extract the meeting outcomes as JSON.',
    '- decisions: what the participants actually agreed on (not proposals or open questions).',
    '- actionItems: concrete follow-ups someone committed to. owner: "我" when the user (我(ME)) committed; otherwise the participant’s name, or their label when unnamed (e.g. 对方(S1)); "待定" when unclear. due: YYYY-MM-DD when a date or a relative day ("next Friday", "下周三") was stated — resolve it against the meeting date — otherwise an empty string.',
    '- followUpEmail: a short, polite follow-up email from the user to the other side, in the language the other side mostly spoke: thanks, the decisions, the action items with owners and dates, the next step. Plain text; subject and body.',
    `Write decisions and action items in ${LANGUAGE_NAMES[target].english}. Use empty arrays when there are none.`,
    `Meeting date: ${meetingDate}.`,
  ].join('\n')
}
