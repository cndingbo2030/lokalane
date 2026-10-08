import ICAL from 'ical.js'
import type { CalendarEvent, CalendarPerson } from '../../shared/calendar.ts'
import { extractMeetingLink } from '../../shared/meetingLink.ts'

type IcalTime = InstanceType<typeof ICAL.Time>
type IcalEvent = InstanceType<typeof ICAL.Event>

export interface ParseOptions {
  from: Date
  to: Date
  /** Used for "floating" times (no zone at all). */
  timeZone?: string
  feed?: number
}

/** Guard against pathological RRULEs (e.g. FREQ=SECONDLY) in untrusted feeds. */
const MAX_OCCURRENCE_STEPS = 5_000
const MAX_EVENTS = 500

/**
 * Windows zone names used by Outlook/Exchange, mapped to IANA. Only needed when
 * a feed references a TZID without including its VTIMEZONE definition.
 */
const WINDOWS_ZONES: Record<string, string> = {
  'China Standard Time': 'Asia/Shanghai',
  'Singapore Standard Time': 'Asia/Singapore',
  'Malay Peninsula Standard Time': 'Asia/Kuala_Lumpur',
  'Taipei Standard Time': 'Asia/Taipei',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'Korea Standard Time': 'Asia/Seoul',
  'India Standard Time': 'Asia/Kolkata',
  'SE Asia Standard Time': 'Asia/Bangkok',
  'W. Australia Standard Time': 'Australia/Perth',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'New Zealand Standard Time': 'Pacific/Auckland',
  'Arabian Standard Time': 'Asia/Dubai',
  'GMT Standard Time': 'Europe/London',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris',
  'Central Europe Standard Time': 'Europe/Budapest',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'Russian Standard Time': 'Europe/Moscow',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'E. South America Standard Time': 'America/Sao_Paulo',
  UTC: 'UTC',
  'Coordinated Universal Time': 'UTC',
}

function validZone(zone: string | undefined): string | undefined {
  if (!zone) return undefined
  const candidate = WINDOWS_ZONES[zone] ?? zone
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate })
    return candidate
  } catch {
    return undefined
  }
}

/** Offset of `zone` from UTC at the given instant, in ms. */
function zoneOffsetMs(zone: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - utcMs
}

/** Wall-clock time in an IANA zone → UTC instant (handles DST transitions). */
export function wallTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, second: number, zone: string): Date {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second)
  // Two passes: the offset at the first estimate settles DST-boundary cases.
  const estimate = asUtc - zoneOffsetMs(zone, asUtc)
  return new Date(asUtc - zoneOffsetMs(zone, estimate))
}

function toUtc(time: IcalTime, fallbackZone: string): Date {
  const zone = time.zone
  if (zone && zone.tzid !== 'floating') return time.toJSDate()
  // A TZID without VTIMEZONE (or no zone at all): resolve the wall time ourselves.
  // `timezone` (the raw TZID) exists at runtime but is missing from ical.js's type declarations.
  const tzid = (time as IcalTime & { timezone?: string }).timezone
  const resolved = validZone(tzid) ?? fallbackZone
  return wallTimeToUtc(time.year, time.month, time.day, time.hour, time.minute, time.second, resolved)
}

function person(value: unknown, cn: unknown): CalendarPerson | undefined {
  const email = typeof value === 'string' ? value.replace(/^mailto:/i, '').trim() : undefined
  const name = typeof cn === 'string' ? cn.replace(/^"|"$/g, '').trim() : undefined
  if (!email && !name) return undefined
  return { ...(name ? { name } : {}), ...(email && email.includes('@') ? { email: email.toLowerCase() } : {}) }
}

function cleanDescription(text: string): string | undefined {
  const cleaned = text
    .split('\n')
    .filter((line) => !/^[\s_\-=*~.]{8,}$/.test(line)) // Teams/Zoom separator lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return cleaned ? cleaned.slice(0, 2_000) : undefined
}

function occurrence(event: IcalEvent, start: Date, end: Date, feed: number): CalendarEvent | null {
  const component = event.component
  const status = String(component.getFirstPropertyValue('status') ?? '').toUpperCase()
  if (status === 'CANCELLED') return null
  const description = event.description ?? ''
  const location = event.location ?? ''
  const meeting = extractMeetingLink(
    stringProp(component, 'x-google-conference'),
    stringProp(component, 'x-microsoft-skypeteamsmeetingurl'),
    stringProp(component, 'x-microsoft-onlinemeetingconfurl'),
    stringProp(component, 'url'),
    location,
    description,
  )
  const organizerProp = component.getFirstProperty('organizer')
  const organizer = organizerProp ? person(organizerProp.getFirstValue(), organizerProp.getParameter('cn')) : undefined
  const attendees = component
    .getAllProperties('attendee')
    .map((p) => person(p.getFirstValue(), p.getParameter('cn')))
    .filter((p): p is CalendarPerson => Boolean(p))
    .slice(0, 50)
  return {
    id: `${event.uid}@${start.toISOString()}`,
    seriesId: event.uid,
    title: (event.summary ?? '').trim() || '(无标题)',
    start: start.toISOString(),
    end: end.toISOString(),
    ...(location.trim() ? { location: location.trim().slice(0, 300) } : {}),
    ...(cleanDescription(description) ? { description: cleanDescription(description) } : {}),
    ...(organizer ? { organizer } : {}),
    attendees,
    ...(meeting ? { meeting: { platform: meeting.platform, url: meeting.url, meetingId: meeting.meetingId, passcode: meeting.passcode } } : {}),
    feed,
  }
}

function stringProp(component: InstanceType<typeof ICAL.Component>, name: string): string | undefined {
  const value = component.getFirstPropertyValue(name)
  return typeof value === 'string' ? value : undefined
}

export function isCalendarText(text: string): boolean {
  return /^\uFEFF?\s*BEGIN:VCALENDAR/i.test(text)
}

/**
 * Parses an iCalendar feed and returns the timed occurrences overlapping
 * [from, to), recurring series expanded (RRULE, EXDATE, moved occurrences),
 * cancelled and all-day events dropped, sorted by start time.
 */
export function parseCalendar(text: string, options: ParseOptions): CalendarEvent[] {
  const fallbackZone = validZone(options.timeZone) ?? 'UTC'
  const feed = options.feed ?? 0
  const fromMs = options.from.getTime()
  const toMs = options.to.getTime()
  const out: CalendarEvent[] = []

  const root = new ICAL.Component(ICAL.parse(text))
  try {
    // ical.js resolves TZIDs through a global registry: register this feed's zones for the
    // duration of this synchronous parse only, so feeds never affect each other.
    for (const tz of root.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(tz)

    const events = root.getAllSubcomponents('vevent').map((v) => new ICAL.Event(v))
    const masters = new Map<string, IcalEvent>()
    for (const event of events) if (!event.isRecurrenceException()) masters.set(event.uid, event)
    for (const event of events) if (event.isRecurrenceException()) masters.get(event.uid)?.relateException(event)

    for (const event of events) {
      if (out.length >= MAX_EVENTS) break
      if (!event.startDate || event.startDate.isDate) continue // all-day: holidays, OOO
      const master = masters.get(event.uid)
      // Exceptions of a recurring master are produced by the master's expansion.
      if (event.isRecurrenceException() && master?.isRecurring()) continue

      if (!event.isRecurring()) {
        const start = toUtc(event.startDate, fallbackZone)
        const end = event.endDate ? toUtc(event.endDate, fallbackZone) : new Date(start.getTime() + 30 * 60_000)
        if (end.getTime() > fromMs && start.getTime() < toMs) {
          const occ = occurrence(event, start, end, feed)
          if (occ) out.push(occ)
        }
        continue
      }

      const iterator = event.iterator()
      for (let steps = 0, next = iterator.next(); next && steps < MAX_OCCURRENCE_STEPS; steps++, next = iterator.next()) {
        const details = event.getOccurrenceDetails(next)
        const start = toUtc(details.startDate, fallbackZone)
        const end = toUtc(details.endDate, fallbackZone)
        // Moved occurrences can land earlier than their slot; keep scanning slightly past the window.
        if (toUtc(next, fallbackZone).getTime() >= toMs + 7 * 86_400_000) break
        if (end.getTime() <= fromMs || start.getTime() >= toMs) continue
        const occ = occurrence(details.item, start, end, feed)
        if (occ) out.push({ ...occ, seriesId: event.uid, id: `${event.uid}@${start.toISOString()}` })
      }
    }
  } finally {
    ICAL.TimezoneService.reset()
  }
  return out.sort((a, b) => a.start.localeCompare(b.start))
}
