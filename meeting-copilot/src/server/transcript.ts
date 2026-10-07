import type { TranscriptSegment } from '../shared/protocol.ts'

/** Holds finalized segments for prompting and summaries. */
export class TranscriptStore {
  private readonly finals: TranscriptSegment[] = []

  addFinal(segment: TranscriptSegment): void {
    this.finals.push(segment)
  }

  all(): readonly TranscriptSegment[] {
    return this.finals
  }

  /** Final segments whose end is within `windowMs` of the latest one. */
  recent(windowMs: number, maxSegments = 60): TranscriptSegment[] {
    const last = this.finals.at(-1)
    if (!last) return []
    const cutoff = last.endMs - windowMs
    const out: TranscriptSegment[] = []
    for (let i = this.finals.length - 1; i >= 0 && out.length < maxSegments; i--) {
      if (this.finals[i].endMs < cutoff) break
      out.unshift(this.finals[i])
    }
    return out
  }

  /** The `count` finals before `segmentId` (exclusive). */
  before(segmentId: string, count: number): TranscriptSegment[] {
    const index = this.finals.findIndex((s) => s.id === segmentId)
    if (index <= 0) return []
    return this.finals.slice(Math.max(0, index - count), index)
  }
}

export type SpeakerNames = Readonly<Record<string, string>>

export function speakerLabel(segment: TranscriptSegment, names: SpeakerNames = {}): string {
  if (segment.source === 'me') return '我(ME)'
  if (!segment.speaker) return '对方'
  const name = names[segment.speaker]
  return name ? `对方(${segment.speaker}:${name})` : `对方(${segment.speaker})`
}

export function formatTimestamp(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function formatTranscript(segments: readonly TranscriptSegment[], names: SpeakerNames = {}): string {
  return segments.map((s) => `[${formatTimestamp(s.startMs)}] ${speakerLabel(s, names)}: ${s.text}`).join('\n')
}

/** Accepts only short, printable names for diarized speaker ids like "S1". */
export function sanitizeSpeakerNames(input: unknown): Record<string, string> {
  if (typeof input !== 'object' || input === null) return {}
  const out: Record<string, string> = {}
  for (const [id, name] of Object.entries(input as Record<string, unknown>)) {
    if (!/^S\d{1,3}$/.test(id) || typeof name !== 'string') continue
    const clean = name.replace(/[\p{Cc}<>]/gu, '').trim().slice(0, 40)
    if (clean) out[id] = clean
  }
  return out
}
