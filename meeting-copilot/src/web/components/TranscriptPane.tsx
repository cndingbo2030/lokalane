import { useEffect, useRef, useState } from 'react'
import type { TranscriptSegment } from '../../shared/protocol.ts'
import { formatClock, isMine, speakerDisplay } from '../state/reducer.ts'

interface Props {
  segments: TranscriptSegment[]
  translations: Record<string, string>
  speakerNames: Record<string, string>
  meSpeaker?: string
  /** When set, remote speaker labels are clickable and can be renamed. */
  onRename?: (speaker: string, name: string) => void
  /** Mark a diarized speaker as the user (or clear it with null). */
  onSetMe?: (speaker: string | null) => void
}

export function TranscriptPane({ segments, translations, speakerNames, meSpeaker, onRename, onSetMe }: Props) {
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
          {onRename && segments.some((s) => s.speaker) ? (onSetMe ? '点击说话人可改名或标记「这是我」 · ' : '点击说话人可改名 · ') : ''}
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
          <article key={segment.id} className={`line ${isMine(segment, meSpeaker) ? 'me' : 'remote'} ${segment.isFinal ? '' : 'partial'}`}>
            <div className="line-meta">
              {onRename && segment.speaker && editing === segment.id ? (
                <>
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
                  {onSetMe && (
                    <button
                      type="button"
                      className="link-button me-toggle"
                      // Before the input's blur closes the editor.
                      onMouseDown={(e) => {
                        e.preventDefault()
                        onSetMe(segment.speaker === meSpeaker ? null : segment.speaker!)
                        setEditing(null)
                      }}
                    >
                      {segment.speaker === meSpeaker ? '不是我' : '这是我'}
                    </button>
                  )}
                </>
              ) : onRename && segment.speaker ? (
                <button type="button" className="who who-button" title={onSetMe ? '修改说话人名字，或标记「这是我」' : '点击修改说话人名字'} onClick={() => setEditing(segment.id)}>
                  {speakerDisplay(segment, speakerNames, meSpeaker)}
                </button>
              ) : (
                <span className="who">{speakerDisplay(segment, speakerNames, meSpeaker)}</span>
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
