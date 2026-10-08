import { useMemo, useState } from 'react'
import { formatDate, formatDuration, searchMeetings, type MeetingRecord } from '../history/model.ts'
import { downloadFile } from '../outcomes/export.ts'
import type { Integration } from '../outcomes/integrations.ts'
import { transcriptToMarkdown } from '../state/reducer.ts'
import { Markdown } from './Markdown.tsx'
import { OutcomesPanel, type OutcomesContext } from './OutcomesPanel.tsx'
import { TranscriptPane } from './TranscriptPane.tsx'

interface ListProps {
  records: MeetingRecord[]
  onOpen: (record: MeetingRecord) => void
}

export function HistoryPanel({ records, onOpen }: ListProps) {
  const [query, setQuery] = useState('')
  const hits = useMemo(() => searchMeetings(records, query), [records, query])

  if (records.length === 0) return null
  return (
    <section className="card wide history">
      <div className="history-header">
        <h2>历史会议 <span className="muted small">（仅保存在本机浏览器）</span></h2>
        <input type="search" value={query} placeholder="搜索标题、逐字稿、翻译或纪要…" aria-label="搜索历史会议" onChange={(e) => setQuery(e.target.value)} />
      </div>
      {hits.length === 0 && <p className="muted small">没有匹配的会议</p>}
      <ul className="history-list">
        {hits.slice(0, 50).map(({ record, snippet }) => (
          <li key={record.id}>
            <button type="button" className="history-item" onClick={() => onOpen(record)}>
              <span className="history-title">{record.title}</span>
              <span className="muted small">
                {formatDate(record.startedAt)} · {formatDuration(record.endedAt - record.startedAt)} · {record.segments.length} 句
                {record.summary ? ' · 有纪要' : ''}
                {openItems(record) > 0 ? ` · ${openItems(record)} 项待办未完成` : ''}
              </span>
              {snippet && <span className="history-snippet">{snippet}</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

const openItems = (record: MeetingRecord) => record.outcomes?.actionItems.filter((i) => !i.done).length ?? 0

interface ViewerProps {
  record: MeetingRecord
  onClose: () => void
  onDelete: (record: MeetingRecord) => void
  /** Saves edits (ticked-off action items). */
  onUpdate: (record: MeetingRecord) => void
  integrations: Integration[]
  onIntegrationsChange: (integrations: Integration[]) => void
}

export function MeetingViewer({ record, onClose, onDelete, onUpdate, integrations, onIntegrationsChange }: ViewerProps) {
  const context = useMemo<OutcomesContext>(
    () => ({
      id: record.id,
      title: record.eventTitle ?? record.title,
      startedAt: record.startedAt,
      endedAt: record.endedAt,
      attendees: record.attendees ?? [],
      attendeeEmails: record.attendeeEmails ?? [],
      language: record.targetLanguage,
      summary: record.summary,
    }),
    [record],
  )
  const toggle = (id: string) => {
    if (!record.outcomes) return
    const actionItems = record.outcomes.actionItems.map((item) => (item.id === id ? { ...item, done: !item.done } : item))
    onUpdate({ ...record, outcomes: { ...record.outcomes, actionItems } })
  }

  const download = () => {
    const body = transcriptToMarkdown(record) + (record.summary ? `\n\n---\n\n${record.summary}\n` : '')
    downloadFile(`${record.title}.md`, `# ${record.title}\n\n${body}`, 'text/markdown;charset=utf-8')
  }

  return (
    <main className="live">
      <div className="controls card">
        <div>
          <h2 className="viewer-title">{record.title}</h2>
          <p className="muted small">
            {formatDate(record.startedAt)} · {formatDuration(record.endedAt - record.startedAt)}
            {record.metrics ? ` · 预估费用 $${record.metrics.costUsd.toFixed(2)}` : ''}
          </p>
        </div>
        <div className="actions">
          <button type="button" className="button secondary" onClick={onClose}>
            返回
          </button>
          <button type="button" className="button secondary" onClick={download}>
            导出 Markdown
          </button>
          <button
            type="button"
            className="button danger"
            onClick={() => {
              if (window.confirm('删除这场会议的本地记录？此操作无法撤销。')) onDelete(record)
            }}
          >
            删除
          </button>
        </div>
      </div>
      <div className="panes">
        <TranscriptPane segments={record.segments} translations={record.translations} speakerNames={record.speakerNames} meSpeaker={record.meSpeaker} />
        <section className="pane" aria-label="会议纪要与建议">
          <header className="pane-header">
            <h3>{record.summary ? '会议纪要' : 'AI 建议记录'}</h3>
          </header>
          <div className="pane-body">
            {record.summary ? (
              <Markdown text={record.summary} />
            ) : record.suggestions.length ? (
              record.suggestions.map((s) => (
                <article key={s.id} className="suggestion">
                  <div className="suggestion-meta">
                    <span className="quote">“{s.trigger.text}”</span>
                    {s.rating && <span>{s.rating === 'up' ? '👍' : '👎'}</span>}
                  </div>
                  <Markdown text={s.text} />
                </article>
              ))
            ) : (
              <p className="empty">这场会议没有生成纪要或建议</p>
            )}
          </div>
        </section>
      </div>
      {record.outcomes && (
        <OutcomesPanel
          status="done"
          outcomes={record.outcomes}
          context={context}
          onToggle={toggle}
          integrations={integrations}
          onIntegrationsChange={onIntegrationsChange}
        />
      )}
    </main>
  )
}
