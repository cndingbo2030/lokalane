import { join, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import type { ClientMessage, ServerMessage, SessionConfig } from '../shared/protocol.ts'
import { createCopilotServer, resolveStaticPath, type CopilotServer } from './app.ts'
import { loadConfig } from './config.ts'
import { MockLlm } from './llm/mock.ts'
import { MemoryDocumentStore } from './documents.ts'
import { ResumableChannel } from './registry.ts'
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

async function start(env: Record<string, string> = {}) {
  running = createCopilotServer({
    config: loadConfig({ PORT: '0', ...env }),
    stt: nullStt,
    llm: new MockLlm(),
    documents: new MemoryDocumentStore(),
    log: { log: () => {}, warn: () => {}, error: () => {} },
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
