import { lookup as dnsLookup } from 'node:dns/promises'
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP, type LookupFunction } from 'node:net'
import { ClientError } from '../errors.ts'

/**
 * Outbound HTTP for URLs that users supply (calendar feeds, webhooks).
 *
 * A server that fetches arbitrary URLs is an SSRF vector: without care, a
 * "calendar URL" of http://169.254.169.254/ reads cloud credentials, and a
 * webhook can poke internal services. This helper:
 *   - allows https only (http only when private networks are allowed, i.e. desktop);
 *   - resolves DNS itself and rejects private, loopback, link-local, CGNAT,
 *     multicast and documentation ranges (IPv4, IPv6 and IPv4-mapped IPv6);
 *   - connects to the exact address it validated (no DNS-rebinding window);
 *   - re-validates every redirect hop, caps redirects, response size and time.
 */

export class UnsafeUrlError extends ClientError {}

export interface SafeFetchOptions {
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string | Uint8Array
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
  /** Desktop app: the user's own machine, so LAN calendars / self-hosted webhooks are fine. */
  allowPrivateNetwork?: boolean
  /** Injected in tests. */
  resolve?: (hostname: string) => Promise<Array<{ address: string; family: number }>>
}

export interface SafeResponse {
  status: number
  headers: IncomingHttpHeaders
  body: Buffer
  /** Final URL after redirects. */
  url: string
}

const blocked = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv4')
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 32],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv6')
}

/** IPv4 embedded in IPv4-mapped (::ffff:a.b.c.d / ::ffff:7f00:1) or NAT64 (64:ff9b::/96) addresses. */
function embeddedIpv4(ipv6: string): string | null {
  const lower = ipv6.toLowerCase()
  const prefix = ['::ffff:', '64:ff9b::'].find((p) => lower.startsWith(p))
  if (!prefix) return null
  const rest = lower.slice(prefix.length)
  if (isIP(rest) === 4) return rest
  const hex = rest.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (!hex) return null
  const high = parseInt(hex[1], 16)
  const low = parseInt(hex[2], 16)
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.')
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return !blocked.check(address, 'ipv4')
  if (family === 6) {
    const v4 = embeddedIpv4(address)
    if (v4) return !blocked.check(v4, 'ipv4')
    return !blocked.check(address, 'ipv6')
  }
  return false
}

/** Accepts webcal:// (calendar subscription links) as https://. */
export function normalizeUrl(input: string): URL {
  let url: URL
  try {
    url = new URL(input.trim().replace(/^webcals?:\/\//i, 'https://'))
  } catch {
    throw new UnsafeUrlError('链接格式不正确')
  }
  return url
}

async function pickAddress(url: URL, options: SafeFetchOptions): Promise<{ address: string; family: number }> {
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && options.allowPrivateNetwork)) {
    throw new UnsafeUrlError('只支持 https 链接')
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const literal = isIP(hostname)
  const addresses = literal ? [{ address: hostname, family: literal }] : await (options.resolve ?? defaultResolve)(hostname)
  if (addresses.length === 0) throw new UnsafeUrlError(`无法解析域名 ${hostname}`)
  if (!options.allowPrivateNetwork) {
    // Every address must be public: a host that also resolves to 10.x is not acceptable.
    const bad = addresses.find((a) => !isPublicAddress(a.address))
    if (bad) throw new UnsafeUrlError('不允许访问内网或保留地址')
  }
  return addresses[0]
}

async function defaultResolve(hostname: string) {
  return dnsLookup(hostname, { all: true, verbatim: true })
}

export async function safeFetch(input: string, options: SafeFetchOptions = {}): Promise<SafeResponse> {
  const maxRedirects = options.maxRedirects ?? 3
  let url = normalizeUrl(input)
  let method = options.method ?? 'GET'
  let body = options.body
  for (let hop = 0; ; hop++) {
    const response = await requestOnce(url, method, body, options)
    const location = response.headers.location
    if (response.status >= 300 && response.status < 400 && location) {
      if (hop >= maxRedirects) throw new UnsafeUrlError('重定向次数过多')
      url = new URL(location, url)
      // 303 (and legacy 301/302 for POST) turn into GET, as browsers do.
      if (response.status === 303 || method === 'POST') {
        method = 'GET'
        body = undefined
      }
      continue
    }
    return response
  }
}

async function requestOnce(url: URL, method: string, body: string | Uint8Array | undefined, options: SafeFetchOptions): Promise<SafeResponse> {
  const target = await pickAddress(url, options)
  const timeoutMs = options.timeoutMs ?? 10_000
  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024
  // Pin the connection to the validated address; TLS still verifies the hostname (SNI).
  const pinnedLookup: LookupFunction = (_hostname, lookupOptions, callback) => {
    if (lookupOptions.all) callback(null, [{ address: target.address, family: target.family }])
    else callback(null, target.address, target.family)
  }
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest
  const payload = typeof body === 'string' ? Buffer.from(body) : body ? Buffer.from(body) : undefined

  return new Promise<SafeResponse>((resolve, reject) => {
    // Settle exactly once: an aborted response would otherwise still emit 'end' and
    // resolve with a silently truncated body.
    let settled = false
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      reject(error)
      req.destroy()
    }
    const req = send(
      url,
      {
        method,
        lookup: pinnedLookup,
        headers: {
          'user-agent': 'MeetingCopilot/1.0',
          ...(payload ? { 'content-length': String(payload.byteLength) } : {}),
          ...options.headers,
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (chunk: Buffer) => {
          if (settled) return
          size += chunk.length
          if (size > maxBytes) return fail(new UnsafeUrlError('响应内容过大'))
          chunks.push(chunk)
        })
        res.on('end', () => {
          if (settled) return
          settled = true
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks), url: url.toString() })
        })
        res.on('error', (error) => fail(error))
      },
    )
    req.on('timeout', () => fail(new UnsafeUrlError('请求超时')))
    req.on('error', (error) => fail(error))
    if (payload) req.write(payload)
    req.end()
  })
}
