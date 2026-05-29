interface Env {
  ONEMAP_EMAIL?: string
  ONEMAP_PASSWORD?: string
  ONEMAP_ACCESS_TOKEN?: string
  ONEMAP_TOKEN_EXPIRES_AT?: string
  LTA_ACCOUNT_KEY?: string
}

interface OneMapTokenResponse {
  access_token: string
  expiry_timestamp: string
}

interface OneMapRawSearchResult {
  SEARCHVAL: string
  BLK_NO: string
  ROAD_NAME: string
  BUILDING: string
  ADDRESS: string
  POSTAL: string
  X: string
  Y: string
  LATITUDE: string
  LONGITUDE: string
  LONGTITUDE?: string
}

interface OneMapRawSearchResponse {
  found: number
  results: OneMapRawSearchResult[]
}

interface LtaCarPark {
  CarParkID: string
  Area: string
  Development: string
  Location: string
  AvailableLots: number
  LotType: string
  Agency: string
}

interface LtaCarParkResponse {
  value: LtaCarPark[]
}

interface LtaBusArrivalResponse {
  BusStopCode: string
  Services: unknown[]
}

interface LtaTrainAlertsResponse {
  value?: unknown[]
}

interface LtaStationCrowdResponse {
  value?: unknown[]
}

let cachedToken: string | null = null
let cachedTokenExpiresAt = 0

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }))
    }

    const url = new URL(request.url)

    try {
      if (url.pathname === '/health') {
        return json({
          ok: true,
          providers: {
            onemap: hasOneMapAuth(env),
            onemapMode: env.ONEMAP_ACCESS_TOKEN ? 'access-token' : 'credential-login',
            onemapTokenExpiresAt: tokenExpiryIso(env.ONEMAP_TOKEN_EXPIRES_AT),
            lta: Boolean(env.LTA_ACCOUNT_KEY),
          },
        })
      }

      if (url.pathname === '/onemap/search') {
        return handleOneMapSearch(url, env)
      }

      if (url.pathname === '/lta/carparks') {
        return handleLtaCarParks(env)
      }

      if (url.pathname === '/lta/bus-arrivals') {
        return handleLtaBusArrivals(url, env)
      }

      if (url.pathname === '/lta/train-alerts') {
        return handleLtaTrainAlerts(env)
      }

      if (url.pathname === '/lta/station-crowd') {
        return handleLtaStationCrowd(url, env)
      }

      return json({ error: 'Not found' }, 404)
    } catch {
      return json({ error: 'Provider request failed' }, 502)
    }
  },
}

async function handleOneMapSearch(url: URL, env: Env) {
  const query = url.searchParams.get('q')?.trim()
  if (!query || query.length < 2) {
    return json({ found: 0, results: [] })
  }

  const token = await getOneMapToken(env)
  const searchUrl = new URL('https://www.onemap.gov.sg/api/common/elastic/search')
  searchUrl.searchParams.set('searchVal', query)
  searchUrl.searchParams.set('returnGeom', 'Y')
  searchUrl.searchParams.set('getAddrDetails', 'Y')
  searchUrl.searchParams.set('pageNum', '1')

  const response = await fetch(searchUrl, {
    headers: {
      Authorization: token,
    },
  })

  if (!response.ok) {
    return json({ error: 'OneMap search failed' }, response.status)
  }

  const payload = (await response.json()) as OneMapRawSearchResponse
  return json({
    found: payload.found,
    results: payload.results.slice(0, 8).map((result) => ({
      id: `${result.POSTAL || result.SEARCHVAL}-${result.X}-${result.Y}`,
      name: result.BUILDING && result.BUILDING !== 'NIL' ? result.BUILDING : result.SEARCHVAL,
      address: result.ADDRESS,
      category: inferOneMapCategory(result),
      coordinates: {
        lat: Number(result.LATITUDE),
        lng: Number(result.LONGITUDE || result.LONGTITUDE),
      },
      confidence: scoreOneMapResult(result, query),
      tags: [
        result.POSTAL ? `postal-${result.POSTAL}` : '',
        normalizeTag(result.ROAD_NAME),
        inferOneMapCategory(result),
      ].filter(Boolean),
    })),
  })
}

function scoreOneMapResult(result: OneMapRawSearchResult, query: string) {
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

function inferOneMapCategory(result: OneMapRawSearchResult) {
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

  if (/hawker|food|restaurant|cafe|coffee|market|satay/.test(value)) {
    return 'food'
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

async function handleLtaCarParks(env: Env) {
  const payload = await ltaFetch<LtaCarParkResponse>(
    'https://datamall2.mytransport.sg/ltaodataservice/CarParkAvailabilityv2',
    env,
  )

  return json({
    updatedAt: new Date().toISOString(),
    results: payload.value.slice(0, 250).map((item) => ({
      id: item.CarParkID,
      area: item.Area,
      name: item.Development,
      location: item.Location,
      availableLots: Number(item.AvailableLots),
      lotType: item.LotType,
      agency: item.Agency,
    })),
  })
}

async function handleLtaBusArrivals(url: URL, env: Env) {
  const busStopCode = url.searchParams.get('busStopCode')?.trim()
  if (!busStopCode) {
    return json({ error: 'busStopCode is required' }, 400)
  }

  const requestUrl = new URL('https://datamall2.mytransport.sg/ltaodataservice/BusArrivalv2')
  requestUrl.searchParams.set('BusStopCode', busStopCode)

  const payload = await ltaFetch<LtaBusArrivalResponse>(requestUrl.toString(), env)

  return json({
    busStopCode: payload.BusStopCode,
    updatedAt: new Date().toISOString(),
    services: payload.Services,
  })
}

async function handleLtaTrainAlerts(env: Env) {
  const payload = await ltaFetch<LtaTrainAlertsResponse>(
    'https://datamall2.mytransport.sg/ltaodataservice/TrainServiceAlerts',
    env,
  )

  return json({
    updatedAt: new Date().toISOString(),
    alerts: payload.value ?? [],
  })
}

async function handleLtaStationCrowd(url: URL, env: Env) {
  const trainLine = url.searchParams.get('trainLine')?.trim() || 'NSL'
  const requestUrl = new URL('https://datamall2.mytransport.sg/ltaodataservice/PCDRealTime')
  requestUrl.searchParams.set('TrainLine', trainLine)

  const payload = await ltaFetch<LtaStationCrowdResponse>(requestUrl.toString(), env)

  return json({
    trainLine,
    updatedAt: new Date().toISOString(),
    stations: payload.value ?? [],
  })
}

async function ltaFetch<T>(url: string, env: Env) {
  if (!env.LTA_ACCOUNT_KEY) {
    throw new Error('LTA_ACCOUNT_KEY is not configured')
  }

  const response = await fetch(url, {
    headers: {
      AccountKey: env.LTA_ACCOUNT_KEY,
      accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`LTA request failed with ${response.status}`)
  }

  return (await response.json()) as T
}

async function getOneMapToken(env: Env) {
  const now = Date.now()

  if (env.ONEMAP_ACCESS_TOKEN) {
    const staticTokenExpiresAt = tokenExpiryMs(env.ONEMAP_TOKEN_EXPIRES_AT)
    if (!staticTokenExpiresAt || staticTokenExpiresAt - now > 300_000) {
      return env.ONEMAP_ACCESS_TOKEN
    }

    if (!env.ONEMAP_EMAIL || !env.ONEMAP_PASSWORD) {
      throw new Error('Configured OneMap access token has expired')
    }
  }

  if (cachedToken && cachedTokenExpiresAt - now > 300_000) {
    return cachedToken
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
    throw new Error('Unable to authenticate with OneMap')
  }

  const payload = (await response.json()) as OneMapTokenResponse
  cachedToken = payload.access_token
  cachedTokenExpiresAt = Number(payload.expiry_timestamp) * 1000
  return cachedToken
}

function hasOneMapAuth(env: Env) {
  if (env.ONEMAP_ACCESS_TOKEN) {
    const expiresAt = tokenExpiryMs(env.ONEMAP_TOKEN_EXPIRES_AT)
    return !expiresAt || expiresAt - Date.now() > 300_000
  }

  return Boolean(env.ONEMAP_EMAIL && env.ONEMAP_PASSWORD)
}

function tokenExpiryMs(value?: string) {
  if (!value) {
    return 0
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0
  }

  return parsed > 10_000_000_000 ? parsed : parsed * 1000
}

function tokenExpiryIso(value?: string) {
  const expiresAt = tokenExpiryMs(value)
  return expiresAt ? new Date(expiresAt).toISOString() : null
}

function json(payload: unknown, status = 200) {
  return withCors(new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
    },
  }))
}

function withCors(response: Response) {
  const headers = new Headers(response.headers)
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
