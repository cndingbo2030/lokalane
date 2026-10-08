import type { ClientMessage, ServerMessage } from '../../shared/protocol.ts'
import { accessToken } from './token.ts'

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed'

interface Handlers {
  onMessage: (message: ServerMessage) => void
  onStatus: (status: ConnectionStatus) => void
}

/** Drop audio instead of queueing when the uplink is congested; stale audio is worse than gaps. */
const MAX_BUFFERED_BYTES = 256 * 1024
/** Audio kept while disconnected: ~2.5 min of one source (less with VAD), ~5 MB. */
const MAX_BACKLOG_FRAMES = 1_500
/** Backlog replay pace after reconnecting: 20 frames per 250 ms ≈ 8× real time. */
const REPLAY_BATCH = 20
const REPLAY_INTERVAL_MS = 250
const MAX_RETRIES = 8

/**
 * WebSocket to the copilot server, built for flaky networks:
 * - reconnects with backoff and resumes the same server session (transcript,
 *   STT streams and copilot context survive the blip);
 * - buffers audio while disconnected and replays it after resuming, so nothing
 *   said during the outage is lost (frames carry their capture time).
 */
export class CopilotConnection {
  private socket: WebSocket | null = null
  private retries = 0
  private closedByUser = false
  private pingTimer: number | undefined
  private replayTimer: number | undefined
  private sessionId: string | null = null
  private readonly backlog: ArrayBuffer[] = []
  private droppedFrames = 0
  private retryTimer: number | undefined
  private downSince: number | null = null
  /** The server refused to start the meeting (busy, rate limited): retrying would not help. */
  private refused = false

  constructor(
    private readonly url: string,
    private readonly start: ClientMessage & { type: 'start' },
    private readonly handlers: Handlers,
    /**
     * `keepTryingMs`: keep reconnecting this long instead of giving up after a few
     * attempts (bot mode: the meeting goes on without this device, e.g. a phone
     * that slept). Reconnects right away when the device comes back online.
     */
    private readonly options: { keepTryingMs?: number } = {},
  ) {
    if (options.keepTryingMs) {
      window.addEventListener('online', this.wake)
      document.addEventListener('visibilitychange', this.wake)
    }
  }

  connect(): void {
    window.clearTimeout(this.retryTimer)
    this.retryTimer = undefined
    this.closedByUser = false
    this.handlers.onStatus(this.retries === 0 && !this.sessionId ? 'connecting' : 'reconnecting')
    const socket = new WebSocket(this.url)
    socket.binaryType = 'arraybuffer'
    this.socket = socket

    socket.onopen = () => {
      this.retries = 0
      socket.send(JSON.stringify(this.sessionId ? { ...this.start, resumeSessionId: this.sessionId } : this.start))
      window.clearInterval(this.pingTimer)
      this.pingTimer = window.setInterval(() => this.send({ type: 'ping' }), 20_000)
    }
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return
      let message: ServerMessage
      try {
        message = JSON.parse(event.data) as ServerMessage
      } catch {
        return
      }
      if (message.type === 'error' && !message.recoverable && !this.sessionId) this.refused = true
      if (message.type === 'ready') {
        this.downSince = null
        this.sessionId = message.sessionId
        this.handlers.onStatus('open')
        this.replayBacklog()
      }
      this.handlers.onMessage(message)
    }
    socket.onclose = () => {
      window.clearInterval(this.pingTimer)
      window.clearInterval(this.replayTimer)
      this.replayTimer = undefined
      if (this.closedByUser || this.refused) return this.handlers.onStatus('closed')
      this.downSince ??= Date.now()
      const exhausted = this.options.keepTryingMs ? Date.now() - this.downSince > this.options.keepTryingMs : this.retries >= MAX_RETRIES
      if (exhausted) {
        this.handlers.onMessage({ type: 'error', message: '与服务器的连接已断开，请检查网络后开始新会议', recoverable: false })
        return this.handlers.onStatus('closed')
      }
      const delay = Math.min(10_000, 500 * 2 ** this.retries++)
      this.handlers.onStatus('reconnecting')
      this.retryTimer = window.setTimeout(() => this.connect(), delay)
    }
  }

  /** Back online / back in the foreground: retry now instead of waiting out the backoff. */
  private readonly wake = () => {
    if (this.retryTimer !== undefined && document.visibilityState === 'visible') this.connect()
  }

  send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message))
  }

  sendAudio(frame: ArrayBuffer): void {
    if (this.closedByUser) return
    const socket = this.socket
    const live = socket?.readyState === WebSocket.OPEN && this.replayTimer === undefined && this.sessionId !== null
    if (!live) {
      // Disconnected (or still replaying): keep the audio, in order, for later.
      this.backlog.push(frame)
      if (this.backlog.length > MAX_BACKLOG_FRAMES) {
        this.backlog.shift()
        this.droppedFrames++
      }
      return
    }
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) return
    socket.send(frame)
  }

  /** Frames dropped because a disconnect outlasted the backlog. */
  get lostFrames(): number {
    return this.droppedFrames
  }

  /** Ends the meeting on the server too (no resume window). */
  close(): void {
    this.send({ type: 'leave' })
    this.closedByUser = true
    window.clearTimeout(this.retryTimer)
    if (this.options.keepTryingMs) {
      window.removeEventListener('online', this.wake)
      document.removeEventListener('visibilitychange', this.wake)
    }
    window.clearInterval(this.pingTimer)
    window.clearInterval(this.replayTimer)
    this.backlog.length = 0
    this.socket?.close()
    this.socket = null
  }

  private replayBacklog(): void {
    if (this.backlog.length === 0 || this.replayTimer !== undefined) return
    const tick = () => {
      const socket = this.socket
      if (socket?.readyState !== WebSocket.OPEN) return
      for (const frame of this.backlog.splice(0, REPLAY_BATCH)) socket.send(frame)
      if (this.backlog.length === 0) {
        window.clearInterval(this.replayTimer)
        this.replayTimer = undefined
      }
    }
    this.replayTimer = window.setInterval(tick, REPLAY_INTERVAL_MS)
    tick()
  }
}

export function serverUrl(): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const token = accessToken()
  return `${protocol}//${location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`
}
