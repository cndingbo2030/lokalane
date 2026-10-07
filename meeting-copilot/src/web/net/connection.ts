import type { ClientMessage, ServerMessage } from '../../shared/protocol.ts'

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed'

interface Handlers {
  onMessage: (message: ServerMessage) => void
  onStatus: (status: ConnectionStatus) => void
}

/** Drop audio instead of queueing when the uplink is congested; stale audio is worse than gaps. */
const MAX_BUFFERED_BYTES = 256 * 1024
const MAX_RETRIES = 5

/**
 * WebSocket to the copilot server. Re-sends the `start` message after a
 * reconnect so a network blip resumes the same meeting configuration.
 */
export class CopilotConnection {
  private socket: WebSocket | null = null
  private retries = 0
  private closedByUser = false
  private pingTimer: number | undefined

  constructor(
    private readonly url: string,
    private readonly start: ClientMessage,
    private readonly handlers: Handlers,
  ) {}

  connect(): void {
    this.closedByUser = false
    this.handlers.onStatus(this.retries === 0 ? 'connecting' : 'reconnecting')
    const socket = new WebSocket(this.url)
    socket.binaryType = 'arraybuffer'
    this.socket = socket

    socket.onopen = () => {
      this.retries = 0
      socket.send(JSON.stringify(this.start))
      this.handlers.onStatus('open')
      window.clearInterval(this.pingTimer)
      this.pingTimer = window.setInterval(() => this.send({ type: 'ping' }), 20_000)
    }
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return
      try {
        this.handlers.onMessage(JSON.parse(event.data) as ServerMessage)
      } catch {
        // ignore malformed frames
      }
    }
    socket.onclose = () => {
      window.clearInterval(this.pingTimer)
      if (this.closedByUser) return this.handlers.onStatus('closed')
      if (this.retries >= MAX_RETRIES) {
        this.handlers.onMessage({ type: 'error', message: '与服务器的连接已断开', recoverable: false })
        return this.handlers.onStatus('closed')
      }
      const delay = Math.min(8_000, 500 * 2 ** this.retries++)
      this.handlers.onStatus('reconnecting')
      window.setTimeout(() => this.connect(), delay)
    }
  }

  send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message))
  }

  sendAudio(frame: ArrayBuffer): void {
    const socket = this.socket
    if (socket?.readyState !== WebSocket.OPEN || socket.bufferedAmount > MAX_BUFFERED_BYTES) return
    socket.send(frame)
  }

  close(): void {
    this.closedByUser = true
    window.clearInterval(this.pingTimer)
    this.socket?.close()
    this.socket = null
  }
}

export function serverUrl(): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const token = new URLSearchParams(location.search).get('token')
  return `${protocol}//${location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`
}
