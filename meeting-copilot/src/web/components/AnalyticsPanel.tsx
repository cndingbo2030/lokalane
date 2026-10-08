import { useMemo } from 'react'
import { conversationInsights, conversationStats, formatMinutes, type SpeakerStats } from '../../shared/analytics.ts'
import type { TranscriptSegment } from '../../shared/protocol.ts'

/** Validated categorical slots (see styles.css): the user keeps the transcript's teal, others take slots in order of first speaking. */
const OTHER_SLOTS = 5

interface Props {
  segments: TranscriptSegment[]
  speakerNames: Record<string, string>
  meSpeaker?: string
}

const percent = (share: number) => `${Math.round(share * 100)}%`

/** Talk-time share, turns, longest monologue, questions and pace per speaker. */
export function AnalyticsPanel({ segments, speakerNames, meSpeaker }: Props) {
  const stats = useMemo(() => conversationStats(segments, speakerNames, meSpeaker), [segments, speakerNames, meSpeaker])
  if (stats.talkMs < 30_000 || stats.speakers.length === 0) return null

  // Color follows the speaker, not their rank: me first, then others in order of first speaking.
  const others = stats.speakers.filter((s) => !s.isMe).sort((a, b) => a.firstMs - b.firstMs)
  const me = stats.speakers.find((s) => s.isMe)
  const slot = new Map<string, string>()
  if (me) slot.set(me.key, 'me')
  others.forEach((s, i) => slot.set(s.key, i < OTHER_SLOTS ? String(i + 1) : 'other'))
  const named = others.slice(0, OTHER_SLOTS)
  const rest = others.slice(OTHER_SLOTS)
  const barSegments: Array<{ key: string; label: string; share: number; slot: string }> = [
    ...(me ? [{ key: me.key, label: me.label, share: me.share, slot: 'me' }] : []),
    ...named.map((s) => ({ key: s.key, label: s.label, share: s.share, slot: slot.get(s.key)! })),
    ...(rest.length ? [{ key: 'other', label: `其他 ${rest.length} 人`, share: rest.reduce((sum, s) => sum + s.share, 0), slot: 'other' }] : []),
  ]
  const insights = conversationInsights(stats)

  return (
    <section className="card analytics" aria-label="会议分析">
      <header className="outcomes-header">
        <h3>会议分析</h3>
        <span className="muted small">
          发言共 {formatMinutes(stats.talkMs)} · 历时 {formatMinutes(stats.spanMs)}
        </span>
      </header>

      <div className="talk-bar" role="img" aria-label={`发言占比：${barSegments.map((s) => `${s.label} ${percent(s.share)}`).join('，')}`}>
        {barSegments.map((s) => (
          <span key={s.key} className={`talk-share spk-${s.slot}`} style={{ flexGrow: Math.max(s.share, 0.004) }} title={`${s.label}：${percent(s.share)}`} />
        ))}
      </div>
      <ul className="talk-legend">
        {barSegments.map((s) => (
          <li key={s.key}>
            <span className={`swatch spk-${s.slot}`} aria-hidden="true" />
            {s.label} <b>{percent(s.share)}</b>
          </li>
        ))}
      </ul>

      <div className="table-scroll">
        <table className="speaker-table">
          <thead>
            <tr>
              <th scope="col">说话人</th>
              <th scope="col">发言占比</th>
              <th scope="col">发言次数</th>
              <th scope="col">最长连续发言</th>
              <th scope="col">提问</th>
              <th scope="col">语速</th>
            </tr>
          </thead>
          <tbody>
            {stats.speakers.map((s) => (
              <tr key={s.key}>
                <th scope="row">
                  <span className={`swatch spk-${slot.get(s.key)}`} aria-hidden="true" />
                  {s.label}
                </th>
                <td>{percent(s.share)}</td>
                <td>{s.turns}</td>
                <td>{formatMinutes(s.longestTurnMs)}</td>
                <td>{s.questions}</td>
                <td>{pace(s)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {stats.myShare === null && stats.speakers.length > 1 && (
        <p className="muted small">提示：会议机器人或线下麦克风听到的是所有人。在字幕中点你的说话人 →「这是我」，即可看到你自己的发言占比。</p>
      )}
      {insights.map((insight) => (
        <p key={insight} className="insight">
          {insight}
        </p>
      ))}
    </section>
  )
}

function pace(s: SpeakerStats): string {
  if (!s.pace) return '—'
  return `${s.pace.value} ${s.pace.unit === 'cpm' ? '字/分' : '词/分'}`
}
