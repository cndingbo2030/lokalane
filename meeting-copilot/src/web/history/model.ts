import type { LanguageCode, MeetingPlatform, MetricsSnapshot, TranscriptSegment } from '../../shared/protocol.ts'
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
}

const PLATFORM_TITLES: Record<MeetingPlatform, string> = {
  'google-meet': 'Google Meet 会议',
  teams: 'Teams 会议',
  zoom: 'Zoom 会议',
  tencent: '腾讯会议',
  unknown: '会议',
}

export function buildRecord(
  state: AppState,
  meta: { id: string; platform: MeetingPlatform; startedAt: number; endedAt: number; targetLanguage: MeetingRecord['targetLanguage'] },
  options: { demo?: boolean } = {},
): MeetingRecord {
  const segments = state.segments.filter((s) => s.isFinal)
  const tldr = titleFromSummary(state.summary.text)
  const translations = Object.fromEntries(Object.entries(state.translations).filter(([id]) => segments.some((s) => s.id === id)))
  return {
    ...meta,
    title: tldr
      ? `${options.demo ? '演示 · ' : ''}${tldr}`
      : `${options.demo ? '演示会议' : PLATFORM_TITLES[meta.platform]} · ${formatDate(meta.startedAt)}`,
    segments,
    translations,
    suggestions: state.suggestions.filter((s) => s.done && s.text),
    summary: state.summary.status === 'done' ? state.summary.text : '',
    speakerNames: { ...state.speakerNames },
    metrics: state.metrics,
  }
}

/** Uses the summary's one-line TL;DR as the meeting title when there is one. */
export function titleFromSummary(summary: string): string | undefined {
  const lines = summary.split('\n').map((l) => l.trim())
  const tldr = lines.findIndex((l) => /^#+\s*(一句话总结|TL;?DR)/i.test(l))
  const candidate = (tldr >= 0 ? lines.slice(tldr + 1) : []).find((l) => l && !l.startsWith('#'))
  if (!candidate) return undefined
  const clean = candidate.replace(/^[-*•]\s*/, '').replace(/\*\*/g, '')
  return clean.length > 48 ? `${clean.slice(0, 47)}…` : clean
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
