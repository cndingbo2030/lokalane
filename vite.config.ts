import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), localProviderProxy()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
  },
})

interface DevVars {
  ONEMAP_EMAIL?: string
  ONEMAP_PASSWORD?: string
  ONEMAP_ACCESS_TOKEN?: string
  ONEMAP_TOKEN_EXPIRES_AT?: string
  LTA_ACCOUNT_KEY?: string
}

interface OneMapRawSearchResult {
  SEARCHVAL: string
  BUILDING: string
  ADDRESS: string
  POSTAL: string
  X: string
  Y: string
  LATITUDE: string
  LONGITUDE: string
  LONGTITUDE?: string
  ROAD_NAME: string
}

interface OneMapRawSearchResponse {
  found: number
  results: OneMapRawSearchResult[]
}

function localProviderProxy(): Plugin {
  return {
    name: 'lokalane-local-provider-proxy',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1:5173')

        if (request.method === 'OPTIONS') {
          return sendJson(response, null, 204)
        }

        if (url.pathname === '/health') {
          const env = loadDevVars()
          return sendJson(response, {
            ok: true,
            providers: {
              onemap: Boolean(env.ONEMAP_ACCESS_TOKEN || (env.ONEMAP_EMAIL && env.ONEMAP_PASSWORD)),
              onemapMode: env.ONEMAP_ACCESS_TOKEN ? 'access-token' : 'credential-login',
              onemapTokenExpiresAt: tokenExpiryIso(env.ONEMAP_TOKEN_EXPIRES_AT),
              lta: Boolean(env.LTA_ACCOUNT_KEY),
            },
          })
        }

        if (url.pathname === '/onemap/search') {
          try {
            return sendJson(response, await oneMapSearch(url.searchParams.get('q') ?? ''))
          } catch (error) {
            return sendJson(response, {
              error: 'Provider request failed',
              message: error instanceof Error ? error.message : 'Unknown error',
            }, 502)
          }
        }

        return next()
      })
    },
  }
}

async function oneMapSearch(query: string) {
  const searchVal = query.trim()
  if (searchVal.length < 2) {
    return { found: 0, results: [] }
  }

  const token = await getOneMapToken(loadDevVars())
  const searchUrl = new URL('https://www.onemap.gov.sg/api/common/elastic/search')
  searchUrl.searchParams.set('searchVal', searchVal)
  searchUrl.searchParams.set('returnGeom', 'Y')
  searchUrl.searchParams.set('getAddrDetails', 'Y')
  searchUrl.searchParams.set('pageNum', '1')

  const providerResponse = await fetch(searchUrl, {
    headers: {
      Authorization: token,
    },
  })

  if (!providerResponse.ok) {
    throw new Error(`OneMap search failed with ${providerResponse.status}`)
  }

  const payload = (await providerResponse.json()) as OneMapRawSearchResponse
  return {
    found: payload.found,
    results: payload.results.slice(0, 12).map((result) => {
      const category = inferCategory(result)
      return {
        id: `${result.POSTAL || result.SEARCHVAL}-${result.X}-${result.Y}`,
        name: result.BUILDING && result.BUILDING !== 'NIL' ? result.BUILDING : result.SEARCHVAL,
        address: result.ADDRESS,
        category,
        coordinates: {
          lat: Number(result.LATITUDE),
          lng: Number(result.LONGITUDE || result.LONGTITUDE),
        },
        confidence: scoreResult(result, searchVal),
        tags: [
          result.POSTAL ? `postal-${result.POSTAL}` : '',
          normalizeTag(result.ROAD_NAME),
          category,
        ].filter(Boolean),
      }
    }),
  }
}

async function getOneMapToken(env: DevVars) {
  if (env.ONEMAP_ACCESS_TOKEN) {
    return env.ONEMAP_ACCESS_TOKEN
  }

  if (!env.ONEMAP_EMAIL || !env.ONEMAP_PASSWORD) {
    throw new Error('OneMap credentials are not configured')
  }

  const response = await fetch('https://www.onemap.gov.sg/api/auth/post/getToken', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: env.ONEMAP_EMAIL,
      password: env.ONEMAP_PASSWORD,
    }),
  })

  if (!response.ok) {
    throw new Error(`OneMap auth failed with ${response.status}`)
  }

  const payload = (await response.json()) as { access_token: string }
  return payload.access_token
}

function loadDevVars(): DevVars {
  try {
    return Object.fromEntries(
      readFileSync('.dev.vars', 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#') && line.includes('='))
        .map((line) => {
          const separatorIndex = line.indexOf('=')
          return [
            line.slice(0, separatorIndex),
            line.slice(separatorIndex + 1).replace(/^"|"$/g, ''),
          ]
        }),
    )
  } catch {
    return {}
  }
}

function scoreResult(result: OneMapRawSearchResult, query: string) {
  const normalizedQuery = query.replace(/\s+/g, '').toLowerCase()
  const normalizedAddress = result.ADDRESS.replace(/\s+/g, '').toLowerCase()
  const normalizedSearchValue = result.SEARCHVAL.replace(/\s+/g, '').toLowerCase()

  if (result.POSTAL === normalizedQuery || normalizedSearchValue === normalizedQuery) {
    return 0.99
  }

  if (normalizedAddress.includes(normalizedQuery) || normalizedSearchValue.includes(normalizedQuery)) {
    return 0.97
  }

  return 0.94
}

function inferCategory(result: OneMapRawSearchResult) {
  const value = `${result.SEARCHVAL} ${result.BUILDING} ${result.ADDRESS}`.toLowerCase()

  if (/\bblk\b|hdb|punggol|ang mo kio|tampines|yishun|woodlands|sengkang|jurong|bedok/.test(value)) {
    return 'hdb'
  }

  if (/\bcondo\b|condominium|residences|residence|suite|suites|apartment|apartments/.test(value)) {
    return 'condo'
  }

  if (/mrt|lrt|bus interchange|terminal|station/.test(value)) {
    return 'transport'
  }

  if (/mall|square|plaza|shopping|centre|center/.test(value)) {
    return 'mall'
  }

  if (/hospital|clinic|medical/.test(value)) {
    return 'medical'
  }

  if (/car park|carpark|parking/.test(value)) {
    return 'parking'
  }

  return 'building'
}

function normalizeTag(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '-')
}

function tokenExpiryIso(value?: string) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }

  return new Date((parsed > 10_000_000_000 ? parsed : parsed * 1000)).toISOString()
}

function sendJson(response: ServerResponse<IncomingMessage>, payload: unknown, status = 200) {
  response.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(payload ? JSON.stringify(payload) : '')
}
