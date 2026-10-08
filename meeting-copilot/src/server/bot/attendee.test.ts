import { describe, expect, it } from 'vitest'
import { AttendeeClient, AttendeeError } from './attendee.ts'

function client(reply: (url: string, init: RequestInit) => Response) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const attendee = new AttendeeClient({
    apiKey: 'key123',
    baseUrl: 'https://attendee.example.com/',
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return reply(url, init)
    }) as typeof fetch,
  })
  return { attendee, calls }
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('AttendeeClient', () => {
  it('creates a bot with token auth', async () => {
    const { attendee, calls } = client(() => json(201, { id: 'bot_1', state: 'joining' }))
    const bot = await attendee.createBot({
      meeting_url: 'https://zoom.us/j/123',
      bot_name: 'Meeting Copilot',
      websocket_settings: { audio: { url: 'wss://copilot.example.com/ws/bot?key=k', sample_rate: 16_000 } },
    })
    expect(bot).toEqual({ id: 'bot_1', state: 'joining' })
    expect(calls[0].url).toBe('https://attendee.example.com/api/v1/bots')
    expect(calls[0].init.method).toBe('POST')
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Token key123')
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ meeting_url: 'https://zoom.us/j/123' })
  })

  it('reads status, leaves and fetches the recording link', async () => {
    const { attendee, calls } = client((url) => {
      if (url.endsWith('/leave')) return new Response('', { status: 200 })
      if (url.endsWith('/recording')) return json(200, { url: 'https://s3.example.com/rec.mp3?sig=1', start_timestamp_ms: 1 })
      return json(200, { id: 'bot_1', state: 'joined_recording', events: [] })
    })
    expect((await attendee.getBot('bot_1')).state).toBe('joined_recording')
    await attendee.leave('bot_1')
    expect(await attendee.recordingUrl('bot_1')).toBe('https://s3.example.com/rec.mp3?sig=1')
    expect(calls.map((c) => `${c.init.method} ${new URL(c.url).pathname}`)).toEqual([
      'GET /api/v1/bots/bot_1',
      'POST /api/v1/bots/bot_1/leave',
      'GET /api/v1/bots/bot_1/recording',
    ])
  })

  it('turns API errors into readable messages', async () => {
    await expect(client(() => json(401, { detail: 'Invalid token.' })).attendee.getBot('x')).rejects.toThrow('ATTENDEE_API_KEY')
    const invalid = client(() => json(400, { meeting_url: ['Invalid meeting URL'] })).attendee.getBot('x')
    await expect(invalid).rejects.toThrow('meeting_url: Invalid meeting URL')
    await expect(invalid).rejects.toBeInstanceOf(AttendeeError)
    await expect(client(() => json(400, { error: 'A bot with this deduplication key already exists' })).attendee.getBot('x')).rejects.toThrow(
      /HTTP 400.*deduplication key/,
    )
    const offline = new AttendeeClient({
      apiKey: 'k',
      baseUrl: 'https://attendee.example.com',
      fetch: (async () => {
        throw new TypeError('fetch failed')
      }) as typeof fetch,
    })
    await expect(offline.getBot('x')).rejects.toThrow('无法连接会议机器人服务')
  })

  it('never hands out a non-https recording link', async () => {
    expect(await client(() => json(200, { url: 'javascript:alert(1)' })).attendee.recordingUrl('b')).toBeNull()
  })
})
