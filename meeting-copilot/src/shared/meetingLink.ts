import type { MeetingPlatform } from './protocol.ts'

export interface ParsedMeetingLink {
  platform: MeetingPlatform
  /** Normalized https URL that opens the meeting in a browser tab. */
  url: string
  meetingId?: string
  passcode?: string
  /** Human label for the UI. */
  label: string
  /** Whether the platform's web client can join without installing an app. */
  webJoinSupported: boolean
}

const PLATFORM_LABELS: Record<MeetingPlatform, string> = {
  'google-meet': 'Google Meet',
  teams: 'Microsoft Teams',
  zoom: 'Zoom',
  tencent: '腾讯会议 / VooV',
  unknown: '未知平台',
}

/**
 * The link a meeting bot should join. Same as `url`, except that Zoom links go
 * back to the standard /j/<id> form: `url` points at Zoom's browser client,
 * which bot services do not take.
 */
export function botJoinUrl(link: ParsedMeetingLink): string {
  if (link.platform !== 'zoom' || !link.meetingId || !/^\d+$/.test(link.meetingId)) return link.url
  const url = new URL(link.url)
  const join = new URL(`https://${url.hostname}/j/${link.meetingId}`)
  if (link.passcode) join.searchParams.set('pwd', link.passcode)
  return join.toString()
}

/**
 * Detect the meeting platform from a pasted invite link (or a whole pasted
 * invitation text that contains a link) and extract the meeting id / passcode.
 */
export function parseMeetingLink(input: string): ParsedMeetingLink | null {
  const candidate = extractFirstUrl(input)
  if (!candidate) return null

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  url.protocol = 'https:'

  const host = url.hostname.toLowerCase()
  const path = url.pathname

  if (host === 'meet.google.com') {
    const match = path.match(/^\/([a-z]{3}-[a-z]{4}-[a-z]{3})\b/i)
    return build('google-meet', url, match?.[1]?.toLowerCase(), undefined, true)
  }

  if (host === 'teams.microsoft.com' || host === 'teams.live.com' || host.endsWith('.teams.microsoft.com')) {
    // teams.live.com/meet/<id>?p=<passcode>  |  teams.microsoft.com/l/meetup-join/<thread>/...
    // teams.microsoft.com/meet/<id>?p=<passcode>
    const meetMatch = path.match(/^\/meet\/(\d+)/)
    const passcode = url.searchParams.get('p') ?? undefined
    const threadMatch = path.match(/^\/l\/meetup-join\/([^/]+)/)
    const meetingId = meetMatch?.[1] ?? (threadMatch ? decodeURIComponent(threadMatch[1]) : undefined)
    return build('teams', url, meetingId, passcode, true)
  }

  if (host === 'zoom.us' || host.endsWith('.zoom.us') || host === 'zoom.com' || host.endsWith('.zoom.com') || host.endsWith('.zoomgov.com')) {
    // /j/<id>, /w/<id>, /wc/join/<id>, /wc/<id>/join, /s/<id>, /my/<vanity>
    const idMatch =
      path.match(/^\/(?:j|w|s)\/(\d{9,12})/) ??
      path.match(/^\/wc\/join\/(\d{9,12})/) ??
      path.match(/^\/wc\/(\d{9,12})\/join/)
    const vanity = path.match(/^\/my\/([\w.-]+)/)
    const meetingId = idMatch?.[1] ?? vanity?.[1]
    const passcode = url.searchParams.get('pwd') ?? undefined
    // Zoom's web client lives at /wc/join/<id>; rewrite so the browser tab joins without the desktop app.
    if (idMatch) {
      const web = new URL(`https://${host}/wc/join/${idMatch[1]}`)
      if (passcode) web.searchParams.set('pwd', passcode)
      return build('zoom', web, meetingId, passcode, true)
    }
    return build('zoom', url, meetingId, passcode, true)
  }

  if (host === 'meeting.tencent.com' || host.endsWith('.meeting.tencent.com') || host === 'voovmeeting.com' || host.endsWith('.voovmeeting.com')) {
    // meeting.tencent.com/dm/<code>  |  /p/<code>  |  /s/<code>  |  /l/<code>
    const match = path.match(/^\/(?:dm|p|s|l)\/([\w-]+)/)
    return build('tencent', url, match?.[1], undefined, true)
  }

  return build('unknown', url, undefined, undefined, false)
}

/**
 * Finds the meeting link in calendar fields or invitation text, which usually
 * contain several URLs (help pages, "download the app", dial-in pages…).
 * Fields are searched in the order given; a known platform link with a
 * meeting id wins over one without (e.g. meeting.tencent.com/download).
 */
export function extractMeetingLink(...texts: Array<string | undefined>): ParsedMeetingLink | null {
  let fallback: ParsedMeetingLink | null = null
  for (const text of texts) {
    if (!text) continue
    for (const match of text.matchAll(/https?:\/\/[^\s<>"'，。）)\]]+/gi)) {
      const parsed = parseMeetingLink(match[0].replace(/[.,;:!?]+$/, ''))
      if (!parsed || parsed.platform === 'unknown') continue
      if (parsed.meetingId) return parsed
      fallback ??= parsed
    }
  }
  return fallback
}

function build(
  platform: MeetingPlatform,
  url: URL,
  meetingId: string | undefined,
  passcode: string | undefined,
  webJoinSupported: boolean,
): ParsedMeetingLink {
  return {
    platform,
    url: url.toString(),
    meetingId,
    passcode,
    label: PLATFORM_LABELS[platform],
    webJoinSupported,
  }
}

function extractFirstUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const match = trimmed.match(/https?:\/\/[^\s<>"'，。）)]+/i)
  if (match) return match[0]
  // Bare host without scheme, e.g. "meet.google.com/abc-defg-hij"
  const bare = trimmed.match(/^(?:[\w-]+\.)+[a-z]{2,}\/\S+/i)
  return bare ? `https://${bare[0]}` : null
}
