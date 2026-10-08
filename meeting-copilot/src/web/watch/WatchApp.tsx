import { useEffect, useReducer, useState } from 'react'
import type { ServerMessage } from '../../shared/protocol.ts'
import { CopilotPane } from '../components/CopilotPane.tsx'
import { Markdown } from '../components/Markdown.tsx'
import { TranscriptPane } from '../components/TranscriptPane.tsx'
import { initialState, reducer } from '../state/reducer.ts'

type Status = 'connecting' | 'live' | 'reconnecting' | 'invalid' | 'closed'

export function watchUrl(token: string): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${location.host}/ws/watch?share=${encodeURIComponent(token)}`
}

/**
 * Read-only live view opened from a shared link (?view=watch&share=…): the
 * transcript with translations, plus AI suggestions when the owner shares them.
 */
export function WatchApp() {
  const [token] = useState(() => new URLSearchParams(location.search).get('share') ?? '')
  const [state, dispatch] = useReducer(reducer, initialState)
  const [status, setStatus] = useState<Status>(token ? 'connecting' : 'invalid')

  useEffect(() => {
    if (!token) return
    let socket: WebSocket | null = null
    let retries = 0
    let opened = false
    let finished = false
    let retryTimer: number | undefined
    let pingTimer: number | undefined

    const connect = () => {
      const ws = new WebSocket(watchUrl(token))
      socket = ws
      ws.onopen = () => {
        opened = true
        pingTimer = window.setInterval(() => ws.send('{"type":"ping"}'), 20_000)
      }
      ws.onmessage = (event) => {
        if (typeof event.data !== 'string') return
        const message = JSON.parse(event.data) as ServerMessage
        if (message.type === 'snapshot') {
          retries = 0
          setStatus('live')
        }
        if (message.type === 'share.ended') {
          finished = true
          setStatus('closed')
        }
        dispatch({ type: 'server', message })
      }
      ws.onclose = () => {
        window.clearInterval(pingTimer)
        if (finished) return
        // Never accepted: the link is wrong or no longer shared.
        if (!opened && retries >= 2) return setStatus('invalid')
        if (retries >= 20) return setStatus('closed')
        setStatus('reconnecting')
        retryTimer = window.setTimeout(connect, Math.min(10_000, 500 * 2 ** retries++))
      }
    }
    connect()
    return () => {
      finished = true
      window.clearTimeout(retryTimer)
      window.clearInterval(pingTimer)
      socket?.close()
    }
  }, [token])

  const ended = state.watch?.ended
  const showSuggestions = state.suggestions.length > 0
  const outcomes = state.outcomes.data

  return (
    <div className="app watch">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">◎</span>
          <div>
            <h1>{state.watch?.title || '会议实时字幕'}</h1>
            <p className="muted small">Meeting Copilot · 只读共享</p>
          </div>
        </div>
        <div className="status">
          <span className={`pill ${status === 'live' ? 'live' : status === 'reconnecting' ? 'warn' : 'subtle'}`}>
            {status === 'live' ? '● 直播中' : status === 'reconnecting' ? '重连中…' : status === 'connecting' ? '连接中…' : '已结束'}
          </span>
        </div>
      </header>

      {status === 'invalid' && <div className="notice error">共享链接无效或已失效：请向会议发起人索取新的链接。</div>}
      {ended && <div className="notice">{ended === 'ended' ? '会议已结束。' : '发起人已停止共享。'}以下为截至此刻的内容。</div>}

      {status !== 'invalid' && (
        <main className="live">
          <div className={`panes ${showSuggestions ? '' : 'single'}`}>
            <TranscriptPane segments={state.segments} translations={state.translations} speakerNames={state.speakerNames} meSpeaker={state.meSpeaker} />
            {showSuggestions && <CopilotPane suggestions={state.suggestions} enabled canAsk={false} />}
          </div>
          {state.summary.status !== 'idle' && (
            <section className="card summary">
              <h3>会议纪要</h3>
              <Markdown text={state.summary.text} />
            </section>
          )}
          {outcomes && (outcomes.decisions.length > 0 || outcomes.actionItems.length > 0) && (
            <section className="card outcomes">
              <div className="outcomes-grid">
                <div>
                  <h4>已达成的决定</h4>
                  <ol className="decisions">
                    {outcomes.decisions.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ol>
                </div>
                <div>
                  <h4>待办事项</h4>
                  <ul className="action-items">
                    {outcomes.actionItems.map((item) => (
                      <li key={item.id}>
                        <label>
                          <span className="owner">{item.owner}</span>
                          <span className="task">{item.task}</span>
                          {item.due && <span className="due">截止 {item.due}</span>}
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>
          )}
        </main>
      )}
    </div>
  )
}
