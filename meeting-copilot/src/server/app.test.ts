import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import type { ClientMessage, ServerMessage, SessionConfig } from '../shared/protocol.ts'
import { createCopilotServer, resolveStaticPath, securityHeaders, type CopilotServer } from './app.ts'
import type { AttendeeClient, CreateBotRequest } from './bot/attendee.ts'
import { BotManager } from './bot/manager.ts'
import { loadConfig } from './config.ts'
import { DeliveryService } from './delivery.ts'
import { MockLlm } from './llm/mock.ts'
import { MemoryDocumentStore } from './documents.ts'
import { RateLimiter } from './rateLimit.ts'
import { ResumableChannel, SessionRegistry } from './registry.ts'
import type { MeetingSession } from './session.ts'
import type { SttProvider } from './stt/types.ts'

const config: SessionConfig = {
  platform: 'zoom',
  spokenLanguages: ['en'],
  targetLanguage: 'zh',
  translate: false,
  copilot: { enabled: false, autoTrigger: false },
  brief: { myRole: '', goal: '', context: '' },
}

const nullStt: SttProvider = { name: 'fake', open: () => ({ write: () => {}, close: async () => {} }) }

let running: CopilotServer | null = null
afterEach(async () => {
  await running?.close()
  running = null
})

async function start(
  env: Record<string, string> = {},
  extra: { delivery?: DeliveryService; bots?: BotManager | null; stt?: SttProvider; staticDir?: string; limits?: Record<string, RateLimiter> } = {},
) {
  running = createCopilotServer({
    config: loadConfig({ PORT: '0', ...env }),
    stt: extra.stt ?? nullStt,
    llm: new MockLlm(),
    documents: new MemoryDocumentStore(),
    log: { log: () => {}, warn: () => {}, error: () => {} },
    ...extra,
  })
  const port = await running.listen(0, '127.0.0.1')
  return { server: running, url: (query = '') => `ws://127.0.0.1:${port}/ws${query}` }
}

/** A tiny client that records server messages and lets a test await one. */
function connect(url: string) {
  const ws = new WebSocket(url)
  const messages: ServerMessage[] = []
  const waiters: Array<{ match: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }> = []
  ws.on('message', (data) => {
    const message = JSON.parse(data.toString()) as ServerMessage
    messages.push(message)
    for (const waiter of waiters.splice(0)) {
      if (waiter.match(message)) waiter.resolve(message)
      else waiters.push(waiter)
    }
  })
  return {
    ws,
    messages,
    opened: new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve())
      ws.once('error', reject)
    }),
    send: (message: ClientMessage) => ws.send(JSON.stringify(message)),
    next: (match: (m: ServerMessage) => boolean) =>
      new Promise<ServerMessage>((resolve) => {
        const found = messages.find(match)
        if (found) resolve(found)
        else waiters.push({ match, resolve })
      }),
    close: () => new Promise<void>((resolve) => (ws.readyState === WebSocket.CLOSED ? resolve() : (ws.once('close', () => resolve()), ws.close()))),
  }
}

describe('copilot server', () => {
  it('resumes a meeting after the socket drops and flushes what happened meanwhile', async () => {
    const { server, url } = await start()
    const first = connect(url())
    await first.opened
    first.send({ type: 'start', config })
    const ready = await first.next((m) => m.type === 'ready')
    const sessionId = ready.type === 'ready' ? ready.sessionId : ''

    // Start the scripted demo, then drop the connection mid-meeting.
    first.send({ type: 'demo' })
    await first.next((m) => m.type === 'transcript')
    await first.close()
    await new Promise((r) => setTimeout(r, 1_500)) // demo keeps producing finals while detached
    expect(server.sessions.size).toBe(1)

    const second = connect(url())
    await second.opened
    second.send({ type: 'start', config, resumeSessionId: sessionId })
    const resumed = await second.next((m) => m.type === 'ready')
    expect(resumed).toMatchObject({ type: 'ready', sessionId, resumed: true })
    // Finals produced during the outage were queued and delivered on resume.
    await second.next((m) => m.type === 'transcript' && m.segment.isFinal)
    second.send({ type: 'leave' })
    await new Promise((r) => setTimeout(r, 50))
    expect(server.sessions.size).toBe(0)
    await second.close()
  })

  it('starts a fresh meeting when the resume id is unknown', async () => {
    const { url } = await start()
    const client = connect(url())
    await client.opened
    client.send({ type: 'start', config, resumeSessionId: 'does-not-exist' })
    const ready = await client.next((m) => m.type === 'ready')
    expect(ready).toMatchObject({ type: 'ready' })
    expect(ready.type === 'ready' && ready.resumed).toBeFalsy()
    await client.close()
  })

  it('rejects connections without the access token', async () => {
    const { url } = await start({ ACCESS_TOKEN: 'secret' })
    await expect(connect(url()).opened).rejects.toThrow()
    const ok = connect(url('?token=secret'))
    await ok.opened
    await ok.close()
  })
})

describe('JSON endpoints', () => {
  it('generates a brief and maps validation errors to 400', async () => {
    const { url } = await start()
    const base = url().replace('ws://', 'http://').replace('/ws', '')
    const ok = await fetch(`${base}/api/brief`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: { title: 'Pilot review' }, targetLanguage: 'zh' }),
    })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ goal: expect.any(String), anticipatedQuestions: expect.any(Array) })

    const bad = await fetch(`${base}/api/brief`, { method: 'POST', body: '{}' })
    expect(bad.status).toBe(400)
    expect(((await bad.json()) as { error: string }).error).toContain('日历')

    const malformed = await fetch(`${base}/api/calendar/events`, { method: 'POST', body: 'not json' })
    expect(malformed.status).toBe(400)
  })

  it('delivers meeting results through the webhook proxy', async () => {
    const posted: string[] = []
    const delivery = new DeliveryService({
      fetch: async (target, options) => {
        posted.push(`${target} ${String(options.body).slice(0, 20)}`)
        return { status: 200, headers: {}, body: Buffer.from('ok'), url: target }
      },
    })
    const { url } = await start({}, { delivery })
    const base = url().replace('ws://', 'http://').replace('/ws', '')
    const post = (body: unknown) => fetch(`${base}/api/deliver`, { method: 'POST', body: JSON.stringify(body) })
    const payload = { title: 'Pilot', language: 'zh', outcomes: { decisions: [], actionItems: [], followUpEmail: { subject: '', body: '' } } }

    const ok = await post({ target: { type: 'slack', url: 'https://hooks.slack.com/services/a/b/c' }, payload })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ ok: true })
    expect(posted[0]).toMatch(/^https:\/\/hooks\.slack\.com\/services\/a\/b\/c \{/)

    const wrong = await post({ target: { type: 'feishu', url: 'https://hooks.slack.com/services/a/b/c' }, payload })
    expect(wrong.status).toBe(400)
    expect(((await wrong.json()) as { error: string }).error).toContain('飞书')
  })

  it('requires the access token on JSON endpoints too', async () => {
    const { url } = await start({ ACCESS_TOKEN: 'secret' })
    const base = url().replace('ws://', 'http://').replace('/ws', '')
    expect((await fetch(`${base}/api/access`)).status).toBe(403)
    expect((await fetch(`${base}/api/access?token=secret`)).status).toBe(200)
    expect((await fetch(`${base}/api/brief`, { method: 'POST', body: '{}' })).status).toBe(403)
    expect((await fetch(`${base}/api/deliver`, { method: 'POST', body: '{}' })).status).toBe(403)
  })
})

describe('meeting bot mode', () => {
  it('streams the bot’s audio socket into the meeting and rejects unknown keys', async () => {
    const created: CreateBotRequest[] = []
    const attendee = {
      createBot: async (request: CreateBotRequest) => (created.push(request), { id: 'bot_1', state: 'joining' }),
      getBot: async (id: string) => ({ id, state: 'joined_recording' }),
      leave: async () => {},
      recordingUrl: async () => null,
    }
    let port = 0
    const bots = new BotManager({
      client: attendee as unknown as AttendeeClient,
      audioUrl: (key) => `ws://127.0.0.1:${port}/ws/bot?key=${key}`,
      pollMs: { joining: 5, joined: 5 },
    })
    const written: number[] = []
    const stt: SttProvider = { name: 'fake', open: () => ({ write: (pcm) => void written.push(pcm.byteLength), close: async () => {} }) }
    const { url } = await start({ ACCESS_TOKEN: 'secret' }, { bots, stt })
    port = Number(new URL(url()).port)

    const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json()
    expect(health).toMatchObject({ bot: { enabled: true } })

    const client = connect(url('?token=secret'))
    await client.opened
    client.send({ type: 'start', config: { ...config, meetingUrl: 'https://meet.google.com/abc-defg-hij', platform: 'google-meet', bot: { name: 'Copilot' } } })
    await client.next((m) => m.type === 'bot' && m.state === 'joined_recording')

    // Unknown keys are refused; the bot's own key works without the access token.
    await expect(connect(`ws://127.0.0.1:${port}/ws/bot?key=guess`).opened).rejects.toThrow()
    const audioSocket = new WebSocket(created[0].websocket_settings.audio.url)
    await new Promise((resolve, reject) => (audioSocket.once('open', resolve), audioSocket.once('error', reject)))
    const chunk = Buffer.from(new Int16Array(1600).fill(9_000).buffer).toString('base64')
    for (let i = 0; i < 5; i++) {
      audioSocket.send(JSON.stringify({ bot_id: 'bot_1', trigger: 'realtime_audio.mixed', data: { chunk, sample_rate: 16_000, timestamp_ms: 1_000 + i * 100 } }))
    }
    await new Promise((r) => setTimeout(r, 100))
    expect(written.reduce((a, b) => a + b, 0)).toBe(5 * 3200)
    audioSocket.close()
    await client.close()
  })

  it('reports why bot mode is off', async () => {
    const { url } = await start()
    const health = await (await fetch(url().replace('ws://', 'http://').replace('/ws', '/health'))).json()
    expect(health).toMatchObject({ bot: { enabled: false, reason: expect.stringContaining('ATTENDEE_API_KEY') } })
  })
})

describe('bot config', () => {
  it('needs an API key and a public https URL', () => {
    expect(loadConfig({}).bot).toBeNull()
    expect(loadConfig({ ATTENDEE_API_KEY: 'k' }).botUnavailableReason).toContain('PUBLIC_URL')
    expect(loadConfig({ ATTENDEE_API_KEY: 'k', PUBLIC_URL: 'http://copilot.example.com' }).botUnavailableReason).toContain('https')
    expect(loadConfig({ ATTENDEE_API_KEY: 'k', PUBLIC_URL: 'https://copilot.example.com/app/' }).bot).toEqual({
      apiKey: 'k',
      baseUrl: 'https://app.attendee.dev',
      audioBaseUrl: 'wss://copilot.example.com/app',
    })
  })
})

describe('live link sharing', () => {
  it('lets viewers follow a meeting read-only until the owner stops sharing', async () => {
    const { url } = await start({ ACCESS_TOKEN: 'secret' })
    const watch = (token: string) => url().replace('/ws', `/ws/watch?share=${token}`)
    const owner = connect(url('?token=secret'))
    await owner.opened
    owner.send({ type: 'start', config })
    await owner.next((m) => m.type === 'ready')
    owner.send({ type: 'speakers', names: { S1: 'Alice' } })
    owner.send({ type: 'demo' })
    await owner.next((m) => m.type === 'transcript' && m.segment.isFinal)

    owner.send({ type: 'share', enabled: true })
    const shared = await owner.next((m) => m.type === 'share' && Boolean(m.token))
    const token = shared.type === 'share' ? shared.token! : ''
    expect(token.length).toBeGreaterThanOrEqual(24)

    // A wrong token is refused; the right one needs no access token.
    await expect(connect(watch('guess')).opened).rejects.toThrow()
    const viewer = connect(watch(token))
    await viewer.opened
    const snapshot = await viewer.next((m) => m.type === 'snapshot')
    expect(snapshot).toMatchObject({ type: 'snapshot', speakerNames: { S1: 'Alice' } })
    expect('suggestions' in snapshot).toBe(false)
    expect(snapshot.type === 'snapshot' && snapshot.segments.length).toBeGreaterThan(0)
    await owner.next((m) => m.type === 'share' && m.viewers === 1)

    // Live lines keep flowing; whatever the viewer sends is ignored.
    const seen = snapshot.type === 'snapshot' ? snapshot.segments.length : 0
    viewer.send({ type: 'leave' })
    await viewer.next((m) => m.type === 'transcript' && m.segment.isFinal)
    expect(viewer.messages.filter((m) => m.type === 'transcript' && m.segment.isFinal).length + seen).toBeGreaterThan(seen)

    owner.send({ type: 'share', enabled: true, includeSuggestions: true })
    const resync = await viewer.next((m) => m.type === 'snapshot' && Array.isArray(m.suggestions))
    expect(resync.type === 'snapshot' && resync.suggestions).toEqual(expect.any(Array))

    owner.send({ type: 'share', enabled: false })
    expect(await viewer.next((m) => m.type === 'share.ended')).toEqual({ type: 'share.ended', reason: 'stopped' })
    await viewer.close()
    await expect(connect(watch(token)).opened).rejects.toThrow()
    owner.send({ type: 'leave' })
    await owner.close()
  })

  it('tells viewers when the meeting ends', async () => {
    const { url } = await start()
    const owner = connect(url())
    await owner.opened
    owner.send({ type: 'start', config })
    await owner.next((m) => m.type === 'ready')
    owner.send({ type: 'share', enabled: true })
    const shared = await owner.next((m) => m.type === 'share' && Boolean(m.token))
    const viewer = connect(url().replace('/ws', `/ws/watch?share=${shared.type === 'share' ? shared.token : ''}`))
    await viewer.opened
    await viewer.next((m) => m.type === 'snapshot')
    owner.send({ type: 'leave' })
    expect(await viewer.next((m) => m.type === 'share.ended')).toEqual({ type: 'share.ended', reason: 'ended' })
    await owner.close()
  })
})

describe('production safeguards', () => {
  it('rate-limits AI endpoints per client with Retry-After', async () => {
    const { url } = await start({}, { limits: { llm: new RateLimiter({ capacity: 2, perMinute: 1 }) } })
    const base = url().replace('ws://', 'http://').replace('/ws', '')
    const brief = () => fetch(`${base}/api/brief`, { method: 'POST', body: JSON.stringify({ event: { title: 'x' }, targetLanguage: 'zh' }) })
    expect((await brief()).status).toBe(200)
    expect((await brief()).status).toBe(200)
    const limited = await brief()
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(((await limited.json()) as { error: string }).error).toContain('频繁')
  })

  it('refuses new meetings beyond the server cap without breaking existing ones', async () => {
    const { url, server } = await start({ MAX_SESSIONS: '1' })
    const first = connect(url())
    await first.opened
    first.send({ type: 'start', config })
    await first.next((m) => m.type === 'ready')
    const second = connect(url())
    await second.opened
    second.send({ type: 'start', config })
    expect(await second.next((m) => m.type === 'error')).toMatchObject({ recoverable: false, message: expect.stringContaining('繁忙') })
    expect(server.sessions.size).toBe(1)
    first.send({ type: 'leave' })
    await first.close()
  })

  it('serves the app with security and caching headers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'copilot-static-'))
    mkdirSync(join(dir, 'assets'))
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>x</title>')
    writeFileSync(join(dir, 'assets', 'index-abc.js'), 'console.log(1)')
    const { url } = await start({}, { staticDir: dir })
    const base = url().replace('ws://', 'http://').replace('/ws', '')
    const page = await fetch(`${base}/?token=secret`)
    expect(page.headers.get('referrer-policy')).toBe('no-referrer')
    expect(page.headers.get('cache-control')).toBe('no-cache')
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(page.headers.get('content-security-policy')).toMatch(/connect-src 'self' ws:\/\/127\.0\.0\.1:\d+ wss:\/\/127\.0\.0\.1:\d+/)
    const asset = await fetch(`${base}/assets/index-abc.js`)
    expect(asset.headers.get('cache-control')).toContain('immutable')
  })

  it('never puts a hostile Host header into the CSP', () => {
    expect(securityHeaders("evil.com; script-src *")['content-security-policy']).toContain("connect-src 'self';")
  })
})

describe('SessionRegistry', () => {
  it('keeps bot meetings longer than the default grace period', async () => {
    const registry = new SessionRegistry(10)
    const closed: string[] = []
    const fake = (id: string, detachedGraceMs?: number) => ({ id, detachedGraceMs, close: async () => void closed.push(id) }) as unknown as MeetingSession
    registry.add(fake('plain'), new ResumableChannel(() => {}))
    registry.add(fake('bot', 80), new ResumableChannel(() => {}))
    registry.detach('plain')
    registry.detach('bot')
    await new Promise((r) => setTimeout(r, 40))
    expect(closed).toEqual(['plain'])
    await new Promise((r) => setTimeout(r, 80))
    expect(closed).toEqual(['plain', 'bot'])
  })
})

describe('ResumableChannel', () => {
  it('queues important messages while detached and drops partials', () => {
    const received: ServerMessage[] = []
    const channel = new ResumableChannel((m) => received.push(m))
    channel.detach()
    channel.send({ type: 'transcript', segment: { id: 'a', source: 'remote', text: 'par', isFinal: false, startMs: 0, endMs: 1 } })
    channel.send({ type: 'translation', segmentId: 'a', text: '译文', targetLanguage: 'zh' })
    channel.send({ type: 'pong' })
    expect(received).toEqual([])
    channel.attach((m) => received.push(m))
    expect(received.map((m) => m.type)).toEqual(['translation'])
  })
})

describe('resolveStaticPath', () => {
  const root = join(sep, 'app', 'dist')
  it('allows files inside the root', () => {
    expect(resolveStaticPath(root, '/assets/index.js')).toBe(join(root, 'assets', 'index.js'))
    expect(resolveStaticPath(root, '/')).toBe(root + sep)
  })

  it('rejects traversal, including into sibling folders that share the prefix', () => {
    expect(resolveStaticPath(root, '/..%2Fdist-server%2Fapp.mjs')).toBeNull()
    expect(resolveStaticPath(root, '/..%2F..%2Fetc%2Fpasswd')).toBeNull()
    expect(resolveStaticPath(root, '/%E0%A4%A')).toBeNull()
  })
})
