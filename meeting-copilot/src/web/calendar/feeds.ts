import type { CalendarEvent, CalendarEventsResponse } from '../../shared/calendar.ts'
import { postJson } from '../net/api.ts'

export interface CalendarFeed {
  url: string
  label: string
}

const KEY = 'meeting-copilot:calendar-feeds'

/** Feed URLs are private (anyone with the link can read the calendar): kept in this browser only. */
export function loadFeeds(): CalendarFeed[] {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    return Array.isArray(value) ? value.filter((f): f is CalendarFeed => typeof f?.url === 'string').slice(0, 5) : []
  } catch {
    return []
  }
}

export function saveFeeds(feeds: CalendarFeed[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(feeds))
  } catch {
    // storage unavailable
  }
}

export function fetchUpcoming(feeds: CalendarFeed[], days = 2): Promise<CalendarEventsResponse> {
  return postJson<CalendarEventsResponse>('/api/calendar/events', {
    feeds: feeds.map((f) => f.url),
    days,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  })
}

/** Meetings starting within `leadMs` (or already started but not over) that have not been announced yet. */
export function dueReminders(events: CalendarEvent[], now: number, announced: ReadonlySet<string>, leadMs = 2 * 60_000): CalendarEvent[] {
  return events.filter((event) => {
    const start = Date.parse(event.start)
    const end = Date.parse(event.end)
    return !announced.has(event.id) && start - now <= leadMs && start - now > -5 * 60_000 && end > now
  })
}

/** "今天 14:00–14:30" / "明天 09:00" / "10月9日 周五 14:00" in the viewer's locale. */
export function formatEventTime(event: CalendarEvent, now = Date.now()): string {
  const start = new Date(event.start)
  const end = new Date(event.end)
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diff = Math.round((day(start) - day(new Date(now))) / 86_400_000)
  const time = (d: Date) => d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  const prefix = diff === 0 ? '今天' : diff === 1 ? '明天' : start.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })
  return `${prefix} ${time(start)}–${time(end)}`
}
