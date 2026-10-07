import { useEffect, useRef } from 'react'
import type { TranscriptSegment } from '../../shared/protocol.ts'
import { formatClock } from '../state/reducer.ts'

interface Props {
  segments: TranscriptSegment[]
  translations: Record<string, string>
}

export function TranscriptPane({ segments, translations }: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  useEffect(() => {
    const el = scroller.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [segments, translations])

  return (
    <section className="pane transcript" aria-label="实时字幕">
      <header className="pane-header">
        <h3>实时字幕</h3>
        <span className="muted small">{segments.filter((s) => s.isFinal).length} 句</span>
      </header>
      <div
        className="pane-body"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
        }}
      >
        {segments.length === 0 && <p className="empty">等待有人发言…</p>}
        {segments.map((segment) => (
          <article key={segment.id} className={`line ${segment.source} ${segment.isFinal ? '' : 'partial'}`}>
            <div className="line-meta">
              <span className="who">{segment.source === 'me' ? '我' : segment.speaker ? `对方 ${segment.speaker}` : '对方'}</span>
              <span className="time">{formatClock(segment.startMs)}</span>
            </div>
            <p className="text">{segment.text}</p>
            {translations[segment.id] && <p className="translation">{translations[segment.id]}</p>}
          </article>
        ))}
      </div>
    </section>
  )
}
