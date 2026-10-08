import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { WebSocketServer, type RawData, type WebSocket } from 'ws'
import type { ClientMessage, ServerMessage } from '../shared/protocol.ts'
import { generateBrief } from './ai/brief.ts'
import { AttendeeClient } from './bot/attendee.ts'
import { BotManager } from './bot/manager.ts'
import { CalendarService } from './calendar/service.ts'
import type { ServerConfig } from './config.ts'
import { DeliveryService } from './delivery.ts'
import { ClientError } from './errors.ts'
import { AnthropicDocumentStore, DocumentError, MAX_DOCUMENT_BYTES, MemoryDocumentStore, type DocumentStore } from './documents.ts'
import { AnthropicLlm } from './llm/anthropic.ts'
import { MockLlm } from './llm/mock.ts'
import type { LlmClient } from './llm/types.ts'
import { ResumableChannel, SessionRegistry } from './registry.ts'
import { ShareHub } from './share.ts'
import { MeetingSession } from './session.ts'
import { createSttProvider } from './stt/index.ts'
import type { SttProvider } from './stt/types.ts'

export interface CopilotServerOptions {
  config: ServerConfig
  /** Serve the built web app from this directory (production / desktop). */
  staticDir?: string
  /** Override providers (tests). */
  stt?: SttProvider
  llm?: LlmClient
  documents?: DocumentStore
  calendar?: CalendarService
  delivery?: DeliveryService
  /** Meeting bots; defaults to Attendee when configured (tests inject a fake). */
  bots?: BotManager | null
  log?: Pick<Console, 'log' | 'warn' | 'error'>
  /** How long a disconnected meeting is kept for resumption. */
  resumeGraceMs?: number
}

export interface CopilotServer {
  readonly server: Server
  readonly stt: SttProvider
  readonly llm: LlmClient
  readonly sessions: SessionRegistry
  readonly bots: BotManager | null
  readonly shares: ShareHub
  /** Resolves with the bound port (pass 0 for an ephemeral port). */
  listen(port: number, host?: string): Promise<number>
  close(): Promise<void>
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
}

/**
 * HTTP + WebSocket server. Used standalone (src/server/index.ts) and embedded
 * in the desktop app's main process (src/desktop/main.ts).
 */
export function createCopilotServer(options: CopilotServerOptions): CopilotServer {
  const { config } = options
  const log = options.log ?? console
  const stt = options.stt ?? createSttProvider(config)
  const llm: LlmClient = options.llm ?? (config.anthropicConfigured ? new AnthropicLlm() : new MockLlm())
  const documents: DocumentStore = options.documents ?? (config.anthropicConfigured ? new AnthropicDocumentStore() : new MemoryDocumentStore())
  const staticDir = options.staticDir ? resolve(options.staticDir) : undefined
  const sessions = new SessionRegistry(options.resumeGraceMs)
  const shares = new ShareHub()
  /** Each session's resumable channel to its owner (follows the owner across reconnects). */
  const owners = new Map<string, (message: ServerMessage) => void>()
  const calendar = options.calendar ?? new CalendarService({ allowPrivateNetwork: config.allowPrivateNetwork })
  const delivery = options.delivery ?? new DeliveryService({ allowPrivateNetwork: config.allowPrivateNetwork })
  const bots =
    options.bots !== undefined
      ? options.bots
      : config.bot
        ? new BotManager({
            client: new AttendeeClient({ apiKey: config.bot.apiKey, baseUrl: config.bot.baseUrl }),
            audioUrl: (key) => `${config.bot!.audioBaseUrl}/ws/bot?key=${key}`,
            log: (message) => log.warn(message),
          })
        : null

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname === '/health') {
      return sendJson(res, {
        ok: true,
        stt: stt.name,
        llm: llm.name,
        documents: documents.name,
        models: config.models,
        auth: Boolean(config.accessToken),
        bot: bots ? { enabled: true } : { enabled: false, reason: config.botUnavailableReason },
      })
    }
    if (url.pathname === '/api/calendar/events' && req.method === 'POST') {
      void handleJson(req, res, url, (body) => calendar.events(body))
      return
    }
    if (url.pathname === '/api/brief' && req.method === 'POST') {
      void handleJson(req, res, url, (body) => generateBrief(llm, config.models.summary, body))
      return
    }
    if (url.pathname === '/api/deliver' && req.method === 'POST') {
      void handleJson(req, res, url, (body) => delivery.deliver(body))
      return
    }
    if (url.pathname === '/api/documents' || url.pathname.startsWith('/api/documents/')) {
      void handleDocuments(req, res, url)
      return
    }
    if (staticDir) return serveStatic(staticDir, url.pathname, res)
    res.writeHead(404).end('Not found (run `npm run dev:web` for the UI in development)')
  })

  // 64 KiB per frame is far above a 100 ms PCM frame (3.2 KB) and blocks abuse.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 })
  // The bot service's audio stream: base64 JSON chunks, authenticated by the bot's secret key.
  const botWss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 })
  // Live-link viewers only listen.
  const watchWss = new WebSocketServer({ noServer: true, maxPayload: 1024 })

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname === '/ws/bot') {
      const bot = bots?.botForKey(url.searchParams.get('key'))
      if (!bot) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
        socket.destroy()
        return
      }
      botWss.handleUpgrade(req, socket, head, (ws) => bot.attachSocket(ws))
      return
    }
    if (url.pathname === '/ws/watch') {
      // The share token is the credential (no access token), but the origin check still applies.
      const token = url.searchParams.get('share')
      if (!originAllowed(req) || !shares.has(token)) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
        socket.destroy()
        return
      }
      watchWss.handleUpgrade(req, socket, head, (ws) => shares.attachViewer(token!, ws))
      return
    }
    if (url.pathname !== '/ws' || !isAllowed(req, url)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
  })

  wss.on('connection', (ws: WebSocket) => {
    const send = (message: ServerMessage) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message))
    }
    let session: MeetingSession | null = null
    let left = false

    const startOrResume = (message: Extract<ClientMessage, { type: 'start' }>) => {
      if (message.resumeSessionId) {
        const resumed = sessions.resume(message.resumeSessionId, send)
        if (resumed) {
          session = resumed
          session.announceResumed()
          return
        }
      }
      const channel = new ResumableChannel(send)
      const created: MeetingSession = new MeetingSession({
        send: (m) => {
          channel.send(m)
          shares.broadcast(created.id, m)
        },
        stt,
        llm,
        models: config.models,
        bots: bots ?? undefined,
        log: (text, extra) => log.warn(`[session] ${text}`, extra instanceof Error ? extra.message : ''),
        // One structured line per meeting: latency, usage, cost and feedback (no transcript content).
        onClosed: (sessionId, metrics) => {
          shares.disable(sessionId, 'ended')
          owners.delete(sessionId)
          log.log(JSON.stringify({ event: 'meeting.closed', sessionId, metrics }))
        },
      })
      session = created
      owners.set(created.id, channel.send)
      sessions.add(created, channel)
      created.handleMessage(message)
    }

    const toggleShare = (message: Extract<ClientMessage, { type: 'share' }>) => {
      const current = session
      if (!current) return
      if (!message.enabled) {
        shares.disable(current.id)
        return send({ type: 'share', includeSuggestions: false, viewers: 0 })
      }
      const notifyOwner = owners.get(current.id) ?? send
      notifyOwner(
        shares.enable(current.id, {
          includeSuggestions: message.includeSuggestions === true,
          snapshot: (includeSuggestions) => current.snapshot(includeSuggestions),
          notifyOwner,
        }),
      )
    }

    ws.on('message', (data: RawData, isBinary) => {
      try {
        if (isBinary) {
          session?.handleAudio(toUint8(data))
          return
        }
        const message = JSON.parse(data.toString()) as ClientMessage
        if (message.type === 'start' && !session) return startOrResume(message)
        if (message.type === 'leave') {
          left = true
          if (session) void sessions.end(session.id)
          return
        }
        if (message.type === 'ping') return send({ type: 'pong' })
        if (message.type === 'share') return toggleShare(message)
        session?.handleMessage(message)
      } catch (error) {
        // One bad frame or provider bug must never take down other meetings.
        log.error('[session] message handling failed', error)
        send({ type: 'error', message: 'Invalid message', recoverable: true })
      }
    })
    const onGone = () => {
      if (session && !left) sessions.detach(session.id)
    }
    ws.on('close', onGone)
    ws.on('error', onGone)
  })

  function isAllowed(req: IncomingMessage, url: URL): boolean {
    if (config.accessToken && url.searchParams.get('token') !== config.accessToken) return false
    return originAllowed(req)
  }

  /** Browsers send Origin on WebSocket upgrades: only our own pages may connect. */
  function originAllowed(req: IncomingMessage): boolean {
    const origin = req.headers.origin
    if (!origin) return true
    if (config.allowedOrigins.includes(origin)) return true
    try {
      const originHost = new URL(origin).host
      if (originHost === req.headers.host) return true
      // Vite dev server proxies from localhost:5180.
      return !config.production && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(originHost)
    } catch {
      return false
    }
  }

  /** JSON endpoints: same auth as the WebSocket, small bodies, typed client errors. */
  async function handleJson(req: IncomingMessage, res: ServerResponse, url: URL, handler: (body: unknown) => Promise<unknown>): Promise<void> {
    if (!isAllowed(req, url)) return sendJson(res, { error: 'forbidden' }, 403)
    let body: unknown
    try {
      body = JSON.parse(Buffer.from(await readBody(req, 256 * 1024)).toString('utf8') || '{}')
    } catch {
      return sendJson(res, { error: '请求格式不正确' }, 400)
    }
    try {
      sendJson(res, await handler(body))
    } catch (error) {
      if (error instanceof ClientError) return sendJson(res, { error: error.message }, error.status)
      log.error(`[api] ${url.pathname}`, error)
      sendJson(res, { error: '服务暂时不可用，请稍后重试' }, 500)
    }
  }

  async function handleDocuments(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    if (!isAllowed(req, url)) return sendJson(res, { error: 'forbidden' }, 403)
    try {
      if (req.method === 'POST' && url.pathname === '/api/documents') {
        const filename = decodeURIComponent(String(req.headers['x-filename'] ?? 'document')).slice(0, 200)
        const body = await readBody(req, MAX_DOCUMENT_BYTES)
        const ref = await documents.upload(filename, String(req.headers['content-type'] ?? ''), body)
        return sendJson(res, ref, 201)
      }
      const id = url.pathname.slice('/api/documents/'.length)
      if (req.method === 'DELETE' && /^[\w-]{1,128}$/.test(id)) {
        await documents.delete(id)
        return sendJson(res, { ok: true })
      }
      sendJson(res, { error: 'not found' }, 404)
    } catch (error) {
      if (error instanceof DocumentError) return sendJson(res, { error: error.message }, error.status)
      log.error('[documents]', error)
      sendJson(res, { error: '文件上传失败，请稍后重试' }, 502)
    }
  }

  return {
    server,
    stt,
    llm,
    sessions,
    bots,
    shares,
    listen(port, host) {
      return new Promise((resolvePort, reject) => {
        server.once('error', reject)
        server.listen(port, host, () => resolvePort((server.address() as AddressInfo).port))
      })
    },
    async close() {
      for (const client of wss.clients) client.terminate()
      for (const client of botWss.clients) client.terminate()
      for (const client of watchWss.clients) client.terminate()
      await sessions.endAll()
      bots?.disposeAll()
      await new Promise<void>((done) => server.close(() => done()))
    },
  }
}

function readBody(req: IncomingMessage, limit: number): Promise<Uint8Array> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new DocumentError('文件超过 32 MB', 413))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolveBody(new Uint8Array(Buffer.concat(chunks))))
    req.on('error', reject)
  })
}

function toUint8(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data))
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}

function sendJson(res: ServerResponse, body: unknown, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}

/** Exported for tests: resolves a URL path inside `root`, or null if it escapes it. */
export function resolveStaticPath(root: string, pathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  const requested = normalize(join(root, decoded))
  // `root + sep`: a bare prefix check would also accept siblings like dist-server/.
  return requested === root || requested.startsWith(root + sep) ? requested : null
}

function serveStatic(root: string, pathname: string, res: ServerResponse): void {
  const requested = resolveStaticPath(root, pathname)
  const file = requested && existsSync(requested) && statSync(requested).isFile() ? requested : join(root, 'index.html')
  if (!existsSync(file)) {
    res.writeHead(404).end('Build the web app first: npm run build')
    return
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
  createReadStream(file).pipe(res)
}
