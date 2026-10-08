import { describe, expect, it } from 'vitest'
import type { CalendarEvent } from '../../shared/calendar.ts'
import { dueReminders } from './feeds.ts'

const event = (id: string, startOffsetMin: number, durationMin = 30): CalendarEvent => {
  const now = Date.parse('2026-10-07T02:00:00Z')
  return {
    id,
    seriesId: id,
    title: id,
    start: new Date(now + startOffsetMin * 60_000).toISOString(),
    end: new Date(now + (startOffsetMin + durationMin) * 60_000).toISOString(),
    attendees: [],
    feed: 0,
  }
}

describe('dueReminders', () => {
  const now = Date.parse('2026-10-07T02:00:00Z')
  it('announces meetings starting within the lead time or just started, once', () => {
    const events = [event('soon', 1), event('later', 30), event('started', -3), event('long-ago', -20), event('over', -40, 30)]
    expect(dueReminders(events, now, new Set()).map((e) => e.id)).toEqual(['soon', 'started'])
    expect(dueReminders(events, now, new Set(['soon'])).map((e) => e.id)).toEqual(['started'])
  })
})
