import type { MeetingPlatform } from './protocol.ts'

export interface CalendarPerson {
  name?: string
  email?: string
}

/** One occurrence of a calendar event (recurring series are expanded). */
export interface CalendarEvent {
  /** Unique per occurrence: series id + occurrence start. */
  id: string
  /** iCalendar UID: stable across every occurrence of a recurring meeting. */
  seriesId: string
  title: string
  /** ISO 8601, UTC. */
  start: string
  end: string
  location?: string
  description?: string
  organizer?: CalendarPerson
  attendees: CalendarPerson[]
  meeting?: {
    platform: MeetingPlatform
    url: string
    meetingId?: string
    passcode?: string
  }
  /** Index of the feed (in the request) this event came from. */
  feed: number
}

export interface CalendarEventsRequest {
  feeds: string[]
  /** How many days ahead to look (1–14). */
  days?: number
  /** The viewer's IANA time zone, for "floating" times without a zone. */
  timeZone?: string
}

export interface CalendarEventsResponse {
  events: CalendarEvent[]
  errors: Array<{ feed: number; message: string }>
}
