export type ProviderHealthStatus = 'disabled' | 'loading' | 'ready' | 'error'

export type OneMapAuthMode = 'access-token' | 'credential-login'

export interface ProviderHealth {
  status: ProviderHealthStatus
  apiBase?: string
  checkedAt?: string
  message?: string
  onemap: boolean
  onemapMode?: OneMapAuthMode
  onemapTokenExpiresAt?: string | null
  lta: boolean
}

interface ProviderHealthResponse {
  ok: boolean
  providers: {
    onemap: boolean
    onemapMode?: OneMapAuthMode
    onemapTokenExpiresAt?: string | null
    lta: boolean
  }
}

export function getProviderApiBase() {
  return import.meta.env.VITE_LOKALANE_API_BASE?.trim() ?? ''
}

export function getInitialProviderHealth(apiBase = getProviderApiBase()): ProviderHealth {
  if (!apiBase) {
    return {
      status: 'disabled',
      message: 'Official gateway not configured',
      onemap: false,
      lta: false,
    }
  }

  return {
    status: 'loading',
    apiBase,
    message: 'Checking official gateway',
    onemap: false,
    lta: false,
  }
}

export async function fetchProviderHealth(
  fetcher: typeof fetch = fetch,
  apiBase = getProviderApiBase(),
): Promise<ProviderHealth> {
  if (!apiBase) {
    return getInitialProviderHealth('')
  }

  try {
    const url = new URL('/health', apiBase)
    const response = await fetcher(url)

    if (!response.ok) {
      throw new Error(`Gateway returned ${response.status}`)
    }

    const payload = (await response.json()) as ProviderHealthResponse

    return {
      status: payload.ok ? 'ready' : 'error',
      apiBase,
      checkedAt: new Date().toISOString(),
      message: payload.ok ? 'Official gateway reachable' : 'Official gateway unhealthy',
      onemap: Boolean(payload.providers.onemap),
      onemapMode: payload.providers.onemapMode,
      onemapTokenExpiresAt: payload.providers.onemapTokenExpiresAt ?? null,
      lta: Boolean(payload.providers.lta),
    }
  } catch {
    return {
      status: 'error',
      apiBase,
      checkedAt: new Date().toISOString(),
      message: 'Official gateway unreachable',
      onemap: false,
      lta: false,
    }
  }
}
