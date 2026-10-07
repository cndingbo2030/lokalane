import { languageName } from '../../shared/language.ts'
import type { OverlayState } from '../../shared/desktop.ts'
import { Markdown } from '../components/Markdown.tsx'

interface Props {
  state: OverlayState
  onAsk: () => void
  /** Desktop overlay only: hide the floating window. */
  onHide?: () => void
}

/** The floating prompter: glanceable while looking at the meeting, not at this app. */
export function OverlayView({ state, onAsk, onHide }: Props) {
  const { lastRemote, suggestion } = state
  return (
    <div className="overlay">
      <header className="overlay-header">
        <span className={`overlay-dot ${state.phase === 'live' ? 'live' : ''}`} aria-hidden="true" />
        <span className="overlay-title">{state.phase === 'live' ? '会议进行中' : state.phase === 'ended' ? '会议已结束' : '等待会议开始'}</span>
        <button type="button" className="overlay-button primary" onClick={onAsk} disabled={state.phase !== 'live'} title="立即生成建议（Ctrl/⌘ + Shift + Space）">
          立即建议
        </button>
        {onHide && (
          <button type="button" className="overlay-button" onClick={onHide} aria-label="隐藏提词器" title="隐藏（Ctrl/⌘ + Shift + O）">
            ×
          </button>
        )}
      </header>
      {lastRemote && (
        <section className="overlay-remote" aria-label="对方最新发言">
          <span className="overlay-speaker">{lastRemote.speaker}</span>
          <p>{lastRemote.text}</p>
          {lastRemote.translation && <p className="overlay-translation">{lastRemote.translation}</p>}
        </section>
      )}
      <section className="overlay-suggestion" aria-live="polite" aria-label="AI 建议">
        {suggestion ? (
          <>
            <div className="overlay-meta">
              <span>{suggestion.kind}</span>
              {suggestion.replyLanguage && <span className="reply-lang">用 {languageName(suggestion.replyLanguage, 'native')} 回复</span>}
            </div>
            {suggestion.text ? <Markdown text={suggestion.text} /> : <p className="muted">思考中…</p>}
          </>
        ) : (
          <p className="muted">对方提问或提出顾虑时，建议会出现在这里。</p>
        )}
      </section>
    </div>
  )
}
