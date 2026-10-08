import type { MeetingOutcomes } from '../../shared/outcomes.ts'
import type { BotStatus, FeedbackRating, MetricsSnapshot, ServerMessage, SuggestionTrigger, TranscriptSegment } from '../../shared/protocol.ts'

export type Phase = 'setup' | 'connecting' | 'live' | 'ended'

export interface Suggestion {
  id: string
  trigger: SuggestionTrigger
  text: string
  done: boolean
  error?: string
  rating?: FeedbackRating
}

export interface AppState {
  phase: Phase
  sessionId?: string
  stt?: string
  llm?: string
  segments: TranscriptSegment[]
  translations: Record<string, string>
  /** Newest first. */
  suggestions: Suggestion[]
  summary: { status: 'idle' | 'streaming' | 'done' | 'error'; text: string; error?: string }
  /** Decisions, action items and follow-up email, extracted after the summary. */
  outcomes: { status: 'idle' | 'loading' | 'done' | 'error'; data?: MeetingOutcomes; error?: string }
  errors: Array<{ id: number; message: string }>
  /** Display names for diarized speakers, e.g. { S1: '王总' }. */
  speakerNames: Record<string, string>
  /** The diarized speaker who is the user (bot / room audio hears everyone). */
  meSpeaker?: string
  metrics?: MetricsSnapshot
  /** Bot mode: where the meeting bot is (joining, waiting room, recording…). */
  bot?: BotStatus
  /** Owner: the read-only live link (token absent = off). */
  share?: { token?: string; includeSuggestions: boolean; viewers: number }
  /** Viewer of a live link: meeting details and whether the link has ended. */
  watch?: { title?: string; startedAt?: number; ended?: 'stopped' | 'ended' }
}

export type Action =
  | { type: 'server'; message: ServerMessage }
  | { type: 'phase'; phase: Phase }
  | { type: 'error'; message: string }
  | { type: 'dismissError'; id: number }
  | { type: 'rate'; id: string; rating: FeedbackRating | null }
  | { type: 'renameSpeaker'; speaker: string; name: string }
  | { type: 'setMeSpeaker'; speaker: string | null }
  | { type: 'toggleActionItem'; id: string }
  | { type: 'reset' }

export const initialState: AppState = {
  phase: 'setup',
  segments: [],
  translations: {},
  suggestions: [],
  summary: { status: 'idle', text: '' },
  outcomes: { status: 'idle' },
  errors: [],
  speakerNames: {},
}

let errorCounter = 0
const MAX_SUGGESTIONS = 30

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'phase':
      return { ...state, phase: action.phase }
    case 'reset':
      return initialState
    case 'error':
      return addError(state, action.message)
    case 'dismissError':
      return { ...state, errors: state.errors.filter((e) => e.id !== action.id) }
    case 'rate':
      return updateSuggestion(state, action.id, (s) => ({ ...s, rating: action.rating ?? undefined }))
    case 'renameSpeaker': {
      const speakerNames = { ...state.speakerNames }
      const name = action.name.trim()
      if (name) speakerNames[action.speaker] = name
      else delete speakerNames[action.speaker]
      return { ...state, speakerNames }
    }
    case 'setMeSpeaker':
      return { ...state, meSpeaker: action.speaker ?? undefined }
    case 'toggleActionItem': {
      const data = state.outcomes.data
      if (!data) return state
      const actionItems = data.actionItems.map((item) => (item.id === action.id ? { ...item, done: !item.done } : item))
      return { ...state, outcomes: { ...state.outcomes, data: { ...data, actionItems } } }
    }
    case 'server':
      return applyServerMessage(state, action.message)
  }
}

function applyServerMessage(state: AppState, message: ServerMessage): AppState {
  switch (message.type) {
    case 'ready':
      return {
        ...state,
        phase: state.phase === 'connecting' ? 'live' : state.phase,
        sessionId: message.sessionId,
        stt: message.stt,
        llm: message.llm,
      }
    case 'transcript':
      return { ...state, segments: upsertSegment(state.segments, message.segment) }
    case 'translation':
      return { ...state, translations: { ...state.translations, [message.segmentId]: message.text } }
    case 'suggestion.start':
      return {
        ...state,
        suggestions: [{ id: message.id, trigger: message.trigger, text: '', done: false }, ...state.suggestions].slice(0, MAX_SUGGESTIONS),
      }
    case 'suggestion.delta':
      return updateSuggestion(state, message.id, (s) => ({ ...s, text: s.text + message.delta }))
    case 'suggestion.done':
      return updateSuggestion(state, message.id, (s) => ({ ...s, done: true, error: message.error }))
    case 'summary.start':
      return { ...state, summary: { status: 'streaming', text: '' }, outcomes: { status: 'idle' } }
    case 'summary.delta':
      return { ...state, summary: { ...state.summary, text: state.summary.text + message.delta } }
    case 'summary.done':
      return {
        ...state,
        summary: message.error
          ? { ...state.summary, status: 'error', error: message.error }
          : { ...state.summary, status: 'done' },
      }
    case 'outcomes.start':
      return { ...state, outcomes: { status: 'loading' } }
    case 'outcomes':
      return {
        ...state,
        outcomes: message.outcomes ? { status: 'done', data: message.outcomes } : { status: 'error', error: message.error ?? '未能提取会议结果' },
      }
    case 'metrics':
      return { ...state, metrics: message.metrics }
    case 'speakers':
      return { ...state, speakerNames: message.names, meSpeaker: message.me }
    case 'share':
      return { ...state, share: { token: message.token, includeSuggestions: message.includeSuggestions, viewers: message.viewers } }
    case 'snapshot':
      // A viewer (re)connected: replace everything with the server's view.
      return {
        ...state,
        phase: 'live',
        segments: message.segments,
        translations: message.translations,
        speakerNames: message.speakerNames,
        meSpeaker: message.me,
        suggestions: (message.suggestions ?? []).map((s) => ({ ...s, done: true })),
        summary: message.summary ? { status: 'done', text: message.summary } : { status: 'idle', text: '' },
        outcomes: message.outcomes ? { status: 'done', data: message.outcomes } : { status: 'idle' },
        watch: { title: message.title, startedAt: message.startedAt },
      }
    case 'share.ended':
      return { ...state, phase: 'ended', watch: { ...state.watch, ended: message.reason } }
    case 'bot':
      // A later status without a link must not hide the recording link.
      return { ...state, bot: { state: message.state, detail: message.detail, recordingUrl: message.recordingUrl ?? state.bot?.recordingUrl } }
    case 'error':
      return addError(state, message.message)
    case 'pong':
      return state
  }
}

/** Partials share an id with their final; search from the end since updates are almost always recent. */
export function upsertSegment(segments: TranscriptSegment[], segment: TranscriptSegment): TranscriptSegment[] {
  for (let i = segments.length - 1; i >= Math.max(0, segments.length - 50); i--) {
    if (segments[i].id === segment.id) {
      const next = segments.slice()
      next[i] = segment
      return next
    }
  }
  return [...segments, segment]
}

function updateSuggestion(state: AppState, id: string, update: (s: Suggestion) => Suggestion): AppState {
  const index = state.suggestions.findIndex((s) => s.id === id)
  if (index === -1) return state
  const suggestions = state.suggestions.slice()
  suggestions[index] = update(suggestions[index])
  return { ...state, suggestions }
}

function addError(state: AppState, message: string): AppState {
  // De-duplicate repeated provider errors and keep the list short.
  if (state.errors.some((e) => e.message === message)) return state
  return { ...state, errors: [...state.errors, { id: ++errorCounter, message }].slice(-3) }
}

export function isMine(segment: TranscriptSegment, meSpeaker?: string): boolean {
  return segment.source === 'me' || (segment.speaker !== undefined && segment.speaker === meSpeaker)
}

export function speakerDisplay(segment: TranscriptSegment, names: Record<string, string>, meSpeaker?: string): string {
  if (isMine(segment, meSpeaker)) return '我'
  if (!segment.speaker) return '对方'
  return names[segment.speaker] ?? `对方 ${segment.speaker}`
}

export function transcriptToMarkdown(state: Pick<AppState, 'segments' | 'translations' | 'speakerNames' | 'meSpeaker'>): string {
  const lines = state.segments
    .filter((s) => s.isFinal)
    .map((s) => {
      const who = speakerDisplay(s, state.speakerNames, state.meSpeaker)
      const translation = state.translations[s.id]
      return `- **${who}** (${formatClock(s.startMs)}): ${s.text}${translation ? `\n  - _${translation}_` : ''}`
    })
  return `# 会议逐字稿\n\n${lines.join('\n')}\n`
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
