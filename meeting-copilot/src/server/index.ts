import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'
import { WebSocketServer, type RawData } from 'ws'
import type { ClientMessage, ServerMessage } from '../shared/protocol.ts'
import { loadConfig, loadDotEnv } from './config.ts'
import { AnthropicDocumentStore, DocumentError, MAX_DOCUMENT_BYTES, MemoryDocumentStore, type DocumentStore } from './documents.ts'
import { AnthropicLlm } from './llm/anthropic.ts'
import { MockLlm } from './llm/mock.ts'
import type { LlmClient } from './llm/types.ts'
import { MeetingSession } from './session.ts'
import { createSttProvider } from './stt/index.ts'

loadDotEnv()
const config = loadConfig()
const stt = createSttProvider(config)
const llm: LlmClient = config.anthropicConfigured ? new AnthropicLlm() : new MockLlm()
const documents: DocumentStore = config.anthropicConfigured ? new AnthropicDocumentStore() : new MemoryDocumentStore()
const distDir = resolve('dist')

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
}

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
    })
  }
  if (url.pathname === '/api/documents' || url.pathname.startsWith('/api/documents/')) {
    void handleDocuments(req, res, url)
    return
  }
  if (config.production) return serveStatic(url.pathname, res)
  res.writeHead(404).end('Not found (run `npm run dev:web` for the UI in development)')
})

// 64 KiB per frame is far above a 100 ms PCM frame (3.2 KB) and blocks abuse.
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 })

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname !== '/ws' || !isAllowed(req, url)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
    socket.destroy()
    return
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
})

wss.on('connection', (ws) => {
  const send = (message: ServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message))
  }
  const session = new MeetingSession({
    send,
    stt,
    llm,
    models: config.models,
    log: (message, extra) => console.warn(`[session] ${message}`, extra instanceof Error ? extra.message : ''),
    // One structured line per meeting: latency, usage, cost and feedback (no transcript content).
    onClosed: (sessionId, metrics) => console.log(JSON.stringify({ event: 'meeting.closed', sessionId, metrics })),
  })

  ws.on('message', (data: RawData, isBinary) => {
    try {
      if (isBinary) {
        session.handleAudio(toUint8(data))
        return
      }
      session.handleMessage(JSON.parse(data.toString()) as ClientMessage)
    } catch (error) {
      // One bad frame or provider bug must never take down other meetings.
      console.error('[session] message handling failed', error)
      send({ type: 'error', message: 'Invalid message', recoverable: true })
    }
  })
  ws.on('close', () => void session.close())
  ws.on('error', () => void session.close())
})

server.listen(config.port, () => {
  console.log(`meeting-copilot server on http://localhost:${config.port}`)
  console.log(`  STT: ${stt.name}${stt.name === 'mock' ? ' (set SONIOX_API_KEY or DEEPGRAM_API_KEY for real transcription)' : ''}`)
  console.log(`  LLM: ${llm.name}${llm.name === 'mock' ? ' (set ANTHROPIC_API_KEY for real translation and suggestions)' : ` (${config.models.copilot})`}`)
})

function isAllowed(req: IncomingMessage, url: URL): boolean {
  if (config.accessToken && url.searchParams.get('token') !== config.accessToken) return false
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
    console.error('[documents]', error)
    sendJson(res, { error: '文件上传失败，请稍后重试' }, 502)
  }
}

function readBody(req: IncomingMessage, limit: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
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
    req.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))))
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

function serveStatic(pathname: string, res: ServerResponse): void {
  const requested = normalize(join(distDir, decodeURIComponent(pathname)))
  let file = requested.startsWith(distDir) && existsSync(requested) && statSync(requested).isFile() ? requested : join(distDir, 'index.html')
  if (!existsSync(file)) {
    res.writeHead(404).end('Build the web app first: npm run build')
    return
  }
  file = resolve(file)
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
  createReadStream(file).pipe(res)
}
