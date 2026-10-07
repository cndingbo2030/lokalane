import { useEffect, useRef, useState } from 'react'
import type { TranscriptSegment } from '../../shared/protocol.ts'
import { formatClock, speakerDisplay } from '../state/reducer.ts'

interface Props {
  segments: TranscriptSegment[]
  translations: Record<string, string>
  speakerNames: Record<string, string>
  /** When set, remote speaker labels are clickable and can be renamed. */
  onRename?: (speaker: string, name: string) => void
}

export function TranscriptPane({ segments, translations, speakerNames, onRename }: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const [editing, setEditing] = useState<string | null>(null)

  useEffect(() => {
    const el = scroller.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [segments, translations])

  return (
    <section className="pane transcript" aria-label="实时字幕">
      <header className="pane-header">
        <h3>实时字幕</h3>
        <span className="muted small">
          {onRename && segments.some((s) => s.speaker) ? '点击说话人可改名 · ' : ''}
          {segments.filter((s) => s.isFinal).length} 句
        </span>
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
              {onRename && segment.speaker && editing === segment.id ? (
                <input
                  className="rename"
                  autoFocus
                  defaultValue={speakerNames[segment.speaker] ?? ''}
                  placeholder={`${segment.speaker} 的名字`}
                  aria-label={`${segment.speaker} 的名字`}
                  onBlur={(e) => {
                    onRename(segment.speaker!, e.currentTarget.value)
                    setEditing(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') setEditing(null)
                  }}
                />
              ) : onRename && segment.speaker ? (
                <button type="button" className="who who-button" title="点击修改说话人名字" onClick={() => setEditing(segment.id)}>
                  {speakerDisplay(segment, speakerNames)}
                </button>
              ) : (
                <span className="who">{speakerDisplay(segment, speakerNames)}</span>
              )}
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
