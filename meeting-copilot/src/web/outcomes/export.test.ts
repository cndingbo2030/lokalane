import { describe, expect, it } from 'vitest'
import type { ActionItem } from '../../shared/outcomes.ts'
import { actionItemsToCsv, actionItemsToIcs, foldLine, followUpMailto, icsText, outcomesToText } from './export.ts'

const meta = { id: 'sess-1', title: 'Pilot, review', startedAt: new Date(2026, 9, 7, 17, 30).getTime() }
const items: ActionItem[] = [
  { id: 'a1', owner: '我', task: '发送报价单, 含 "企业版"', due: '2026-10-09' },
  { id: 'a2', owner: 'Wang Lei', task: '=HYPERLINK("http://evil")', due: null, done: true },
]

describe('actionItemsToCsv', () => {
  it('starts with a BOM, quotes special cells and defuses formulas', () => {
    const csv = actionItemsToCsv(items, meta)
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    const lines = csv.slice(1).split('\r\n')
    expect(lines[0]).toBe('会议,日期,负责人,任务,截止日期,状态')
    expect(lines[1]).toBe('"Pilot, review",2026-10-07,我,"发送报价单, 含 ""企业版""",2026-10-09,未完成')
    expect(lines[2]).toBe(`"Pilot, review",2026-10-07,Wang Lei,"'=HYPERLINK(""http://evil"")",,已完成`)
    expect(csv.endsWith('\r\n')).toBe(true)
  })
})

describe('actionItemsToIcs', () => {
  it('creates an all-day event per dated item with stable UIDs', () => {
    const ics = actionItemsToIcs(items, meta, Date.UTC(2026, 9, 7, 12, 0, 5))!
    const lines = ics.split('\r\n')
    expect(lines[0]).toBe('BEGIN:VCALENDAR')
    expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(1)
    expect(lines).toContain('UID:sess-1-a1@meeting-copilot')
    expect(lines).toContain('DTSTAMP:20261007T120005Z')
    expect(lines).toContain('DTSTART;VALUE=DATE:20261009')
    expect(lines).toContain('DTEND;VALUE=DATE:20261010')
    expect(ics).toContain('SUMMARY:发送报价单\\, 含 "企业版"（我）')
    expect(ics).toContain('DESCRIPTION:负责人：我\\n来自会议：Pilot\\, review')
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
  })

  it('rolls DTEND over month and year ends and skips undated items', () => {
    const ics = actionItemsToIcs([{ id: 'x', owner: 'A', task: 'T', due: '2026-12-31' }], meta)!
    expect(ics).toContain('DTEND;VALUE=DATE:20270101')
    expect(actionItemsToIcs([{ id: 'y', owner: 'A', task: 'T', due: null }], meta)).toBeNull()
  })

  it('escapes TEXT values', () => {
    const backslash = String.fromCharCode(92)
    expect(icsText(`a${backslash}b;c,d\ne`)).toBe(['a', backslash, backslash, 'b', backslash, ';c', backslash, ',d', backslash, 'ne'].join(''))
  })

  it('folds long lines at 75 octets without splitting UTF-8 characters', () => {
    const line = `SUMMARY:${'会议纪要'.repeat(20)}`
    const folded = foldLine(line)
    const encoder = new TextEncoder()
    for (const part of folded.split('\r\n')) expect(encoder.encode(part).length).toBeLessThanOrEqual(75)
    expect(folded.split('\r\n').slice(1).every((part) => part.startsWith(' '))).toBe(true)
    expect(folded.replace(/\r\n /g, '')).toBe(line)
    expect(foldLine('SHORT:1')).toBe('SHORT:1')
  })
})

describe('followUpMailto', () => {
  const email = { subject: '会议跟进 & 下一步', body: '您好，\n感谢参会。' }

  it('addresses valid attendee emails and encodes subject and CRLF body', () => {
    const { href, bodyIncluded } = followUpMailto(email, ['wang@example.com', 'not an email', 'wang@example.com', 'alice@example.sg'])
    expect(bodyIncluded).toBe(true)
    expect(href.startsWith('mailto:wang@example.com,alice@example.sg?subject=')).toBe(true)
    expect(href).toContain(encodeURIComponent('会议跟进 & 下一步'))
    expect(href).toContain('%0D%0A')
  })

  it('leaves a long body out of the link', () => {
    const { href, bodyIncluded } = followUpMailto({ subject: 's', body: '很长'.repeat(500) }, [])
    expect(bodyIncluded).toBe(false)
    expect(href).toBe('mailto:?subject=s')
  })
})

describe('outcomesToText', () => {
  it('renders a plain-text recap', () => {
    const text = outcomesToText({ decisions: ['推进试点'], actionItems: items, followUpEmail: { subject: '', body: '' } }, 'Pilot')
    expect(text).toContain('1. 推进试点')
    expect(text).toContain('☐ 我：发送报价单, 含 "企业版"（截止 2026-10-09）')
    expect(text).toContain('☑ Wang Lei')
  })
})
