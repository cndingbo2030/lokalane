import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CalendarEvent } from '../shared/calendar.ts'
import { parseMeetingLink } from '../shared/meetingLink.ts'
import { encodeAudioFrame, type AudioSource, type FeedbackRating, type MeetingPlatform, type SessionConfig } from '../shared/protocol.ts'
import { AudioEngine, CaptureError } from './audio/engine.ts'
import { botHint, botLabel, fetchServerInfo, isBotFinished, type ServerInfo } from './bot.ts'
import { mergeBriefIntoForm, requestBrief, stripGenerated } from './brief.ts'
import { formatEventTime } from './calendar/feeds.ts'
import { useCalendar } from './calendar/useCalendar.ts'
import { CopilotPane } from './components/CopilotPane.tsx'
import { DesktopSettingsPanel } from './components/DesktopSettingsPanel.tsx'
import { HistoryPanel, MeetingViewer } from './components/HistoryPanel.tsx'
import { IntegrationsPanel } from './components/IntegrationsManager.tsx'
import { Markdown } from './components/Markdown.tsx'
import { MetricsBar } from './components/MetricsBar.tsx'
import { OutcomesPanel, type OutcomesContext } from './components/OutcomesPanel.tsx'
import { defaultForm, SetupPanel, type SetupForm } from './components/SetupPanel.tsx'
import { SharePanel } from './components/SharePanel.tsx'
import { TranscriptPane } from './components/TranscriptPane.tsx'
import { UpcomingPanel } from './components/UpcomingPanel.tsx'
import { desktop } from './desktop.ts'
import { meetingHistory } from './history/db.ts'
import { buildRecord, PLATFORM_TITLES, relatedMeetings, titleFromSummary, type MeetingRecord } from './history/model.ts'
import { CopilotConnection, serverUrl, type ConnectionStatus } from './net/connection.ts'
import { downloadFile } from './outcomes/export.ts'
import { useIntegrations } from './outcomes/useIntegrations.ts'
import { deriveOverlayState } from './overlay/overlayState.ts'
import { OverlayView } from './overlay/OverlayView.tsx'
import { usePictureInPicture } from './overlay/usePictureInPicture.ts'
import { initialState, reducer, transcriptToMarkdown } from './state/reducer.ts'

const FORM_KEY = 'meeting-copilot:form'
const timestamp = () => Date.now()

function loadForm(): SetupForm {
  try {
    const saved = localStorage.getItem(FORM_KEY)
    // Consent is per meeting and the link is per meeting: never restore them.
    if (saved) {
      const form = { ...defaultForm, ...(JSON.parse(saved) as Partial<SetupForm>), consent: false, link: '' }
      // System audio capture only exists in the desktop app.
      return !desktop && form.mode === 'system' ? { ...form, mode: 'tab' } : form
    }
  } catch {
    // storage unavailable
  }
  return desktop ? { ...defaultForm, mode: 'system' } : defaultForm
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

interface MeetingMeta {
  platform: MeetingPlatform
  startedAt: number
  endedAt?: number
  demo: boolean
  /** A meeting bot joined the call (no capture on this device). */
  bot?: boolean
  /** The calendar meeting it was prepared from. */
  event?: CalendarEvent
}

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [form, setForm] = useState<SetupForm>(loadForm)
  const [connection, setConnection] = useState<ConnectionStatus>('closed')
  const [levels, setLevels] = useState<Record<AudioSource, number>>({ me: 0, remote: 0 })
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null)
  const [meeting, setMeeting] = useState<MeetingMeta | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [history, setHistory] = useState<MeetingRecord[]>([])
  const [viewing, setViewing] = useState<MeetingRecord | null>(null)
  const [preparedEvent, setPreparedEvent] = useState<CalendarEvent | null>(null)
  const [briefStatus, setBriefStatus] = useState<{ status: 'idle' | 'loading' | 'done' | 'error'; message?: string }>({ status: 'idle' })
  const { integrations, setIntegrations } = useIntegrations()
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null)
  const [shareOpen, setShareOpen] = useState(false)

  const connectionRef = useRef<CopilotConnection | null>(null)
  const engineRef = useRef<AudioEngine | null>(null)
  const levelBuffer = useRef<Record<AudioSource, number>>({ me: 0, remote: 0 })

  const parsed = useMemo(() => parseMeetingLink(form.link), [form.link])
  const botAvailable = serverInfo?.bot.enabled ?? false
  // A saved "bot" choice falls back when this server cannot send bots.
  const mode = form.mode === 'bot' && !botAvailable ? (desktop ? 'system' : 'tab') : form.mode

  /** Fill the setup from a calendar meeting; optionally open the meeting itself. */
  const prepare = (event: CalendarEvent, join = false) => {
    setPreparedEvent(event)
    setBriefStatus({ status: 'idle' })
    setViewing(null)
    if (event.meeting) setForm((f) => ({ ...f, link: event.meeting!.url }))
    // Browser: opens the web client in a new tab. Desktop: the OS opens the native meeting app.
    if (join && event.meeting) window.open(event.meeting.url, '_blank', 'noopener')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const calendar = useCalendar((event) => prepare(event, true))

  const generateBrief = async () => {
    setBriefStatus({ status: 'loading' })
    try {
      const related = preparedEvent ? relatedMeetings(history, preparedEvent) : []
      const draft = await requestBrief({
        event: preparedEvent
          ? {
              title: preparedEvent.title,
              start: preparedEvent.start,
              end: preparedEvent.end,
              description: preparedEvent.description,
              location: preparedEvent.location,
              organizer: preparedEvent.organizer,
              attendees: preparedEvent.attendees,
            }
          : undefined,
        meetingUrl: parsed?.url,
        notes: { myRole: form.myRole, goal: form.goal, context: stripGenerated(form.context) },
        pastMeetings: related.map((record) => ({
          title: record.title,
          date: new Date(record.startedAt).toISOString().slice(0, 10),
          summary: record.summary,
          openActionItems: (record.outcomes?.actionItems ?? []).filter((item) => !item.done).map((item) => `${item.owner}：${item.task}`),
        })),
        documents: form.documents,
        targetLanguage: form.targetLanguage,
      })
      setForm((f) => mergeBriefIntoForm(f, draft))
      setBriefStatus({ status: 'done', message: related.length ? `参考了 ${related.length} 场历史会议` : undefined })
    } catch (error) {
      setBriefStatus({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }
  const prepareFromCalendar = (event: CalendarEvent, join = false) => {
    prepare(event, join)
    if (calendar.reminder?.id === event.id) calendar.dismissReminder()
  }
  const overlayState = useMemo(() => deriveOverlayState(state), [state])
  const pip = usePictureInPicture()
  const ask = () => connectionRef.current?.send({ type: 'ask' })

  useEffect(() => saveForm(form), [form])

  // Desktop: mirror the prompter into the always-on-top overlay window.
  useEffect(() => {
    if (!desktop) return
    desktop.publishOverlay(overlayState)
  }, [overlayState])

  useEffect(() => {
    desktop?.setOverlayVisible(state.phase === 'live' || state.phase === 'connecting')
  }, [state.phase])

  // Desktop: global hotkeys and overlay buttons.
  useEffect(
    () =>
      desktop?.onAction((action) => {
        if (action.type === 'ask') connectionRef.current?.send({ type: 'ask' })
      }),
    [],
  )

  useEffect(() => {
    meetingHistory
      .list()
      .then(setHistory)
      .catch(() => {})
    void fetchServerInfo().then(setServerInfo)
  }, [])

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

  // Save the finished meeting locally; re-save as the summary and feedback arrive.
  useEffect(() => {
    if (state.phase !== 'ended' || !meeting?.endedAt || !form.saveHistory || !state.sessionId) return
    if (!state.segments.some((s) => s.isFinal)) return
    const record = buildRecord(state, {
      id: state.sessionId,
      platform: meeting.platform,
      startedAt: meeting.startedAt,
      endedAt: meeting.endedAt,
      targetLanguage: form.targetLanguage,
      seriesId: meeting.event?.seriesId,
      eventTitle: meeting.event?.title,
      attendees: meeting.event?.attendees.map((a) => a.name ?? a.email ?? '').filter(Boolean),
      attendeeEmails: meeting.event?.attendees.map((a) => a.email ?? '').filter(Boolean),
    }, { demo: meeting.demo })
    const timer = window.setTimeout(() => {
      meetingHistory
        .save(record)
        .then(() => setHistory((h) => [record, ...h.filter((r) => r.id !== record.id)]))
        .catch(() => {})
    }, 500)
    return () => window.clearTimeout(timer)
  }, [state, meeting, form.saveHistory, form.targetLanguage])

  const buildConfig = (bot = false): SessionConfig => ({
    meetingUrl: parsed?.url,
    platform: parsed?.platform ?? 'unknown',
    spokenLanguages: form.spokenLanguages,
    targetLanguage: form.targetLanguage,
    translate: form.translate,
    copilot: { enabled: form.copilot, autoTrigger: form.autoTrigger },
    brief: { myRole: form.myRole, goal: form.goal, context: form.context },
    documents: form.documents,
    meeting: preparedEvent
      ? { title: preparedEvent.title, attendees: preparedEvent.attendees.map((a) => a.name ?? a.email ?? '').filter(Boolean) }
      : undefined,
    // Lets the outcome extraction resolve "next Friday" to a date.
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    bot: bot ? { name: form.botName } : undefined,
  })

  const openConnection = (config: SessionConfig, onOpen?: () => void) => {
    let opened = false
    // Bot meetings continue without this device, so keep trying as long as the server keeps the session.
    const options = config.bot ? { keepTryingMs: 14 * 60_000 } : {}
    const conn = new CopilotConnection(serverUrl(), { type: 'start', config }, {
      onMessage: (message) => dispatch({ type: 'server', message }),
      onStatus: (status) => {
        setConnection(status)
        if (status === 'open' && !opened) {
          opened = true
          onOpen?.()
        }
      },
    }, options)
    connectionRef.current = conn
    conn.connect()
    return conn
  }

  const beginMeeting = (demo: boolean, bot = false) => {
    dispatch({ type: 'reset' })
    dispatch({ type: 'phase', phase: 'connecting' })
    setRecordingUrl(null)
    setMeeting({ platform: demo ? 'unknown' : (parsed?.platform ?? 'unknown'), startedAt: timestamp(), demo, bot, event: preparedEvent ?? undefined })
  }

  const start = async () => {
    if (mode === 'bot') {
      // The server sends the bot; this device only shows the live results.
      beginMeeting(false, true)
      openConnection(buildConfig(true))
      return
    }
    beginMeeting(false)
    const engine = new AudioEngine()
    try {
      // Open the connection first, synchronously: the capture picker must open from the click gesture.
      const conn = openConnection(buildConfig())
      await engine.start(
        mode,
        {
          onFrame: (source, pcm, captureMs) => conn.sendAudio(encodeAudioFrame(source, pcm, captureMs)),
          onLevel: (source, level) => {
            levelBuffer.current[source] = Math.max(level, levelBuffer.current[source] * 0.6)
          },
          onEnded: () => void stop(),
        },
        { record: form.record, vad: form.vad },
      )
      engineRef.current = engine
      setMeeting((m) => (m ? { ...m, startedAt: timestamp() } : m))
    } catch (error) {
      connectionRef.current?.close()
      connectionRef.current = null
      await engine.stop()
      setMeeting(null)
      dispatch({ type: 'phase', phase: 'setup' })
      dispatch({ type: 'error', message: error instanceof CaptureError ? error.message : `无法开始：${String(error)}` })
    }
  }

  const startDemo = () => {
    beginMeeting(true)
    openConnection(buildConfig(), () => connectionRef.current?.send({ type: 'demo' }))
  }

  const stop = async () => {
    const engine = engineRef.current
    engineRef.current = null
    connectionRef.current?.send({ type: 'stop' })
    dispatch({ type: 'phase', phase: 'ended' })
    setMeeting((m) => (m ? { ...m, endedAt: timestamp() } : m))
    if (engine) {
      const blob = await engine.stop()
      if (blob && blob.size > 0) setRecordingUrl(URL.createObjectURL(blob))
    }
  }

  // Bot mode: the meeting is over for us once the bot has left (host removed it, meeting ended) or failed.
  const botFinished = state.phase === 'live' && Boolean(meeting?.bot) && isBotFinished(state.bot?.state)
  useEffect(() => {
    if (!botFinished) return
    const timer = window.setTimeout(() => void stop(), 0)
    return () => window.clearTimeout(timer)
  })

  const newMeeting = () => {
    pip.close()
    setShareOpen(false)
    setPreparedEvent(null)
    connectionRef.current?.close()
    connectionRef.current = null
    setMeeting(null)
    setRecordingUrl(null)
    setForm((f) => ({ ...f, consent: false, link: '' }))
    dispatch({ type: 'reset' })
  }

  const renameSpeaker = (speaker: string, name: string) => {
    const names = { ...state.speakerNames }
    if (name.trim()) names[speaker] = name.trim()
    else delete names[speaker]
    dispatch({ type: 'renameSpeaker', speaker, name })
    connectionRef.current?.send({ type: 'speakers', names, me: state.meSpeaker })
  }

  const setMeSpeaker = (speaker: string | null) => {
    dispatch({ type: 'setMeSpeaker', speaker })
    connectionRef.current?.send({ type: 'speakers', names: state.speakerNames, me: speaker ?? undefined })
  }

  const rate = (id: string, rating: FeedbackRating | null) => {
    dispatch({ type: 'rate', id, rating })
    connectionRef.current?.send({ type: 'feedback', suggestionId: id, rating })
  }

  const downloadTranscript = () => {
    downloadFile(
      `meeting-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.md`,
      transcriptToMarkdown(state) + (state.summary.text ? `\n\n---\n\n${state.summary.text}\n` : ''),
      'text/markdown;charset=utf-8',
    )
  }

  const deleteRecord = (record: MeetingRecord) => {
    setViewing(null)
    setHistory((h) => h.filter((r) => r.id !== record.id))
    meetingHistory.remove(record.id).catch(() => {})
  }

  const updateRecord = (record: MeetingRecord) => {
    setViewing(record)
    setHistory((h) => h.map((r) => (r.id === record.id ? record : r)))
    meetingHistory.save(record).catch(() => {})
  }

  const outcomesContext = useMemo<OutcomesContext>(
    () => ({
      id: state.sessionId ?? 'meeting',
      title: meeting?.event?.title || titleFromSummary(state.summary.text) || (meeting?.demo ? '演示会议' : PLATFORM_TITLES[meeting?.platform ?? 'unknown']),
      startedAt: meeting?.startedAt ?? 0,
      endedAt: meeting?.endedAt,
      attendees: meeting?.event?.attendees.map((a) => a.name ?? a.email ?? '').filter(Boolean) ?? [],
      attendeeEmails: meeting?.event?.attendees.map((a) => a.email ?? '').filter(Boolean) ?? [],
      language: form.targetLanguage,
      summary: state.summary.status === 'done' ? state.summary.text : '',
    }),
    [state.sessionId, state.summary.status, state.summary.text, meeting, form.targetLanguage],
  )

  const inMeeting = state.phase === 'connecting' || state.phase === 'live' || state.phase === 'ended'
  const elapsed = meeting ? Math.max(0, Math.floor(((meeting.endedAt ?? now) - meeting.startedAt) / 1000)) : 0
  const demo = meeting?.demo ?? false

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
              {meeting?.bot && state.bot && (
                <span className={`pill ${state.bot.state === 'joined_recording' ? 'live' : isBotFinished(state.bot.state) ? 'subtle' : 'warn'}`}>
                  🤖 {botLabel(state.bot.state)}
                </span>
              )}
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

      {inMeeting && meeting?.bot && state.bot && botBanner(botHint(state.bot, form.botName))}

      {!inMeeting && viewing && (
        <MeetingViewer
          record={viewing}
          onClose={() => setViewing(null)}
          onDelete={deleteRecord}
          onUpdate={updateRecord}
          integrations={integrations}
          onIntegrationsChange={setIntegrations}
        />
      )}

      {!inMeeting && calendar.reminder && (
        <div className="reminder" role="status">
          <span>
            ⏰ 「{calendar.reminder.title}」{formatEventTime(calendar.reminder)}
          </span>
          <div className="actions">
            <button type="button" className="button secondary" onClick={() => prepareFromCalendar(calendar.reminder!)}>
              准备
            </button>
            {calendar.reminder.meeting && (
              <button type="button" className="button secondary" onClick={() => prepareFromCalendar(calendar.reminder!, true)}>
                加入并准备
              </button>
            )}
            <button type="button" className="button secondary" onClick={calendar.dismissReminder}>
              忽略
            </button>
          </div>
        </div>
      )}

      {!inMeeting && !viewing && (
        <>
          <UpcomingPanel
            feeds={calendar.feeds}
            onFeedsChange={calendar.setFeeds}
            events={calendar.events}
            errors={calendar.errors}
            loading={calendar.loading}
            preparedId={preparedEvent?.id}
            onRefresh={() => void calendar.refresh()}
            onPrepare={prepareFromCalendar}
            notifications={calendar.permission}
            onEnableNotifications={() => void calendar.enableNotifications()}
          />
          <SetupPanel
            form={mode === form.mode ? form : { ...form, mode }}
            onChange={setForm}
            parsed={parsed}
            busy={false}
            onStart={() => void start()}
            onDemo={startDemo}
            desktop={Boolean(desktop)}
            botAvailable={botAvailable}
            linkedEvent={preparedEvent ? { title: preparedEvent.title, when: formatEventTime(preparedEvent), attendees: preparedEvent.attendees.length } : null}
            onUnlinkEvent={() => setPreparedEvent(null)}
            onGenerateBrief={() => void generateBrief()}
            briefStatus={briefStatus}
          />
          <IntegrationsPanel integrations={integrations} onChange={setIntegrations} language={form.targetLanguage} />
          <DesktopSettingsPanel />
          <HistoryPanel records={history} onOpen={setViewing} />
        </>
      )}

      {inMeeting && (
        <main className="live">
          <div className="controls card">
            <div className="controls-left">
              {!demo && !meeting?.bot && state.phase === 'live' && (
                <div className="meters">
                  {form.mode !== 'mic-only' && <Meter label="我" level={levels.me} />}
                  <Meter label={form.mode === 'mic-only' ? '现场' : '会议'} level={levels.remote} />
                </div>
              )}
              <MetricsBar metrics={state.metrics} elapsedSeconds={elapsed} />
            </div>
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
              {!desktop && (
                <button
                  type="button"
                  className={`button secondary ${state.share?.token ? 'on' : ''}`}
                  disabled={!state.sessionId}
                  onClick={() => setShareOpen((open) => !open)}
                  title="生成只读链接，让同事实时查看字幕和翻译"
                >
                  {state.share?.token ? `共享中${state.share.viewers ? ` · ${state.share.viewers} 人` : ''}` : '共享'}
                </button>
              )}
              {!desktop && pip.supported && (
                <button type="button" className="button secondary" onClick={() => void pip.open()} title="置顶的小窗口：看会议时也能看到建议">
                  画中画提词器
                </button>
              )}
              {recordingUrl && (
                <a className="button secondary" href={recordingUrl} download="meeting-recording.webm">
                  下载录音
                </a>
              )}
              {state.bot?.recordingUrl && (
                <a className="button secondary" href={state.bot.recordingUrl} target="_blank" rel="noopener noreferrer" title="机器人录制的音频（链接短时间内有效）">
                  下载录音
                </a>
              )}
            </div>
          </div>

          {shareOpen && (
            <SharePanel
              share={state.share}
              onChange={(enabled, includeSuggestions) => connectionRef.current?.send({ type: 'share', enabled, includeSuggestions })}
            />
          )}

          <div className="panes">
            <TranscriptPane
              segments={state.segments}
              translations={state.translations}
              speakerNames={state.speakerNames}
              meSpeaker={state.meSpeaker}
              onRename={renameSpeaker}
              onSetMe={setMeSpeaker}
            />
            <CopilotPane
              suggestions={state.suggestions}
              enabled={form.copilot}
              canAsk={state.phase !== 'connecting' && Boolean(state.sessionId)}
              onAsk={(question) => connectionRef.current?.send({ type: 'ask', question })}
              onRate={rate}
            />
          </div>

          {pip.container &&
            createPortal(<OverlayView state={overlayState} onAsk={ask} />, pip.container)}

          {state.summary.status !== 'idle' && (
            <section className="card summary">
              <h3>会议纪要</h3>
              <Markdown text={state.summary.text} />
              {state.summary.error && <p className="error-text">{state.summary.error}</p>}
            </section>
          )}

          <OutcomesPanel
            status={state.outcomes.status}
            outcomes={state.outcomes.data}
            error={state.outcomes.error}
            context={outcomesContext}
            onToggle={(id) => dispatch({ type: 'toggleActionItem', id })}
            integrations={integrations}
            onIntegrationsChange={setIntegrations}
            autoSend
          />
        </main>
      )}
    </div>
  )
}

function botBanner(hint: ReturnType<typeof botHint>) {
  if (!hint) return null
  return (
    <div className={`notice ${hint.tone}`} role="status">
      {hint.text}
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
