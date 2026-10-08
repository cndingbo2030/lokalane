import { useState } from 'react'

interface Props {
  share?: { token?: string; includeSuggestions: boolean; viewers: number }
  onChange: (enabled: boolean, includeSuggestions: boolean) => void
}

/** The read-only live link: someone else follows the transcript and translation as it happens. */
export function SharePanel({ share, onChange }: Props) {
  const [includeSuggestions, setIncludeSuggestions] = useState(share?.includeSuggestions ?? false)
  const [copied, setCopied] = useState(false)
  // Only the share token: never the owner's own access token from this page's URL.
  const link = share?.token ? `${location.origin}${location.pathname}?view=watch&share=${encodeURIComponent(share.token)}` : ''

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2_000)
    } catch {
      // Clipboard blocked: the link stays selectable in the field.
    }
  }

  return (
    <section className="card share-panel" aria-label="实时共享">
      <h3>实时共享（只读链接）</h3>
      <p className="muted small">
        拿到链接的人无需登录即可实时查看字幕、翻译和会议纪要（不含跟进邮件草稿），适合同事旁听或不懂会议语言的人跟进。停止共享或会议结束后链接立即失效。
      </p>
      <label className="inline-check">
        <input
          type="checkbox"
          checked={includeSuggestions}
          onChange={(e) => {
            setIncludeSuggestions(e.target.checked)
            if (link) onChange(true, e.target.checked)
          }}
        />
        同时共享 AI 实时建议
      </label>
      {link ? (
        <>
          <div className="share-link">
            <input readOnly value={link} aria-label="只读链接" onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="button secondary" onClick={() => void copy()}>
              {copied ? '已复制' : '复制链接'}
            </button>
            <button type="button" className="button danger" onClick={() => onChange(false, includeSuggestions)}>
              停止共享
            </button>
          </div>
          <p className="muted small">{share?.viewers ? `${share.viewers} 人正在观看` : '还没有人打开链接'}</p>
        </>
      ) : (
        <div className="actions">
          <button type="button" className="button primary" onClick={() => onChange(true, includeSuggestions)}>
            生成只读链接
          </button>
        </div>
      )}
    </section>
  )
}
