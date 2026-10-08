import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { clientAddress, RateLimiter } from './rateLimit.ts'

describe('RateLimiter', () => {
  it('allows a burst, then refills at the sustained rate', () => {
    let now = 0
    const limiter = new RateLimiter({ capacity: 3, perMinute: 6, now: () => now })
    expect([limiter.take('a'), limiter.take('a'), limiter.take('a'), limiter.take('a')]).toEqual([true, true, true, false])
    expect(limiter.retryAfterSeconds('a')).toBe(10)
    expect(limiter.take('b')).toBe(true) // other clients are unaffected
    now += 10_000
    expect(limiter.take('a')).toBe(true)
    expect(limiter.take('a')).toBe(false)
  })

  it('forgets the least recently seen clients beyond the cap', () => {
    const limiter = new RateLimiter({ capacity: 1, perMinute: 1, maxClients: 2, now: () => 0 })
    limiter.take('a')
    limiter.take('b')
    limiter.take('c') // evicts a
    expect(limiter.take('a')).toBe(true)
    expect(limiter.take('c')).toBe(false)
  })
})

describe('clientAddress', () => {
  const req = (forwarded: string | undefined, remote = '10.0.0.5') =>
    ({ headers: forwarded === undefined ? {} : { 'x-forwarded-for': forwarded }, socket: { remoteAddress: remote } }) as unknown as IncomingMessage

  it('uses the socket address unless the proxy is trusted', () => {
    expect(clientAddress(req('1.2.3.4'), false)).toBe('10.0.0.5')
    expect(clientAddress(req(undefined), true)).toBe('10.0.0.5')
  })

  it('takes the entry our proxy appended, not one the client forged', () => {
    expect(clientAddress(req('6.6.6.6, 203.0.113.9'), true)).toBe('203.0.113.9')
  })
})
