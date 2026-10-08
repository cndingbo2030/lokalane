import type { MeetingOutcomes } from '../../shared/outcomes.ts'
import type { LanguageCode, MeetingPlatform, MetricsSnapshot, TranscriptSegment } from '../../shared/protocol.ts'
import { summaryTldr } from '../../shared/summary.ts'
import type { AppState, Suggestion } from '../state/reducer.ts'

/** A finished meeting as stored in this browser (IndexedDB). Never sent to the server. */
export interface MeetingRecord {
  id: string
  title: string
  platform: MeetingPlatform
  startedAt: number
  endedAt: number
  targetLanguage: Exclude<LanguageCode, 'auto'>
  segments: TranscriptSegment[]
  translations: Record<string, string>
  suggestions: Suggestion[]
  summary: string
  speakerNames: Record<string, string>
  metrics?: MetricsSnapshot
  /** Calendar series (iCalendar UID): links occurrences of a recurring meeting. */
  seriesId?: string
  eventTitle?: string
  /** Invited participants (names or emails), from the calendar. */
  attendees?: string[]
  /** Their email addresses, for the follow-up email. */
  attendeeEmails?: string[]
  /** Decisions, action items (with done state) and the follow-up email. */
  outcomes?: MeetingOutcomes
}

export interface RecordMeta {
  id: string
  platform: MeetingPlatform
  startedAt: number
  endedAt: number
  targetLanguage: MeetingRecord['targetLanguage']
  seriesId?: string
  eventTitle?: string
  attendees?: string[]
  attendeeEmails?: string[]
}

export const PLATFORM_TITLES: Record<MeetingPlatform, string> = {
  'google-meet': 'Google Meet 会议',
  teams: 'Teams 会议',
  zoom: 'Zoom 会议',
  tencent: '腾讯会议',
  unknown: '会议',
}

export function buildRecord(state: AppState, meta: RecordMeta, options: { demo?: boolean } = {}): MeetingRecord {
  const segments = state.segments.filter((s) => s.isFinal)
  const tldr = titleFromSummary(state.summary.text)
  const translations = Object.fromEntries(Object.entries(state.translations).filter(([id]) => segments.some((s) => s.id === id)))
  return {
    ...meta,
    title: tldr
      ? `${options.demo ? '演示 · ' : ''}${tldr}`
      : `${options.demo ? '演示会议' : (meta.eventTitle ?? PLATFORM_TITLES[meta.platform])} · ${formatDate(meta.startedAt)}`,
    segments,
    translations,
    suggestions: state.suggestions.filter((s) => s.done && s.text),
    summary: state.summary.status === 'done' ? state.summary.text : '',
    speakerNames: { ...state.speakerNames },
    metrics: state.metrics,
    outcomes: state.outcomes.status === 'done' ? state.outcomes.data : undefined,
  }
}

/** Uses the summary's one-line TL;DR as the meeting title when there is one. */
export function titleFromSummary(summary: string): string | undefined {
  const clean = summaryTldr(summary)
  if (!clean) return undefined
  return clean.length > 48 ? `${clean.slice(0, 47)}…` : clean
}

/**
 * Earlier meetings worth reading before this one: the same recurring series
 * first, then meetings with the same people. Attendees present in most of the
 * user's meetings (usually the user themself) do not count as a match.
 */
export function relatedMeetings(records: MeetingRecord[], event: { seriesId?: string; attendees: Array<{ name?: string; email?: string }> }, limit = 3): MeetingRecord[] {
  const useful = records.filter((r) => r.summary.trim()).sort((a, b) => b.startedAt - a.startedAt)
  const series = event.seriesId ? useful.filter((r) => r.seriesId === event.seriesId).slice(0, 2) : []

  const key = (value: string) => value.trim().toLowerCase()
  const frequency = new Map<string, number>()
  for (const record of records) for (const a of new Set((record.attendees ?? []).map(key))) frequency.set(a, (frequency.get(a) ?? 0) + 1)
  const ubiquitous = (a: string) => records.length >= 3 && (frequency.get(a) ?? 0) / records.length > 0.6
  const wanted = new Set(event.attendees.flatMap((a) => [a.email, a.name]).filter((v): v is string => Boolean(v)).map(key).filter((a) => !ubiquitous(a)))
  const sharedPeople = useful.filter((r) => !series.includes(r) && (r.attendees ?? []).some((a) => wanted.has(key(a))))

  return [...series, ...sharedPeople].slice(0, limit)
}

export interface SearchHit {
  record: MeetingRecord
  /** Short excerpt around the first match (empty when the title matched). */
  snippet: string
}

/** Case-insensitive search over title, transcript, translations and summary; newest first. */
export function searchMeetings(records: MeetingRecord[], query: string): SearchHit[] {
  const sorted = [...records].sort((a, b) => b.startedAt - a.startedAt)
  const q = query.trim().toLowerCase()
  if (!q) return sorted.map((record) => ({ record, snippet: '' }))
  const hits: SearchHit[] = []
  for (const record of sorted) {
    if (record.title.toLowerCase().includes(q)) {
      hits.push({ record, snippet: '' })
      continue
    }
    const haystacks = [...record.segments.map((s) => s.text), ...Object.values(record.translations), record.summary]
    const match = haystacks.find((text) => text.toLowerCase().includes(q))
    if (match) hits.push({ record, snippet: excerpt(match, q) })
  }
  return hits
}

function excerpt(text: string, q: string): string {
  const index = text.toLowerCase().indexOf(q)
  const start = Math.max(0, index - 24)
  const end = Math.min(text.length, index + q.length + 40)
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}

export function formatDate(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  return minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`
}
