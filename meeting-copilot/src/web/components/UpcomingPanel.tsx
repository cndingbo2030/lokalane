import { useState } from 'react'
import type { CalendarEvent } from '../../shared/calendar.ts'
import { formatEventTime, type CalendarFeed } from '../calendar/feeds.ts'
import { useNow } from '../useNow.ts'

const PLATFORM_LABEL: Record<string, string> = {
  'google-meet': 'Google Meet',
  teams: 'Teams',
  zoom: 'Zoom',
  tencent: '腾讯会议',
  unknown: '会议',
}

interface Props {
  feeds: CalendarFeed[]
  onFeedsChange: (feeds: CalendarFeed[]) => void
  events: CalendarEvent[]
  errors: Array<{ feed: number; message: string }>
  loading: boolean
  preparedId?: string
  onRefresh: () => void
  onPrepare: (event: CalendarEvent, join: boolean) => void
  notifications: NotificationPermission | 'unsupported'
  onEnableNotifications: () => void
}

/** Today's and tomorrow's meetings from the user's calendar subscriptions. */
export function UpcomingPanel({ feeds, onFeedsChange, events, errors, loading, preparedId, onRefresh, onPrepare, notifications, onEnableNotifications }: Props) {
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const now = useNow(30_000)
  const upcoming = events.filter((e) => Date.parse(e.end) > now).slice(0, 8)

  const addFeed = () => {
    const trimmed = url.trim()
    if (!trimmed) return
    onFeedsChange([...feeds, { url: trimmed, label: label.trim() || `日历 ${feeds.length + 1}` }].slice(0, 5))
    setUrl('')
    setLabel('')
  }

  return (
    <section className="card wide upcoming">
      <div className="history-header">
        <h2>即将开始的会议</h2>
        <div className="actions">
          {feeds.length > 0 && notifications === 'default' && (
            <button type="button" className="button secondary" onClick={onEnableNotifications}>
              开启会前提醒
            </button>
          )}
          {feeds.length > 0 && (
            <button type="button" className="button secondary" onClick={onRefresh} disabled={loading}>
              {loading ? '刷新中…' : '刷新'}
            </button>
          )}
        </div>
      </div>

      {feeds.length > 0 && upcoming.length === 0 && !loading && <p className="muted small">未来 48 小时没有会议。</p>}
      <ul className="event-list">
        {upcoming.map((event) => {
          const live = Date.parse(event.start) <= now
          return (
            <li key={event.id} className={`event ${event.id === preparedId ? 'prepared' : ''}`}>
              <div className="event-main">
                <span className={`event-time ${live ? 'live' : ''}`}>{live ? '进行中 · ' : ''}{formatEventTime(event, now)}</span>
                <span className="event-title">{event.title}</span>
                <span className="muted small">
                  {event.meeting ? PLATFORM_LABEL[event.meeting.platform] : '无会议链接'}
                  {event.attendees.length > 0 ? ` · ${event.attendees.length} 位参会人` : ''}
                  {feeds.length > 1 ? ` · ${feeds[event.feed]?.label ?? ''}` : ''}
                </span>
              </div>
              <div className="actions">
                <button type="button" className="button secondary" onClick={() => onPrepare(event, false)}>
                  {event.id === preparedId ? '已准备' : '准备'}
                </button>
                {event.meeting && (
                  <button type="button" className="button primary" onClick={() => onPrepare(event, true)}>
                    加入并准备
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {errors.map((e) => (
        <p key={e.feed} className="error-text">
          {e.feed < 0 ? '日历服务' : (feeds[e.feed]?.label ?? `日历 ${e.feed + 1}`)}：{e.message}
        </p>
      ))}

      <details className="feeds" open={feeds.length === 0}>
        <summary>{feeds.length === 0 ? '连接日历：自动列出会议、会前提醒、一键准备简报' : `管理日历订阅（${feeds.length}）`}</summary>
        <ul className="doc-list">
          {feeds.map((feed, index) => (
            <li key={feed.url}>
              <span className="doc-kind">ICS</span>
              <span className="doc-name">{feed.label}</span>
              <button type="button" className="link-button" onClick={() => onFeedsChange(feeds.filter((_, i) => i !== index))}>
                移除
              </button>
            </li>
          ))}
        </ul>
        <div className="feed-form">
          <input value={label} placeholder="名称（可选），如：工作日历" aria-label="日历名称" onChange={(e) => setLabel(e.target.value)} />
          <input
            value={url}
            placeholder="粘贴日历订阅链接（https:// 或 webcal://，ICS / iCal 格式）"
            aria-label="日历订阅链接"
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addFeed()}
          />
          <button type="button" className="button primary" disabled={!url.trim() || feeds.length >= 5} onClick={addFeed}>
            添加
          </button>
        </div>
        <p className="muted small">
          Google 日历：设置 → 选择日历 → 集成日历 → 「iCal 格式的私密地址」。Outlook / Microsoft 365：设置 → 日历 → 共享日历 → 发布日历 → 复制 ICS 链接。其他日历请在设置中查找「订阅链接 / ICS / iCal」。
          订阅链接只保存在本机浏览器，请勿分享给他人。
        </p>
      </details>
    </section>
  )
}
