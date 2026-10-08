import { useState, type Dispatch, type SetStateAction } from 'react'
import { LANGUAGE_NAMES } from '../../shared/language.ts'
import type { ParsedMeetingLink } from '../../shared/meetingLink.ts'
import { BOT_PLATFORMS, type DocumentRef, type LanguageCode } from '../../shared/protocol.ts'
import type { CaptureMode } from '../audio/engine.ts'
import { deleteDocument, uploadDocument } from '../net/api.ts'

export interface SetupForm {
  link: string
  /** `bot`: a meeting bot joins the call and streams its audio (no capture on this device). */
  mode: CaptureMode | 'bot'
  /** The bot's display name in the meeting. */
  botName: string
  spokenLanguages: LanguageCode[]
  targetLanguage: Exclude<LanguageCode, 'auto'>
  translate: boolean
  copilot: boolean
  autoTrigger: boolean
  record: boolean
  /** Skip streaming silence to STT (client-side VAD). */
  vad: boolean
  /** Save finished meetings to this browser's history (IndexedDB). */
  saveHistory: boolean
  documents: DocumentRef[]
  myRole: string
  goal: string
  context: string
  consent: boolean
}

export const defaultForm: SetupForm = {
  link: '',
  mode: 'tab',
  botName: 'Meeting Copilot',
  spokenLanguages: ['zh', 'en'],
  targetLanguage: 'zh',
  translate: true,
  copilot: true,
  autoTrigger: true,
  record: true,
  vad: true,
  saveHistory: true,
  documents: [],
  myRole: '',
  goal: '',
  context: '',
  consent: false,
}

const LANGS = Object.keys(LANGUAGE_NAMES) as Array<Exclude<LanguageCode, 'auto'>>

const PLATFORM_TIPS: Record<string, string> = {
  'google-meet': '在新标签页用浏览器加入 Google Meet。',
  teams: '在新标签页选择「在此浏览器上继续」加入 Teams。',
  zoom: '已改写为 Zoom 网页版链接，可直接在浏览器入会。',
  tencent: '在新标签页选择「网页入会」加入腾讯会议 / VooV。',
  unknown: '未识别的平台，仍可在新标签页打开后共享该标签页。',
}

const ACCEPT = '.pdf,.txt,.md,.markdown,.csv,application/pdf,text/plain,text/markdown,text/csv'

const START_LABELS: Record<SetupForm['mode'], string> = {
  tab: '开始：选择会议标签页',
  system: '开始：采集系统声音',
  'mic-only': '开始：使用麦克风',
  bot: '开始：派机器人入会',
}

interface Props {
  form: SetupForm
  onChange: Dispatch<SetStateAction<SetupForm>>
  parsed: ParsedMeetingLink | null
  busy: boolean
  onStart: () => void
  onDemo: () => void
  /** Running inside the desktop app: offers system-audio capture. */
  desktop?: boolean
  /** The server can send meeting bots. */
  botAvailable?: boolean
  /** The calendar meeting this setup was prepared from. */
  linkedEvent?: { title: string; when: string; attendees: number } | null
  onUnlinkEvent?: () => void
  onGenerateBrief?: () => void
  briefStatus?: { status: 'idle' | 'loading' | 'done' | 'error'; message?: string }
}

export function SetupPanel({
  form,
  onChange,
  parsed,
  busy,
  onStart,
  onDemo,
  desktop = false,
  botAvailable = false,
  linkedEvent,
  onUnlinkEvent,
  onGenerateBrief,
  briefStatus,
}: Props) {
  const set = <K extends keyof SetupForm>(key: K, value: SetupForm[K]) => onChange((f) => ({ ...f, [key]: value }))
  const [uploading, setUploading] = useState<string[]>([])
  const [uploadError, setUploadError] = useState<string | null>(null)

  const addFiles = async (files: FileList | null) => {
    setUploadError(null)
    for (const file of Array.from(files ?? [])) {
      setUploading((u) => [...u, file.name])
      try {
        const ref = await uploadDocument(file)
        onChange((f) => ({ ...f, documents: [...f.documents, ref] }))
      } catch (error) {
        setUploadError(`${file.name}：${error instanceof Error ? error.message : String(error)}`)
      } finally {
        setUploading((u) => u.filter((name) => name !== file.name))
      }
    }
  }

  const removeDocument = async (doc: DocumentRef) => {
    onChange((f) => ({ ...f, documents: f.documents.filter((d) => d.id !== doc.id) }))
    try {
      await deleteDocument(doc.id)
    } catch {
      // Already removed from the meeting; a stale server-side copy is harmless.
    }
  }
  const botLinkOk = Boolean(parsed && BOT_PLATFORMS.includes(parsed.platform))
  const toggleLanguage = (lang: Exclude<LanguageCode, 'auto'>) => {
    const has = form.spokenLanguages.includes(lang)
    const next = has ? form.spokenLanguages.filter((l) => l !== lang) : [...form.spokenLanguages, lang]
    set('spokenLanguages', next.length ? next : ['auto'])
  }

  return (
    <div className="setup">
      <section className="card">
        <h2>
          <span className="step">1</span>会议链接
        </h2>
        {linkedEvent && (
          <div className="linked-event">
            <span>
              📅 已关联：<b>{linkedEvent.title}</b> · {linkedEvent.when}
              {linkedEvent.attendees > 0 ? ` · ${linkedEvent.attendees} 位参会人` : ''}
            </span>
            {onUnlinkEvent && (
              <button type="button" className="link-button" onClick={onUnlinkEvent}>
                取消关联
              </button>
            )}
          </div>
        )}
        <textarea
          className="link-input"
          rows={2}
          placeholder="粘贴 Google Meet / Teams / Zoom / 腾讯会议 链接或整段邀请文字"
          value={form.link}
          onChange={(e) => set('link', e.target.value)}
        />
        {parsed && (
          <div className="link-result">
            <span className={`platform platform-${parsed.platform}`}>{parsed.label}</span>
            {parsed.meetingId && <span className="muted">会议号 {parsed.meetingId}</span>}
            {parsed.passcode && <span className="muted">含密码</span>}
            <p className="muted small">{PLATFORM_TIPS[parsed.platform]}</p>
            <a className="button secondary" href={parsed.url} target="_blank" rel="noopener noreferrer">
              在新标签页打开会议 ↗
            </a>
          </div>
        )}
        <div className="segmented" role="radiogroup" aria-label="采集方式">
          {desktop && (
            <button type="button" role="radio" aria-checked={form.mode === 'system'} className={form.mode === 'system' ? 'on' : ''} onClick={() => set('mode', 'system')}>
              系统声音（任意会议软件 + 麦克风）
            </button>
          )}
          <button type="button" role="radio" aria-checked={form.mode === 'tab'} className={form.mode === 'tab' ? 'on' : ''} onClick={() => set('mode', 'tab')}>
            线上会议（共享会议标签页 + 麦克风）
          </button>
          <button type="button" role="radio" aria-checked={form.mode === 'mic-only'} className={form.mode === 'mic-only' ? 'on' : ''} onClick={() => set('mode', 'mic-only')}>
            线下会议（仅麦克风）
          </button>
          {botAvailable && (
            <button type="button" role="radio" aria-checked={form.mode === 'bot'} className={form.mode === 'bot' ? 'on' : ''} onClick={() => set('mode', 'bot')}>
              会议机器人（自动入会）
            </button>
          )}
        </div>
        {form.mode === 'bot' && (
          <div className="bot-settings">
            <label>
              <span className="field-label">机器人在会议中的名称</span>
              <input value={form.botName} maxLength={60} placeholder="Meeting Copilot" onChange={(e) => set('botName', e.target.value)} />
            </label>
            <p className="muted small">
              机器人以参会者身份加入 Zoom / Google Meet / Teams，入会后在聊天中发送录音告知；本机无需共享标签页或系统声音，手机上也能查看实时字幕和建议。
              机器人听到的是整场会议（包括你），可在字幕中点「这是我」标记自己的声音。
            </p>
            {parsed && !botLinkOk && <p className="error-text">会议机器人暂不支持{parsed.label}，请改用「线上会议」模式。</p>}
          </div>
        )}
      </section>

      <section className="card">
        <h2>
          <span className="step">2</span>语言与 AI
        </h2>
        <label className="field-label">会议中会说的语言</label>
        <div className="chips">
          {LANGS.map((lang) => (
            <button
              key={lang}
              type="button"
              className={`chip ${form.spokenLanguages.includes(lang) ? 'on' : ''}`}
              aria-pressed={form.spokenLanguages.includes(lang)}
              onClick={() => toggleLanguage(lang)}
            >
              {LANGUAGE_NAMES[lang].native}
            </button>
          ))}
        </div>
        <label className="field-label" htmlFor="target">
          翻译成 / AI 建议使用
        </label>
        <select id="target" value={form.targetLanguage} onChange={(e) => set('targetLanguage', e.target.value as SetupForm['targetLanguage'])}>
          {LANGS.map((lang) => (
            <option key={lang} value={lang}>
              {LANGUAGE_NAMES[lang].native}
            </option>
          ))}
        </select>
        <div className="toggles">
          <Toggle label="实时翻译" checked={form.translate} onChange={(v) => set('translate', v)} />
          <Toggle label="AI 实时建议" checked={form.copilot} onChange={(v) => set('copilot', v)} />
          <Toggle label="对方提问/异议时自动给建议" checked={form.autoTrigger} disabled={!form.copilot} onChange={(v) => set('autoTrigger', v)} />
          <Toggle label={form.mode === 'bot' ? '录音（机器人录制，会后下载）' : '本地录音（会后下载）'} checked={form.mode === 'bot' || form.record} disabled={form.mode === 'bot'} onChange={(v) => set('record', v)} />
          <Toggle label="静音时不发送音频（节省识别费用）" checked={form.vad} onChange={(v) => set('vad', v)} />
          <Toggle label="会后保存到本机历史（不上传服务器）" checked={form.saveHistory} onChange={(v) => set('saveHistory', v)} />
        </div>
      </section>

      <section className="card wide">
        <div className="history-header">
          <h2>
            <span className="step">3</span>会前简报 <span className="muted small">（让 AI 的建议有据可依）</span>
          </h2>
          {onGenerateBrief && (
            <button
              type="button"
              className="button secondary"
              disabled={briefStatus?.status === 'loading' || !(linkedEvent || form.goal.trim() || form.context.trim())}
              title={linkedEvent ? '根据日历会议、历史会议和参考文件生成' : '先关联日历会议，或填写会议目标/背景资料'}
              onClick={onGenerateBrief}
            >
              {briefStatus?.status === 'loading' ? '正在生成…' : '✨ AI 生成会前简报'}
            </button>
          )}
        </div>
        {briefStatus?.status === 'loading' && <p className="muted small">正在根据日历、历史会议和参考文件准备简报，通常需要 10–30 秒…</p>}
        {briefStatus?.status === 'done' && (
          <p className="muted small">已生成{briefStatus.message ? `（${briefStatus.message}）` : ''}：可直接修改；「预计问题与建议回答」会在会议中供 AI 参考。重新生成只替换 AI 部分。</p>
        )}
        {briefStatus?.status === 'error' && <p className="error-text">{briefStatus.message}</p>}
        <div className="brief-grid">
          <label>
            <span className="field-label">我的角色</span>
            <input value={form.myRole} placeholder="例：Lawgorithm 创始人，负责商务谈判" onChange={(e) => set('myRole', e.target.value)} />
          </label>
          <label>
            <span className="field-label">会议目标</span>
            <input value={form.goal} placeholder="例：确认试点范围，争取本月签约" onChange={(e) => set('goal', e.target.value)} />
          </label>
        </div>
        <label>
          <span className="field-label">背景资料 / 报价 / 术语 / 常见问题</span>
          <textarea
            rows={5}
            value={form.context}
            placeholder={'例：\n企业版 SGD 2,000/月，含 5 个席位；数据驻留新加坡 AWS；已通过 ISO 27001。\n术语：NDA=保密协议；DPA=数据处理协议'}
            onChange={(e) => set('context', e.target.value)}
          />
        </label>
        <div className="documents">
          <span className="field-label">参考文件（PDF / TXT / Markdown / CSV）：AI 建议会引用并注明出处</span>
          <ul className="doc-list">
            {form.documents.map((doc) => (
              <li key={doc.id}>
                <span className="doc-kind">{doc.kind === 'pdf' ? 'PDF' : 'TXT'}</span>
                <span className="doc-name">{doc.name}</span>
                <span className="muted small">{formatBytes(doc.sizeBytes)}</span>
                <button type="button" className="link-button" aria-label={`移除 ${doc.name}`} onClick={() => void removeDocument(doc)}>
                  移除
                </button>
              </li>
            ))}
            {uploading.map((name) => (
              <li key={`up-${name}`} className="muted">
                <span className="doc-kind">…</span>
                <span className="doc-name">{name}</span>
                <span className="small">上传中</span>
              </li>
            ))}
          </ul>
          <label className="button secondary file-button">
            添加文件
            <input
              type="file"
              accept={ACCEPT}
              multiple
              onChange={(e) => {
                void addFiles(e.target.files)
                e.target.value = ''
              }}
            />
          </label>
          {uploadError && <p className="error-text">{uploadError}</p>}
        </div>
      </section>

      <section className="card wide start-row">
        <label className="consent">
          <input type="checkbox" checked={form.consent} onChange={(e) => set('consent', e.target.checked)} />
          <span>我已告知所有与会者本次会议将被录音、转写并由 AI 分析，并已取得同意。</span>
        </label>
        <div className="actions">
          <button type="button" className="button secondary" disabled={busy} onClick={onDemo}>
            试用演示会议
          </button>
          <button type="button" className="button primary" disabled={busy || !form.consent || (form.mode === 'bot' && !botLinkOk)} onClick={onStart}>
            {START_LABELS[form.mode]}
          </button>
        </div>
        {form.mode === 'system' && (
          <p className="muted small">
            桌面版直接采集电脑播放的所有声音，可配合 Zoom / Teams / 腾讯会议<b>桌面客户端</b>使用。建议佩戴耳机，并关闭其他会发声的应用。
          </p>
        )}
        {form.mode === 'tab' && (
          <p className="muted small">
            点击开始后，在浏览器弹窗中选择<b>会议所在的标签页</b>，并勾选<b>「同时分享标签页音频」</b>。建议佩戴耳机，避免对方声音被麦克风重复采集。
          </p>
        )}
      </section>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function Toggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={`toggle ${disabled ? 'disabled' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" aria-hidden="true" />
      <span>{label}</span>
    </label>
  )
}
