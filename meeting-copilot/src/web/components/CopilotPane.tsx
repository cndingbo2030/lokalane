import { useState } from 'react'
import type { SuggestionKind } from '../../shared/protocol.ts'
import type { Suggestion } from '../state/reducer.ts'
import { Markdown } from './Markdown.tsx'

const KIND_LABEL: Record<SuggestionKind, string> = {
  question: '对方提问',
  objection: '对方顾虑',
  action: '待办请求',
  manual: '我问 AI',
}

interface Props {
  suggestions: Suggestion[]
  enabled: boolean
  canAsk: boolean
  onAsk: (question?: string) => void
}

export function CopilotPane({ suggestions, enabled, canAsk, onAsk }: Props) {
  const [question, setQuestion] = useState('')

  const submit = () => {
    onAsk(question.trim() || undefined)
    setQuestion('')
  }

  return (
    <section className="pane copilot" aria-label="AI 实时建议">
      <header className="pane-header">
        <h3>AI 实时建议</h3>
        {!enabled && <span className="muted small">已关闭</span>}
      </header>
      <form
        className="ask"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <input
          value={question}
          disabled={!enabled || !canAsk}
          placeholder="问 AI：例如「怎么回应这个价格异议？」（留空=针对最新发言）"
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button type="submit" className="button primary" disabled={!enabled || !canAsk}>
          立即建议
        </button>
      </form>
      <div className="pane-body" aria-live="polite">
        {enabled && suggestions.length === 0 && <p className="empty">对方提问或提出顾虑时，这里会自动出现可直接说出口的回应。</p>}
        {suggestions.map((s, index) => (
          <article key={s.id} className={`suggestion ${index === 0 ? 'latest' : ''} ${s.done ? '' : 'streaming'}`}>
            <div className="suggestion-meta">
              <span className={`kind kind-${s.trigger.kind}`}>{KIND_LABEL[s.trigger.kind]}</span>
              {s.trigger.text && <span className="quote">“{s.trigger.text}”</span>}
            </div>
            {s.text ? <Markdown text={s.text} /> : <p className="muted">思考中…</p>}
            {s.error && <p className="error-text">{s.error === 'interrupted' ? '已被新的请求打断' : s.error}</p>}
          </article>
        ))}
      </div>
    </section>
  )
}
