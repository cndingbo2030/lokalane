import { useEffect, useState } from 'react'
import type { DesktopSettingsUpdate, PublicDesktopSettings, SttChoice } from '../../shared/desktop.ts'
import { desktop } from '../desktop.ts'

const KEYS: Array<{ id: keyof PublicDesktopSettings['keys']; label: string; hint: string }> = [
  { id: 'anthropic', label: 'Anthropic API Key', hint: '翻译、实时建议、纪要' },
  { id: 'soniox', label: 'Soniox API Key', hint: '实时语音识别（中英混说推荐）' },
  { id: 'deepgram', label: 'Deepgram API Key', hint: '备选语音识别' },
]

/**
 * Desktop-only settings. Keys are write-only from the UI's point of view: the
 * shell encrypts them with the OS keychain and only reports whether each is set.
 */
export function DesktopSettingsPanel() {
  const [settings, setSettings] = useState<PublicDesktopSettings | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    desktop
      ?.getSettings()
      .then(setSettings)
      .catch((e: unknown) => setError(String(e)))
  }, [])

  if (!desktop || !settings) return null

  const save = async (update: DesktopSettingsUpdate) => {
    setSaving(true)
    setError(null)
    try {
      setSettings(await desktop!.saveSettings(update))
      setDrafts({})
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const pendingKeys = Object.fromEntries(Object.entries(drafts).filter(([, v]) => v.trim()))

  return (
    <section className="card wide desktop-settings">
      <h2>
        桌面版设置 <span className="muted small">v{settings.version} · 密钥由系统钥匙串加密保存在本机</span>
      </h2>
      {!settings.secureStorage && <p className="error-text">系统钥匙串不可用，无法保存密钥。可改用环境变量启动应用。</p>}
      {KEYS.map((key) => (
        <div className="key-row" key={key.id}>
          <label htmlFor={`key-${key.id}`}>
            <span className="field-label">{key.label}</span>
            <span className="muted small">{key.hint}</span>
          </label>
          <input
            id={`key-${key.id}`}
            type="password"
            autoComplete="off"
            placeholder={settings.keys[key.id] ? '已设置（输入新值可替换）' : '未设置'}
            value={drafts[key.id] ?? ''}
            disabled={!settings.secureStorage}
            onChange={(e) => setDrafts((d) => ({ ...d, [key.id]: e.target.value }))}
          />
          {settings.keys[key.id] ? (
            <button type="button" className="link-button" disabled={saving} onClick={() => void save({ keys: { [key.id]: '' } })}>
              清除
            </button>
          ) : (
            <span className="key-state">—</span>
          )}
        </div>
      ))}
      <div className="toggles">
        <label className="field-label" htmlFor="stt-choice">
          语音识别服务
        </label>
        <select
          id="stt-choice"
          value={settings.sttProvider}
          disabled={saving}
          onChange={(e) => void save({ sttProvider: e.target.value as SttChoice })}
        >
          <option value="auto">自动（有哪个密钥用哪个，优先 Soniox）</option>
          <option value="soniox">Soniox</option>
          <option value="deepgram">Deepgram</option>
        </select>
        <label className="toggle">
          <input type="checkbox" checked={settings.hideFromScreenShare} disabled={saving} onChange={(e) => void save({ hideFromScreenShare: e.target.checked })} />
          <span className="track" aria-hidden="true" />
          <span>共享屏幕时隐藏本应用窗口（避免字幕和建议被对方看到）</span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={settings.overlay} disabled={saving} onChange={(e) => void save({ overlay: e.target.checked })} />
          <span className="track" aria-hidden="true" />
          <span>会议中显示置顶提词器（Ctrl/⌘ + Shift + O 显示/隐藏，Ctrl/⌘ + Shift + Space 立即建议）</span>
        </label>
      </div>
      <div className="actions">
        <button type="button" className="button primary" disabled={saving || Object.keys(pendingKeys).length === 0} onClick={() => void save({ keys: pendingKeys })}>
          {saving ? '保存中…' : '保存密钥'}
        </button>
        <span className="muted small">保存密钥或切换识别服务后，内置服务会自动重启。</span>
      </div>
      {error && <p className="error-text">{error}</p>}
    </section>
  )
}
