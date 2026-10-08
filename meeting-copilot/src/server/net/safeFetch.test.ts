import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { isPublicAddress, normalizeUrl, safeFetch, UnsafeUrlError } from './safeFetch.ts'

describe('isPublicAddress', () => {
  it.each(['8.8.8.8', '1.1.1.1', '203.0.114.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])('allows public %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(true)
  })

  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata
    '100.64.0.1', // CGNAT
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '198.18.0.1',
    '::1',
    '::',
    'fe80::1',
    'fd00::1',
    '::ffff:127.0.0.1', // IPv4-mapped loopback
    '::ffff:7f00:1', // same, hex form
    '::ffff:a9fe:a9fe', // mapped metadata address
    '64:ff9b::a00:1', // NAT64 of 10.0.0.1
    'not-an-ip',
  ])('blocks %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(false)
  })
})

describe('normalizeUrl', () => {
  it('turns webcal links into https', () => {
    expect(normalizeUrl('webcal://calendar.example.com/a.ics').toString()).toBe('https://calendar.example.com/a.ics')
    expect(() => normalizeUrl('not a url')).toThrow(UnsafeUrlError)
  })
})

describe('safeFetch', () => {
  let server: Server | null = null
  afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())))

  async function startServer(handler: Parameters<typeof createServer>[1]) {
    server = createServer(handler)
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r))
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  }

  it('refuses http and private hosts unless private networks are allowed', async () => {
    await expect(safeFetch('http://example.com/feed.ics')).rejects.toThrow('https')
    await expect(safeFetch('https://127.0.0.1/x')).rejects.toThrow('内网')
    await expect(safeFetch('https://[::1]/x')).rejects.toThrow('内网')
    // A hostname that resolves to a private address (e.g. DNS pointing at the metadata service).
    const resolve = async () => [{ address: '169.254.169.254', family: 4 }]
    await expect(safeFetch('https://evil.example/latest/meta-data', { resolve })).rejects.toThrow('内网')
    // Mixed answers are rejected too.
    const mixed = async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ]
    await expect(safeFetch('https://mixed.example/', { resolve: mixed })).rejects.toThrow('内网')
  })

  it('fetches with method, headers and body, and enforces the size limit (desktop/LAN mode)', async () => {
    const base = await startServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        if (req.url === '/big') return res.end('x'.repeat(2_000))
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ method: req.method, type: req.headers['content-type'], body }))
      })
    })
    const response = await safeFetch(`${base}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"a":1}',
      allowPrivateNetwork: true,
    })
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body.toString())).toEqual({ method: 'POST', type: 'application/json', body: '{"a":1}' })
    await expect(safeFetch(`${base}/big`, { allowPrivateNetwork: true, maxBytes: 1_000 })).rejects.toThrow('过大')
  })

  it('follows a limited number of redirects and re-validates each hop', async () => {
    const base = await startServer((req, res) => {
      if (req.url === '/loop') {
        res.writeHead(302, { location: '/loop' })
        return res.end()
      }
      if (req.url === '/to-final') {
        res.writeHead(301, { location: '/final' })
        return res.end()
      }
      res.end('ok')
    })
    const ok = await safeFetch(`${base}/to-final`, { allowPrivateNetwork: true })
    expect(ok.body.toString()).toBe('ok')
    expect(ok.url).toBe(`${base}/final`)
    await expect(safeFetch(`${base}/loop`, { allowPrivateNetwork: true })).rejects.toThrow('重定向')
  })
})
