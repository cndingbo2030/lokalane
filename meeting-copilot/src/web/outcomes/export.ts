import type { ActionItem, MeetingOutcomes } from '../../shared/outcomes.ts'

export interface OutcomesMeta {
  /** Stable meeting id (session id): makes calendar UIDs idempotent on re-import. */
  id: string
  title: string
  startedAt: number
}

/** Spreadsheet export of the action items (UTF-8 with BOM so Excel shows Chinese correctly). */
export function actionItemsToCsv(items: ActionItem[], meta: OutcomesMeta): string {
  const date = localDate(meta.startedAt)
  const rows = [
    ['会议', '日期', '负责人', '任务', '截止日期', '状态'],
    ...items.map((item) => [meta.title, date, item.owner, item.task, item.due ?? '', item.done ? '已完成' : '未完成']),
  ]
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`
}

function csvCell(value: string): string {
  // Cells starting with = + - @ are run as formulas by spreadsheet apps (CSV injection).
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\r\n]|^\s|\s$/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/**
 * Action items with a due date as all-day calendar entries (RFC 5545), so they
 * land in the user's calendar next to the meetings they came from.
 */
export function actionItemsToIcs(items: ActionItem[], meta: OutcomesMeta, now = Date.now()): string | null {
  const dated = items.filter((item): item is ActionItem & { due: string } => Boolean(item.due))
  if (dated.length === 0) return null
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Meeting Copilot//Action items//ZH', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH']
  for (const item of dated) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${meta.id.replace(/[^\w-]/g, '')}-${item.id.replace(/[^\w-]/g, '')}@meeting-copilot`,
      `DTSTAMP:${new Date(now).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,
      `DTSTART;VALUE=DATE:${item.due.replace(/-/g, '')}`,
      `DTEND;VALUE=DATE:${nextDay(item.due)}`,
      `SUMMARY:${icsText(`${item.done ? '✓ ' : ''}${item.task}（${item.owner}）`)}`,
      `DESCRIPTION:${icsText(`负责人：${item.owner}\n来自会议：${meta.title}（${localDate(meta.startedAt)}）`)}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return `${lines.map(foldLine).join('\r\n')}\r\n`
}

function nextDay(date: string): string {
  const next = new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000)
  return next.toISOString().slice(0, 10).replace(/-/g, '')
}

/** TEXT value escaping (RFC 5545 §3.3.11). */
export function icsText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

const encoder = new TextEncoder()

/** Folds content lines at 75 octets (RFC 5545 §3.1) without splitting a UTF-8 character. */
export function foldLine(line: string): string {
  if (encoder.encode(line).length <= 75) return line
  const parts: string[] = []
  let current = ''
  let size = 0
  for (const char of line) {
    const bytes = encoder.encode(char).length
    // Continuation lines start with a space, which counts toward their 75 octets.
    const limit = parts.length === 0 ? 75 : 74
    if (size + bytes > limit) {
      parts.push(current)
      current = ''
      size = 0
    }
    current += char
    size += bytes
  }
  parts.push(current)
  return parts.join('\r\n ')
}

const EMAIL = /^[^\s@,;?&<>"()]+@[^\s@,;?&<>"()]+\.[^\s@,;?&<>"()]+$/

/**
 * mailto: link for the follow-up email. Long bodies exceed what mail clients
 * accept in a URL; then only the recipients and subject go in the link and the
 * caller copies the body to the clipboard instead.
 */
export function followUpMailto(email: MeetingOutcomes['followUpEmail'], recipients: string[]): { href: string; bodyIncluded: boolean } {
  const to = [...new Set(recipients.map((r) => r.trim()).filter((r) => EMAIL.test(r)))].join(',')
  const subject = `subject=${encodeURIComponent(email.subject)}`
  const full = `mailto:${to}?${subject}&body=${encodeURIComponent(email.body.replace(/\r?\n/g, '\r\n'))}`
  if (full.length <= 1_900) return { href: full, bodyIncluded: true }
  return { href: `mailto:${to}?${subject}`, bodyIncluded: false }
}

export function outcomesToText(outcomes: MeetingOutcomes, title: string): string {
  const decisions = outcomes.decisions.length ? outcomes.decisions.map((d, i) => `${i + 1}. ${d}`).join('\n') : '（无）'
  const items = outcomes.actionItems.length
    ? outcomes.actionItems.map((a) => `${a.done ? '☑' : '☐'} ${a.owner}：${a.task}${a.due ? `（截止 ${a.due}）` : ''}`).join('\n')
    : '（无）'
  return `${title}\n\n已达成的决定\n${decisions}\n\n待办事项\n${items}\n`
}

export function localDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function downloadFile(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name.replace(/[\\/:*?"<>|]/g, '_')
  document.body.append(a)
  a.click()
  a.remove()
  // Revoking right away can cancel the download or lose its file name.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
