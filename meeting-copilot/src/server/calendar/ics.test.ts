import ICAL from 'ical.js'
import { describe, expect, it } from 'vitest'
import { isCalendarText, parseCalendar, wallTimeToUtc } from './ics.ts'

const crlf = (lines: string) => lines.trim().split('\n').join('\r\n')

// Shaped like a Google Calendar "secret address in iCal format" export.
const GOOGLE = crlf(`
BEGIN:VCALENDAR
PRODID:-//Google Inc//Google Calendar 70.9054//EN
VERSION:2.0
X-WR-CALNAME:Work
BEGIN:VTIMEZONE
TZID:Asia/Singapore
BEGIN:STANDARD
TZOFFSETFROM:+0800
TZOFFSETTO:+0800
TZNAME:+08
DTSTART:19700101T000000
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:weekly-sync@google.com
SUMMARY:产品周会
DTSTART;TZID=Asia/Singapore:20260928T100000
DTEND;TZID=Asia/Singapore:20260928T103000
RRULE:FREQ=WEEKLY;BYDAY=MO
EXDATE;TZID=Asia/Singapore:20261012T100000
X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij
DESCRIPTION:Join with Google Meet: https://meet.google.com/abc-defg-hij\\nLearn more about Meet at: https://support.google.com/a/users/answer/9282720
ORGANIZER;CN=Alice Tan:mailto:alice@lawgorithm.sg
ATTENDEE;CN=Alice Tan;ROLE=REQ-PARTICIPANT:mailto:alice@lawgorithm.sg
ATTENDEE;CN="Wang, Lei":mailto:Wang.Lei@client.com
END:VEVENT
BEGIN:VEVENT
UID:weekly-sync@google.com
RECURRENCE-ID;TZID=Asia/Singapore:20261019T100000
SUMMARY:产品周会（改期）
DTSTART;TZID=Asia/Singapore:20261020T150000
DTEND;TZID=Asia/Singapore:20261020T153000
X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij
END:VEVENT
BEGIN:VEVENT
UID:zoom-1@google.com
SUMMARY:Pricing call
DTSTART:20261007T090000Z
DTEND:20261007T100000Z
DESCRIPTION:Join Zoom Meeting\\nhttps://us02web.zoom.us/j/8123456
 7890?pwd=abc\\n\\nOne tap mobile: +6531587288
END:VEVENT
BEGIN:VEVENT
UID:holiday@google.com
SUMMARY:Public holiday
DTSTART;VALUE=DATE:20261010
DTEND;VALUE=DATE:20261011
END:VEVENT
BEGIN:VEVENT
UID:cancelled@google.com
SUMMARY:Cancelled meeting
STATUS:CANCELLED
DTSTART:20261008T060000Z
DTEND:20261008T070000Z
LOCATION:https://meet.google.com/zzz-zzzz-zzz
END:VEVENT
BEGIN:VEVENT
UID:ongoing@google.com
SUMMARY:Late night review
DTSTART:20261004T230000Z
DTEND:20261005T010000Z
END:VEVENT
BEGIN:VEVENT
UID:outside@google.com
SUMMARY:Next month
DTSTART:20261115T020000Z
DTEND:20261115T030000Z
END:VEVENT
END:VCALENDAR
`)

// Shaped like an Outlook / Exchange published calendar (Windows zone names).
const OUTLOOK = crlf(`
BEGIN:VCALENDAR
METHOD:PUBLISH
PRODID:Microsoft Exchange Server 2010
VERSION:2.0
BEGIN:VTIMEZONE
TZID:China Standard Time
BEGIN:STANDARD
DTSTART:16010101T000000
TZOFFSETFROM:+0800
TZOFFSETTO:+0800
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:040000008200E00074C5B7101A82E008
SUMMARY:Lawgorithm x Client — contract review
DTSTART;TZID=China Standard Time:20261009T140000
DTEND;TZID=China Standard Time:20261009T150000
LOCATION:Microsoft Teams Meeting
DESCRIPTION:________________________________________________________________________________\\nMicrosoft Teams Need help? https://aka.ms/JoinTeamsMeeting\\nJoin the meeting now\\n________________________________________________________________________________
X-MICROSOFT-SKYPETEAMSMEETINGURL:https://teams.microsoft.com/l/meetup-join/19%3ameeting_NjA%40thread.v2/0?context=%7b%22Tid%22%3a%22x%22%7d
END:VEVENT
END:VCALENDAR
`)

const NO_VTIMEZONE = crlf(`
BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:tokyo@example.com
SUMMARY:Tokyo partner call
DTSTART;TZID=Asia/Tokyo:20261008T090000
DTEND;TZID=Asia/Tokyo:20261008T100000
LOCATION:https://meeting.tencent.com/download
DESCRIPTION:点击链接入会 https://meeting.tencent.com/dm/Qw3rTy9
END:VEVENT
BEGIN:VEVENT
UID:floating@example.com
SUMMARY:Floating time
DTSTART:20261008T180000
DTEND:20261008T183000
END:VEVENT
BEGIN:VEVENT
UID:windows-name@example.com
SUMMARY:Windows zone name without definition
DTSTART;TZID=Singapore Standard Time:20261009T090000
DTEND;TZID=Singapore Standard Time:20261009T093000
END:VEVENT
END:VCALENDAR
`)

const window = { from: new Date('2026-10-05T00:00:00Z'), to: new Date('2026-10-21T00:00:00Z') }

describe('parseCalendar', () => {
  it('expands recurring meetings with exclusions and moved occurrences, and drops noise', () => {
    const events = parseCalendar(GOOGLE, window)
    expect(events.map((e) => [e.title, e.start])).toEqual([
      ['Late night review', '2026-10-04T23:00:00.000Z'], // still in progress at window start
      ['产品周会', '2026-10-05T02:00:00.000Z'],
      ['Pricing call', '2026-10-07T09:00:00.000Z'],
      // 10-12 excluded by EXDATE; 10-19 moved to Tuesday 15:00 with a new title
      ['产品周会（改期）', '2026-10-20T07:00:00.000Z'],
    ])
    const weekly = events[1]
    expect(weekly.seriesId).toBe('weekly-sync@google.com')
    expect(events[3].seriesId).toBe(weekly.seriesId)
    expect(weekly.meeting).toMatchObject({ platform: 'google-meet', meetingId: 'abc-defg-hij' })
    expect(weekly.organizer).toEqual({ name: 'Alice Tan', email: 'alice@lawgorithm.sg' })
    expect(weekly.attendees).toContainEqual({ name: 'Wang, Lei', email: 'wang.lei@client.com' })
  })

  it('unfolds long lines (a Zoom link split across two lines)', () => {
    const call = parseCalendar(GOOGLE, window).find((e) => e.title === 'Pricing call')
    expect(call?.meeting).toMatchObject({ platform: 'zoom', meetingId: '81234567890', passcode: 'abc' })
  })

  it('handles Outlook feeds: Windows zone names and Teams links next to help links', () => {
    const [event] = parseCalendar(OUTLOOK, window)
    expect(event.start).toBe('2026-10-09T06:00:00.000Z')
    expect(event.meeting?.platform).toBe('teams')
    expect(event.description).not.toContain('_____')
  })

  it('resolves zones without VTIMEZONE and floating times in the viewer’s zone', () => {
    const events = parseCalendar(NO_VTIMEZONE, { ...window, timeZone: 'Asia/Singapore' })
    const byTitle = Object.fromEntries(events.map((e) => [e.title, e]))
    expect(byTitle['Tokyo partner call'].start).toBe('2026-10-08T00:00:00.000Z')
    expect(byTitle['Tokyo partner call'].meeting).toMatchObject({ platform: 'tencent', meetingId: 'Qw3rTy9' })
    expect(byTitle['Floating time'].start).toBe('2026-10-08T10:00:00.000Z')
    expect(byTitle['Windows zone name without definition'].start).toBe('2026-10-09T01:00:00.000Z')
  })

  it('does not leak one feed’s time zones into the next parse', () => {
    parseCalendar(OUTLOOK, window)
    expect(ICAL.TimezoneService.has('China Standard Time')).toBe(false)
  })

  it('stays fast on pathological recurrence rules', () => {
    const evil = crlf(`
BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:evil
SUMMARY:Every second forever
DTSTART:20200101T000000Z
DTEND:20200101T000001Z
RRULE:FREQ=SECONDLY
END:VEVENT
END:VCALENDAR
`)
    const started = Date.now()
    expect(parseCalendar(evil, window)).toEqual([])
    expect(Date.now() - started).toBeLessThan(2_000)
  })

  it('recognizes calendar text and converts wall times across DST', () => {
    expect(isCalendarText('\uFEFFBEGIN:VCALENDAR\r\n')).toBe(true)
    expect(isCalendarText('<html>login</html>')).toBe(false)
    // New York: 01:30 local on 2026-03-08 is before the DST jump (UTC-5); 03:30 is after (UTC-4).
    expect(wallTimeToUtc(2026, 3, 8, 1, 30, 0, 'America/New_York').toISOString()).toBe('2026-03-08T06:30:00.000Z')
    expect(wallTimeToUtc(2026, 3, 8, 3, 30, 0, 'America/New_York').toISOString()).toBe('2026-03-08T07:30:00.000Z')
  })
})
