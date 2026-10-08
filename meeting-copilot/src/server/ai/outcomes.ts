import type { ActionItem, MeetingOutcomes } from '../../shared/outcomes.ts'

export const OUTCOMES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['decisions', 'actionItems', 'followUpEmail'],
  properties: {
    decisions: { type: 'array', items: { type: 'string' } },
    actionItems: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['owner', 'task', 'due'],
        properties: {
          owner: { type: 'string' },
          task: { type: 'string' },
          due: { type: 'string', description: 'YYYY-MM-DD, or an empty string when no date was stated' },
        },
      },
    },
    followUpEmail: {
      type: 'object',
      additionalProperties: false,
      required: ['subject', 'body'],
      properties: { subject: { type: 'string' }, body: { type: 'string' } },
    },
  },
} as const

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

/** Bounds and cleans the model output and gives action items stable ids for check-off. */
export function normalizeOutcomes(raw: unknown): MeetingOutcomes {
  const value = (raw ?? {}) as { decisions?: unknown; actionItems?: unknown; followUpEmail?: { subject?: unknown; body?: unknown } }
  const decisions = (Array.isArray(value.decisions) ? value.decisions : []).map((d) => text(d, 400)).filter(Boolean).slice(0, 20)
  const actionItems: ActionItem[] = (Array.isArray(value.actionItems) ? value.actionItems : [])
    .map((item: { owner?: unknown; task?: unknown; due?: unknown }) => ({
      owner: text(item?.owner, 80) || '待定',
      task: text(item?.task, 400),
      due: /^\d{4}-\d{2}-\d{2}$/.test(text(item?.due, 10)) && !Number.isNaN(Date.parse(text(item?.due, 10))) ? text(item?.due, 10) : null,
    }))
    .filter((item) => item.task)
    .slice(0, 30)
    .map((item, index) => ({ id: `a${index + 1}`, ...item }))
  return {
    decisions,
    actionItems,
    followUpEmail: { subject: text(value.followUpEmail?.subject, 200), body: text(value.followUpEmail?.body, 6_000) },
  }
}

/** "2026-10-07 (Wednesday), time zone Asia/Singapore" — lets the model resolve "next Friday". */
export function describeMeetingDate(at: number, timeZone: string | undefined): string {
  const zone = validTimeZone(timeZone) ?? 'UTC'
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long' }).formatToParts(new Date(at))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')} (${get('weekday')}), time zone ${zone}`
}

export function validTimeZone(zone: unknown): string | undefined {
  if (typeof zone !== 'string' || zone.length > 64) return undefined
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return zone
  } catch {
    return undefined
  }
}
