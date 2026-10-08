import type { CalendarEvent, CalendarEventsRequest, CalendarEventsResponse } from '../../shared/calendar.ts'
import { ClientError } from '../errors.ts'
import { safeFetch, UnsafeUrlError, type SafeFetchOptions, type SafeResponse } from '../net/safeFetch.ts'
import { isCalendarText, parseCalendar } from './ics.ts'

const MAX_FEEDS = 5
const MAX_EVENTS = 200
const CACHE_TTL_MS = 5 * 60_000
const MAX_CACHE_ENTRIES = 50

export class CalendarRequestError extends ClientError {}

/**
 * Upcoming meetings from the user's calendar subscription links (ICS). Works
 * with Google Calendar, Outlook / Microsoft 365, Apple iCloud, Feishu,
 * Tencent and any other calendar that can publish an iCal address — no OAuth
 * app registration needed. Feeds are cached briefly to be polite to providers.
 */
export class CalendarService {
  private readonly cache = new Map<string, { at: number; text: string }>()

  constructor(
    private readonly options: {
      allowPrivateNetwork?: boolean
      fetch?: (url: string, options: SafeFetchOptions) => Promise<SafeResponse>
      now?: () => number
    } = {},
  ) {}

  async events(input: unknown): Promise<CalendarEventsResponse> {
    const request = validate(input)
    const now = (this.options.now ?? Date.now)()
    const from = new Date(now - 60 * 60_000) // include meetings already in progress
    const to = new Date(now + (request.days ?? 2) * 86_400_000)

    const results = await Promise.all(
      request.feeds.map(async (url, feed) => {
        try {
          const text = await this.load(url, now)
          return { events: parseCalendar(text, { from, to, timeZone: request.timeZone, feed }) }
        } catch (error) {
          return { error: { feed, message: describe(error) } }
        }
      }),
    )

    const seen = new Set<string>()
    const events: CalendarEvent[] = []
    for (const event of results.flatMap((r) => r.events ?? []).sort((a, b) => a.start.localeCompare(b.start))) {
      // The same meeting often appears in two subscribed calendars.
      const key = `${event.seriesId}@${event.start}`
      if (seen.has(key)) continue
      seen.add(key)
      events.push(event)
      if (events.length >= MAX_EVENTS) break
    }
    return { events, errors: results.flatMap((r) => (r.error ? [r.error] : [])) }
  }

  private async load(url: string, now: number): Promise<string> {
    const cached = this.cache.get(url)
    if (cached && now - cached.at < CACHE_TTL_MS) return cached.text
    const response = await (this.options.fetch ?? safeFetch)(url, {
      allowPrivateNetwork: this.options.allowPrivateNetwork,
      timeoutMs: 15_000,
      maxBytes: 10 * 1024 * 1024,
      headers: { accept: 'text/calendar, */*;q=0.5' },
    })
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      throw new CalendarRequestError(`日历链接无法访问（HTTP ${response.status}），可能已失效或需要重新生成`)
    }
    if (response.status < 200 || response.status >= 300) throw new CalendarRequestError(`日历服务返回 HTTP ${response.status}`)
    const text = response.body.toString('utf8')
    if (!isCalendarText(text)) throw new CalendarRequestError('这不是日历订阅（iCal/ICS）链接')
    this.cache.set(url, { at: now, text })
    if (this.cache.size > MAX_CACHE_ENTRIES) this.cache.delete(this.cache.keys().next().value!)
    return text
  }
}

function validate(input: unknown): CalendarEventsRequest {
  const body = (input ?? {}) as Partial<CalendarEventsRequest>
  if (!Array.isArray(body.feeds) || body.feeds.length === 0) throw new CalendarRequestError('请至少添加一个日历订阅链接')
  const feeds = body.feeds.filter((f): f is string => typeof f === 'string' && f.length > 0 && f.length <= 2_000).slice(0, MAX_FEEDS)
  if (feeds.length === 0) throw new CalendarRequestError('日历订阅链接无效')
  const days = Math.min(14, Math.max(1, Math.round(Number(body.days) || 2)))
  const timeZone = typeof body.timeZone === 'string' && body.timeZone.length < 64 ? body.timeZone : undefined
  return { feeds, days, timeZone }
}

function describe(error: unknown): string {
  if (error instanceof UnsafeUrlError || error instanceof CalendarRequestError) return error.message
  if (error instanceof Error && /ParserError|invalid|Unexpected/i.test(`${error.name} ${error.message}`)) return '日历内容无法解析'
  return '无法获取日历，请检查链接或稍后重试'
}
