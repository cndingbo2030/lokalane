import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { parseMeetingLink } from '../shared/meetingLink.ts'
import { encodeAudioFrame, type AudioSource, type SessionConfig } from '../shared/protocol.ts'
import { AudioEngine, CaptureError } from './audio/engine.ts'
import { CopilotPane } from './components/CopilotPane.tsx'
import { Markdown } from './components/Markdown.tsx'
import { defaultForm, SetupPanel, type SetupForm } from './components/SetupPanel.tsx'
import { TranscriptPane } from './components/TranscriptPane.tsx'
import { CopilotConnection, serverUrl, type ConnectionStatus } from './net/connection.ts'
import { initialState, reducer, transcriptToMarkdown } from './state/reducer.ts'

const FORM_KEY = 'meeting-copilot:form'
const timestamp = () => Date.now()

function loadForm(): SetupForm {
  try {
    const saved = localStorage.getItem(FORM_KEY)
    // Consent is per meeting and the link is per meeting: never restore them.
    if (saved) return { ...defaultForm, ...(JSON.parse(saved) as Partial<SetupForm>), consent: false, link: '' }
  } catch {
    // storage unavailable
  }
  return defaultForm
}

function saveForm(form: SetupForm): void {
  try {
    const persisted: Partial<SetupForm> = { ...form }
    delete persisted.consent
    delete persisted.link
    localStorage.setItem(FORM_KEY, JSON.stringify(persisted))
  } catch {
    // storage unavailable
  }
}

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [form, setForm] = useState<SetupForm>(loadForm)
  const [connection, setConnection] = useState<ConnectionStatus>('closed')
  const [levels, setLevels] = useState<Record<AudioSource, number>>({ me: 0, remote: 0 })
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [demo, setDemo] = useState(false)

  const connectionRef = useRef<CopilotConnection | null>(null)
  const engineRef = useRef<AudioEngine | null>(null)
  const levelBuffer = useRef<Record<AudioSource, number>>({ me: 0, remote: 0 })

  const parsed = useMemo(() => parseMeetingLink(form.link), [form.link])

  useEffect(() => saveForm(form), [form])

  useEffect(() => {
    if (state.phase !== 'live') return
    const timer = window.setInterval(() => {
      setNow(timestamp())
      setLevels({ ...levelBuffer.current })
    }, 200)
    return () => window.clearInterval(timer)
  }, [state.phase])

  useEffect(() => {
    return () => {
      connectionRef.current?.close()
      void engineRef.current?.stop()
    }
  }, [])

  useEffect(() => {
    return () => {
      if (recordingUrl) URL.revokeObjectURL(recordingUrl)
    }
  }, [recordingUrl])

  const buildConfig = (): SessionConfig => ({
    meetingUrl: parsed?.url,
    platform: parsed?.platform ?? 'unknown',
    spokenLanguages: form.spokenLanguages,
    targetLanguage: form.targetLanguage,
    translate: form.translate,
    copilot: { enabled: form.copilot, autoTrigger: form.autoTrigger },
    brief: { myRole: form.myRole, goal: form.goal, context: form.context },
  })

  const openConnection = (config: SessionConfig, onOpen?: () => void) => {
    let opened = false
    const conn = new CopilotConnection(serverUrl(), { type: 'start', config }, {
      onMessage: (message) => dispatch({ type: 'server', message }),
      onStatus: (status) => {
        setConnection(status)
        if (status === 'open' && !opened) {
          opened = true
          onOpen?.()
        }
      },
    })
    connectionRef.current = conn
    conn.connect()
    return conn
  }

  const start = async () => {
    dispatch({ type: 'reset' })
    dispatch({ type: 'phase', phase: 'connecting' })
    setRecordingUrl(null)
    setDemo(false)

    const engine = new AudioEngine()
    try {
      // Ask for capture first: the browser picker must be opened from the click gesture.
      const conn = openConnection(buildConfig())
      await engine.start(
        form.mode,
        {
          onFrame: (source, pcm) => conn.sendAudio(encodeAudioFrame(source, pcm)),
          onLevel: (source, level) => {
            levelBuffer.current[source] = Math.max(level, levelBuffer.current[source] * 0.6)
          },
          onEnded: () => void stop(),
        },
        form.record,
      )
      engineRef.current = engine
      setStartedAt(timestamp())
    } catch (error) {
      connectionRef.current?.close()
      connectionRef.current = null
      await engine.stop()
      dispatch({ type: 'phase', phase: 'setup' })
      dispatch({ type: 'error', message: error instanceof CaptureError ? error.message : `无法开始：${String(error)}` })
    }
  }

  const startDemo = () => {
    dispatch({ type: 'reset' })
    dispatch({ type: 'phase', phase: 'connecting' })
    setRecordingUrl(null)
    setDemo(true)
    setStartedAt(timestamp())
    openConnection({ ...buildConfig(), platform: 'unknown' }, () => connectionRef.current?.send({ type: 'demo' }))
  }

  const stop = async () => {
    const engine = engineRef.current
    engineRef.current = null
    connectionRef.current?.send({ type: 'stop' })
    dispatch({ type: 'phase', phase: 'ended' })
    if (engine) {
      const blob = await engine.stop()
      if (blob && blob.size > 0) setRecordingUrl(URL.createObjectURL(blob))
    }
  }

  const newMeeting = () => {
    connectionRef.current?.close()
    connectionRef.current = null
    setStartedAt(null)
    setRecordingUrl(null)
    setForm((f) => ({ ...f, consent: false, link: '' }))
    dispatch({ type: 'reset' })
  }

  const downloadTranscript = () => {
    const blob = new Blob([transcriptToMarkdown(state) + (state.summary.text ? `\n\n---\n\n${state.summary.text}\n` : '')], {
      type: 'text/markdown;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `meeting-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const inMeeting = state.phase === 'connecting' || state.phase === 'live' || state.phase === 'ended'
  const elapsed = startedAt ? Math.floor((now - startedAt) / 1000) : 0

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">◎</span>
          <div>
            <h1>Meeting Copilot</h1>
            <p className="muted small">录音 · 实时字幕 · 同声翻译 · AI 实时应答</p>
          </div>
        </div>
        <div className="status">
          {inMeeting && (
            <>
              <span className={`pill ${state.phase === 'live' ? 'live' : ''}`}>
                {state.phase === 'connecting' ? '连接中' : state.phase === 'live' ? `● ${demo ? '演示中' : '进行中'} ${formatElapsed(elapsed)}` : '已结束'}
              </span>
              {connection === 'reconnecting' && <span className="pill warn">重连中…</span>}
              {state.stt && (
                <span className="pill subtle" title="语音识别 / 大模型">
                  {state.stt} · {state.llm}
                </span>
              )}
            </>
          )}
        </div>
      </header>

      {state.errors.length > 0 && (
        <div className="errors" role="alert">
          {state.errors.map((e) => (
            <div key={e.id} className="error">
              <span>{e.message}</span>
              <button type="button" aria-label="关闭" onClick={() => dispatch({ type: 'dismissError', id: e.id })}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {!inMeeting && (
        <SetupPanel form={form} onChange={setForm} parsed={parsed} busy={false} onStart={() => void start()} onDemo={startDemo} />
      )}

      {inMeeting && (
        <main className="live">
          <div className="controls card">
            {!demo && state.phase === 'live' && (
              <div className="meters">
                {form.mode === 'tab' && <Meter label="我" level={levels.me} />}
                <Meter label={form.mode === 'tab' ? '会议' : '现场'} level={levels.remote} />
              </div>
            )}
            <div className="actions">
              {state.phase !== 'ended' ? (
                <button type="button" className="button danger" onClick={() => void stop()}>
                  结束会议
                </button>
              ) : (
                <button type="button" className="button secondary" onClick={newMeeting}>
                  新会议
                </button>
              )}
              <button
                type="button"
                className="button primary"
                disabled={state.summary.status === 'streaming' || !state.segments.some((s) => s.isFinal) || !state.sessionId}
                onClick={() => connectionRef.current?.send({ type: 'summary' })}
              >
                {state.summary.status === 'streaming' ? '生成中…' : '生成会议纪要'}
              </button>
              <button type="button" className="button secondary" disabled={!state.segments.length} onClick={downloadTranscript}>
                导出逐字稿
              </button>
              {recordingUrl && (
                <a className="button secondary" href={recordingUrl} download="meeting-recording.webm">
                  下载录音
                </a>
              )}
            </div>
          </div>

          <div className="panes">
            <TranscriptPane segments={state.segments} translations={state.translations} />
            <CopilotPane
              suggestions={state.suggestions}
              enabled={form.copilot}
              canAsk={state.phase !== 'connecting' && Boolean(state.sessionId)}
              onAsk={(question) => connectionRef.current?.send({ type: 'ask', question })}
            />
          </div>

          {state.summary.status !== 'idle' && (
            <section className="card summary">
              <h3>会议纪要</h3>
              <Markdown text={state.summary.text} />
              {state.summary.error && <p className="error-text">{state.summary.error}</p>}
            </section>
          )}
        </main>
      )}
    </div>
  )
}

function Meter({ label, level }: { label: string; level: number }) {
  const pct = Math.min(100, Math.round(Math.sqrt(level) * 220))
  return (
    <div className="meter" aria-label={`${label} 音量`}>
      <span>{label}</span>
      <div className="meter-track">
        <div className="meter-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
