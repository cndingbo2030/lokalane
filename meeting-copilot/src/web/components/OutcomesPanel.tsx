import { useEffect, useMemo, useState } from 'react'
import type { MeetingOutcomes } from '../../shared/outcomes.ts'
import type { LanguageCode } from '../../shared/protocol.ts'
import { actionItemsToCsv, actionItemsToIcs, downloadFile, followUpMailto, localDate, outcomesToText, type OutcomesMeta } from '../outcomes/export.ts'
import { buildDeliveryPayload, INTEGRATION_INFO, type Integration } from '../outcomes/integrations.ts'
import { useDeliveries } from '../outcomes/useIntegrations.ts'
import { useNow } from '../useNow.ts'
import { IntegrationsManager } from './IntegrationsManager.tsx'

export interface OutcomesContext extends OutcomesMeta {
  endedAt?: number
  attendees: string[]
  attendeeEmails: string[]
  language: Exclude<LanguageCode, 'auto'>
  summary: string
}

interface Props {
  status: 'idle' | 'loading' | 'done' | 'error'
  outcomes?: MeetingOutcomes
  error?: string
  context: OutcomesContext
  onToggle: (id: string) => void
  integrations: Integration[]
  onIntegrationsChange: (integrations: Integration[]) => void
  /** Push to integrations marked "自动推送" once the results arrive (live meetings only). */
  autoSend?: boolean
}

// Survives remounts (e.g. re-rendering the live view) so a meeting is auto-pushed once.
const autoSent = new Set<string>()

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** Decisions, a checklist of action items, the follow-up email and one-click delivery. */
export function OutcomesPanel({ status, outcomes, error, context, onToggle, integrations, onIntegrationsChange, autoSend = false }: Props) {
  const { statuses, send } = useDeliveries()
  const [copied, setCopied] = useState<string | null>(null)
  const now = useNow(60_000)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(null), 2_000)
    return () => window.clearTimeout(timer)
  }, [copied])

  useEffect(() => {
    if (!autoSend || status !== 'done' || !outcomes) return
    const due = integrations.filter((i) => i.autoSend && !autoSent.has(`${context.id}:${i.id}`))
    if (due.length === 0) return
    const timer = window.setTimeout(() => {
      const payload = buildDeliveryPayload({ ...context, outcomes })
      for (const integration of due) {
        autoSent.add(`${context.id}:${integration.id}`)
        void send(integration, payload, true)
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [autoSend, status, outcomes, integrations, context, send])

  const ics = useMemo(() => (outcomes ? actionItemsToIcs(outcomes.actionItems, context) : null), [outcomes, context])
  const mailto = useMemo(() => (outcomes ? followUpMailto(outcomes.followUpEmail, context.attendeeEmails) : null), [outcomes, context.attendeeEmails])

  if (status === 'idle') return null

  const copy = async (key: string, text: string) => {
    if (await copyText(text)) setCopied(key)
  }
  const fileBase = `${context.title} ${localDate(context.startedAt)}`
  const today = localDate(now)
  const items = outcomes?.actionItems ?? []
  const doneCount = items.filter((i) => i.done).length
  const email = outcomes?.followUpEmail

  return (
    <section className="card outcomes" aria-label="会议结果">
      <header className="outcomes-header">
        <h3>会议结果</h3>
        {status === 'loading' && <span className="muted small">正在提取决定、待办和跟进邮件…</span>}
      </header>
      {status === 'error' && <p className="error-text">会议结果提取失败：{error}</p>}

      {outcomes && (
        <>
          <div className="outcomes-grid">
            <div>
              <h4>已达成的决定</h4>
              {outcomes.decisions.length ? (
                <ol className="decisions">
                  {outcomes.decisions.map((decision, i) => (
                    <li key={i}>{decision}</li>
                  ))}
                </ol>
              ) : (
                <p className="muted small">没有明确的决定</p>
              )}
            </div>
            <div>
              <h4>
                待办事项 {items.length > 0 && <span className="muted small">{doneCount}/{items.length} 已完成</span>}
              </h4>
              {items.length ? (
                <ul className="action-items">
                  {items.map((item) => (
                    <li key={item.id} className={item.done ? 'done' : ''}>
                      <label>
                        <input type="checkbox" checked={Boolean(item.done)} onChange={() => onToggle(item.id)} />
                        <span className="owner">{item.owner}</span>
                        <span className="task">{item.task}</span>
                        {item.due && <span className={`due ${!item.done && item.due < today ? 'overdue' : ''}`}>截止 {item.due}</span>}
                      </label>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small">没有待办事项</p>
              )}
              <div className="actions">
                <button type="button" className="button secondary" onClick={() => void copy('outcomes', outcomesToText(outcomes, context.title))}>
                  {copied === 'outcomes' ? '已复制' : '复制'}
                </button>
                {items.length > 0 && (
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => downloadFile(`${fileBase} 待办.csv`, actionItemsToCsv(items, context), 'text/csv;charset=utf-8')}
                  >
                    导出 CSV
                  </button>
                )}
                {ics && (
                  <button
                    type="button"
                    className="button secondary"
                    title="有截止日期的待办会成为全天日程"
                    onClick={() => downloadFile(`${fileBase} 待办.ics`, ics, 'text/calendar;charset=utf-8')}
                  >
                    加入日历
                  </button>
                )}
              </div>
            </div>
          </div>

          {email && email.body && mailto && (
            <div className="followup">
              <h4>跟进邮件草稿</h4>
              <p className="email-subject">
                <span className="muted">主题：</span>
                {email.subject}
              </p>
              <pre className="email-body">{email.body}</pre>
              <div className="actions">
                <button type="button" className="button secondary" onClick={() => void copy('email', `${email.subject}\n\n${email.body}`)}>
                  {copied === 'email' ? '已复制' : '复制邮件'}
                </button>
                <a
                  className="button secondary"
                  href={mailto.href}
                  onClick={() => {
                    if (!mailto.bodyIncluded) void copy('email', email.body)
                  }}
                >
                  用邮件发送{context.attendeeEmails.length ? `（${context.attendeeEmails.length} 位收件人）` : ''}
                </a>
              </div>
              {!mailto.bodyIncluded && <p className="muted small">正文较长：点击「用邮件发送」时正文会复制到剪贴板，请在邮件里粘贴。</p>}
            </div>
          )}

          <div className="deliver">
            <h4>推送到团队</h4>
            {integrations.length > 0 ? (
              <div className="deliver-targets">
                {integrations.map((integration) => {
                  const state = statuses[integration.id]
                  return (
                    <div key={integration.id} className="deliver-target">
                      <button
                        type="button"
                        className="button secondary"
                        disabled={state?.status === 'sending'}
                        onClick={() => void send(integration, buildDeliveryPayload({ ...context, outcomes }))}
                      >
                        {state?.status === 'sending' ? '发送中…' : state?.status === 'sent' ? `✓ ${integration.name}` : `发送到 ${integration.name}`}
                      </button>
                      <span className="muted small">
                        {INTEGRATION_INFO[integration.type].label}
                        {state?.status === 'sent' ? (state.auto ? ' · 已自动推送' : ' · 已发送') : ''}
                      </span>
                      {state?.status === 'error' && <span className="error-text small">{state.message}</span>}
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="muted small">还没有推送目标：添加飞书、钉钉、企业微信、Slack 或 Teams 群机器人后，可一键（或自动）把结果发到群里。</p>
            )}
            <details className="feeds">
              <summary>管理推送目标</summary>
              <IntegrationsManager integrations={integrations} onChange={onIntegrationsChange} language={context.language} />
            </details>
          </div>
        </>
      )}
    </section>
  )
}
