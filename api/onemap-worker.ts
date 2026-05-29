interface Env {
  ONEMAP_EMAIL: string
  ONEMAP_PASSWORD: string
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

let cachedToken: string | null = null
let cachedTokenExpiresAt = 0

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname !== '/onemap/search') {
      return json({ error: 'Not found' }, 404)
    }

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
        Authorization: `Bearer ${token}`,
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
        coordinates: {
          lat: Number(result.LATITUDE),
          lng: Number(result.LONGITUDE || result.LONGTITUDE),
        },
        confidence: 0.96,
      })),
    })
  },
}

async function getOneMapToken(env: Env) {
  const now = Date.now()
  if (cachedToken && cachedTokenExpiresAt - now > 300_000) {
    return cachedToken
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

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
    },
  })
}
