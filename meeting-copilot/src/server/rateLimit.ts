import type { IncomingMessage } from 'node:http'

/**
 * Per-client token buckets for the endpoints that cost money or reach out to
 * other servers (LLM calls, uploads, webhooks, calendar fetches, new meetings).
 * In memory and per process: enough to stop a runaway script or a leaked link
 * from burning API credit; not a substitute for ACCESS_TOKEN.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>()

  constructor(
    private readonly options: {
      /** Burst size. */
      capacity: number
      /** Sustained rate. */
      perMinute: number
      now?: () => number
      /** Oldest clients are forgotten beyond this (bounded memory). */
      maxClients?: number
    },
  ) {}

  /** Takes one token for `key`; false when the client must wait. */
  take(key: string): boolean {
    const now = (this.options.now ?? Date.now)()
    const { capacity, perMinute } = this.options
    const bucket = this.buckets.get(key) ?? { tokens: capacity, at: now }
    bucket.tokens = Math.min(capacity, bucket.tokens + ((now - bucket.at) / 60_000) * perMinute)
    bucket.at = now
    // Re-insert so iteration order is least-recently-used first.
    this.buckets.delete(key)
    this.buckets.set(key, bucket)
    if (this.buckets.size > (this.options.maxClients ?? 10_000)) this.buckets.delete(this.buckets.keys().next().value!)
    if (bucket.tokens < 1) return false
    bucket.tokens -= 1
    return true
  }

  /** Seconds until the next token, for Retry-After. */
  retryAfterSeconds(key: string): number {
    const bucket = this.buckets.get(key)
    if (!bucket || bucket.tokens >= 1) return 0
    return Math.ceil(((1 - bucket.tokens) / this.options.perMinute) * 60)
  }
}

/**
 * The client's address. Behind a reverse proxy (TRUST_PROXY=true) it is the
 * right-most X-Forwarded-For entry: the one our own proxy added, which the
 * client cannot forge.
 */
export function clientAddress(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for']
    const last = (Array.isArray(forwarded) ? forwarded.join(',') : (forwarded ?? '')).split(',').map((s) => s.trim()).filter(Boolean).at(-1)
    if (last) return last
  }
  return req.socket.remoteAddress ?? 'unknown'
}
