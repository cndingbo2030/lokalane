import { randomBytes } from 'node:crypto'
import type { RawData, WebSocket } from 'ws'
import type { ServerMessage, ShareSnapshot } from '../shared/protocol.ts'

const MAX_VIEWERS = 20

interface Share {
  token: string
  sessionId: string
  includeSuggestions: boolean
  viewers: Set<WebSocket>
  snapshot: (includeSuggestions: boolean) => ShareSnapshot
  /** The owner's channel: viewer count updates. */
  notifyOwner: (message: ServerMessage) => void
}

/**
 * Read-only live links: a colleague (or someone who does not speak the
 * meeting's language) follows the transcript and translation as it happens.
 *
 * The random token in the link is the only credential: it bypasses the
 * server's access token by design, works for one meeting, and stops working
 * when the owner turns sharing off or the meeting ends. Viewers can only
 * listen; anything they send is ignored. AI suggestions are shared only when
 * the owner opts in, and the follow-up email draft never is.
 */
export class ShareHub {
  private readonly byToken = new Map<string, Share>()
  private readonly bySession = new Map<string, Share>()

  /** Turns the live link on (or updates its options) and returns its state for the owner. */
  enable(
    sessionId: string,
    options: { includeSuggestions: boolean; snapshot: Share['snapshot']; notifyOwner: Share['notifyOwner'] },
  ): Extract<ServerMessage, { type: 'share' }> {
    let share = this.bySession.get(sessionId)
    if (!share) {
      share = { token: randomBytes(18).toString('base64url'), sessionId, viewers: new Set(), ...options }
      this.byToken.set(share.token, share)
      this.bySession.set(sessionId, share)
    } else {
      const changed = share.includeSuggestions !== options.includeSuggestions
      share.includeSuggestions = options.includeSuggestions
      share.notifyOwner = options.notifyOwner
      // Viewers re-sync, so turning suggestions on shows earlier ones and turning them off hides them.
      if (changed) for (const viewer of share.viewers) send(viewer, share.snapshot(share.includeSuggestions))
    }
    return this.state(share)
  }

  disable(sessionId: string, reason: 'stopped' | 'ended' = 'stopped'): void {
    const share = this.bySession.get(sessionId)
    if (!share) return
    this.bySession.delete(sessionId)
    this.byToken.delete(share.token)
    for (const viewer of share.viewers) {
      send(viewer, { type: 'share.ended', reason })
      viewer.close(1000, reason)
    }
    share.viewers.clear()
  }

  has(token: string | null): boolean {
    const share = token ? this.byToken.get(token) : undefined
    return Boolean(share && share.viewers.size < MAX_VIEWERS)
  }

  /** A viewer connected with a valid token: catch it up, then stream. */
  attachViewer(token: string, ws: WebSocket): void {
    const share = this.byToken.get(token)
    if (!share || share.viewers.size >= MAX_VIEWERS) return void ws.close(1008, 'invalid share')
    share.viewers.add(ws)
    send(ws, share.snapshot(share.includeSuggestions))
    share.notifyOwner(this.state(share))
    ws.on('message', (data: RawData) => {
      if (data.toString() === '{"type":"ping"}') send(ws, { type: 'pong' })
    })
    ws.on('close', () => {
      if (share.viewers.delete(ws) && this.bySession.get(share.sessionId) === share) share.notifyOwner(this.state(share))
    })
    ws.on('error', () => {})
  }

  /** Forwards what viewers may see of a session's live messages. */
  broadcast(sessionId: string, message: ServerMessage): void {
    const share = this.bySession.get(sessionId)
    if (!share || share.viewers.size === 0) return
    const visible = forViewers(message, share.includeSuggestions)
    if (!visible) return
    const data = JSON.stringify(visible)
    for (const viewer of share.viewers) if (viewer.readyState === viewer.OPEN) viewer.send(data)
  }

  private state(share: Share): Extract<ServerMessage, { type: 'share' }> {
    return { type: 'share', token: share.token, includeSuggestions: share.includeSuggestions, viewers: share.viewers.size }
  }
}

export function forViewers(message: ServerMessage, includeSuggestions: boolean): ServerMessage | null {
  switch (message.type) {
    case 'transcript':
    case 'translation':
    case 'speakers':
    case 'summary.start':
    case 'summary.delta':
    case 'summary.done':
    case 'outcomes.start':
      return message
    case 'outcomes':
      return message.outcomes ? { ...message, outcomes: { ...message.outcomes, followUpEmail: { subject: '', body: '' } } } : message
    case 'suggestion.start':
    case 'suggestion.delta':
    case 'suggestion.done':
      return includeSuggestions ? message : null
    default:
      return null
  }
}

function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message))
}
