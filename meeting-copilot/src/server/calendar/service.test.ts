import { describe, expect, it } from 'vitest'
import type { SafeResponse } from '../net/safeFetch.ts'
import { CalendarService } from './service.ts'

const feed = (uid: string, start: string, extra = '') =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `SUMMARY:${uid}`,
    `DTSTART:${start}`,
    'DURATION:PT30M',
    extra,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter(Boolean)
    .join('\r\n')

const ok = (text: string): SafeResponse => ({ status: 200, headers: {}, body: Buffer.from(text), url: 'https://x' })
const now = Date.parse('2026-10-07T00:00:00Z')

describe('CalendarService', () => {
  it('merges feeds, de-duplicates shared meetings and reports per-feed errors', async () => {
    const responses: Record<string, SafeResponse> = {
      'https://a/cal.ics': ok(feed('shared', '20261007T020000Z', 'LOCATION:https://meet.google.com/abc-defg-hij')),
      'https://b/cal.ics': ok(feed('shared', '20261007T020000Z')),
      'https://c/cal.ics': { status: 404, headers: {}, body: Buffer.from(''), url: 'https://c' },
      'https://d/login': ok('<html>Sign in</html>'),
    }
    const service = new CalendarService({ fetch: async (url) => responses[url], now: () => now })
    const result = await service.events({ feeds: Object.keys(responses) })
    expect(result.events).toHaveLength(1)
    expect(result.events[0]).toMatchObject({ title: 'shared', feed: 0, meeting: { platform: 'google-meet' } })
    expect(result.errors).toEqual([
      { feed: 2, message: expect.stringContaining('HTTP 404') },
      { feed: 3, message: '这不是日历订阅（iCal/ICS）链接' },
    ])
  })

  it('caches feeds for a few minutes', async () => {
    let calls = 0
    let clock = now
    const service = new CalendarService({
      fetch: async () => {
        calls++
        return ok(feed('m', '20261007T020000Z'))
      },
      now: () => clock,
    })
    await service.events({ feeds: ['https://a/cal.ics'] })
    await service.events({ feeds: ['https://a/cal.ics'] })
    expect(calls).toBe(1)
    clock += 6 * 60_000
    await service.events({ feeds: ['https://a/cal.ics'] })
    expect(calls).toBe(2)
  })

  it('blocks private addresses through the safe fetch layer and validates input', async () => {
    const service = new CalendarService({ now: () => now })
    const result = await service.events({ feeds: ['https://127.0.0.1/cal.ics', 'webcal://10.0.0.8/cal.ics'] })
    expect(result.errors.map((e) => e.message)).toEqual(['不允许访问内网或保留地址', '不允许访问内网或保留地址'])
    await expect(service.events({ feeds: [] })).rejects.toThrow('至少')
    await expect(service.events({})).rejects.toThrow('至少')
  })
})
