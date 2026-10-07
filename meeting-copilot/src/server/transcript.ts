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

export function speakerLabel(segment: TranscriptSegment): string {
  if (segment.source === 'me') return '我(ME)'
  return segment.speaker ? `对方(${segment.speaker})` : '对方'
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

export function formatTranscript(segments: readonly TranscriptSegment[]): string {
  return segments.map((s) => `[${formatTimestamp(s.startMs)}] ${speakerLabel(s)}: ${s.text}`).join('\n')
}
