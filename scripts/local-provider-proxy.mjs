import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'

const port = Number(process.env.PORT || 8787)
const env = {
  ...process.env,
  ...loadDevVars(),
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)

  if (request.method === 'OPTIONS') {
    return send(response, null, 204)
  }

  try {
    if (url.pathname === '/health') {
      return send(response, {
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
      return send(response, await oneMapSearch(url.searchParams.get('q') ?? ''))
    }

    return send(response, { error: 'Not found' }, 404)
  } catch (error) {
    return send(response, {
      error: 'Provider request failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, 502)
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`LokaLane local provider proxy listening on http://127.0.0.1:${port}`)
})

async function oneMapSearch(query) {
  const searchVal = query.trim()
  if (searchVal.length < 2) {
    return { found: 0, results: [] }
  }

  const token = await getOneMapToken()
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

  const payload = await providerResponse.json()
  return {
    found: payload.found,
    results: payload.results.slice(0, 12).map((result) => ({
      id: `${result.POSTAL || result.SEARCHVAL}-${result.X}-${result.Y}`,
      name: result.BUILDING && result.BUILDING !== 'NIL' ? result.BUILDING : result.SEARCHVAL,
      address: result.ADDRESS,
      category: inferCategory(result),
      coordinates: {
        lat: Number(result.LATITUDE),
        lng: Number(result.LONGITUDE || result.LONGTITUDE),
      },
      confidence: scoreResult(result, searchVal),
      tags: [
        result.POSTAL ? `postal-${result.POSTAL}` : '',
        normalizeTag(result.ROAD_NAME ?? ''),
        inferCategory(result),
      ].filter(Boolean),
    })),
  }
}

async function getOneMapToken() {
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

  const payload = await response.json()
  return payload.access_token
}

function loadDevVars() {
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

function scoreResult(result, query) {
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

function inferCategory(result) {
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

function normalizeTag(value) {
  return value.trim().toLowerCase().replace(/\s+/g, '-')
}

function tokenExpiryIso(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }

  return new Date((parsed > 10_000_000_000 ? parsed : parsed * 1000)).toISOString()
}

function send(response, payload, status = 200) {
  response.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json; charset=utf-8',
  })

  response.end(payload ? JSON.stringify(payload) : '')
}
