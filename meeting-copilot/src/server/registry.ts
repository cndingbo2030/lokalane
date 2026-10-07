import type { ServerMessage } from '../shared/protocol.ts'
import type { MeetingSession } from './session.ts'

/** Messages produced while the client is away; partial transcripts are dropped first. */
const MAX_QUEUED = 2_000

/**
 * A send function that can be re-pointed at a new WebSocket. While detached
 * (network blip), messages are queued and flushed on re-attach, so translations
 * and suggestions produced during the outage are not lost.
 */
export class ResumableChannel {
  private target: ((message: ServerMessage) => void) | null
  private readonly queue: ServerMessage[] = []

  constructor(target: (message: ServerMessage) => void) {
    this.target = target
  }

  readonly send = (message: ServerMessage): void => {
    if (this.target) return this.target(message)
    if (message.type === 'transcript' && !message.segment.isFinal) return
    if (message.type === 'pong' || message.type === 'metrics') return
    this.queue.push(message)
    if (this.queue.length > MAX_QUEUED) this.queue.shift()
  }

  detach(): void {
    this.target = null
  }

  attach(target: (message: ServerMessage) => void): void {
    this.target = target
    for (const message of this.queue.splice(0)) target(message)
  }

  get attached(): boolean {
    return this.target !== null
  }
}

interface Entry {
  session: MeetingSession
  channel: ResumableChannel
  expiry?: ReturnType<typeof setTimeout>
}

/**
 * Keeps sessions alive for a grace period after their socket drops, so a client
 * that reconnects (Wi-Fi switch, laptop sleep) resumes the same meeting: same
 * transcript, STT streams and copilot context.
 */
export class SessionRegistry {
  private readonly entries = new Map<string, Entry>()

  constructor(private readonly graceMs = 120_000) {}

  add(session: MeetingSession, channel: ResumableChannel): void {
    this.entries.set(session.id, { session, channel })
  }

  /** Socket closed unexpectedly: keep the session for the grace period. */
  detach(sessionId: string): void {
    const entry = this.entries.get(sessionId)
    if (!entry) return
    entry.channel.detach()
    clearTimeout(entry.expiry)
    entry.expiry = setTimeout(() => void this.end(sessionId), this.graceMs)
  }

  /** Re-attach a detached session to a new socket; null if unknown, expired or still attached. */
  resume(sessionId: string, send: (message: ServerMessage) => void): MeetingSession | null {
    const entry = this.entries.get(sessionId)
    if (!entry || entry.channel.attached) return null
    clearTimeout(entry.expiry)
    entry.expiry = undefined
    entry.channel.attach(send)
    return entry.session
  }

  async end(sessionId: string): Promise<void> {
    const entry = this.entries.get(sessionId)
    if (!entry) return
    clearTimeout(entry.expiry)
    this.entries.delete(sessionId)
    await entry.session.close()
  }

  async endAll(): Promise<void> {
    await Promise.all([...this.entries.keys()].map((id) => this.end(id)))
  }

  get size(): number {
    return this.entries.size
  }
}
