import { describe, expect, it, vi } from 'vitest'
import { fetchProviderHealth, getInitialProviderHealth } from './providerHealth'

describe('provider health', () => {
  it('reports disabled when no gateway is configured', async () => {
    const fetcher = vi.fn()

    expect(getInitialProviderHealth('')).toMatchObject({
      status: 'disabled',
      onemap: false,
      lta: false,
    })
    await expect(fetchProviderHealth(fetcher, '')).resolves.toMatchObject({
      status: 'disabled',
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('normalizes gateway health into product provider status', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        providers: {
          onemap: true,
          onemapMode: 'access-token',
          onemapTokenExpiresAt: '2026-06-01T10:09:14.000Z',
          lta: false,
        },
      }),
    } satisfies Partial<Response>)

    const health = await fetchProviderHealth(fetcher, 'https://edge.example')

    expect(fetcher).toHaveBeenCalledWith(new URL('https://edge.example/health'))
    expect(health).toMatchObject({
      status: 'ready',
      onemap: true,
      onemapMode: 'access-token',
      onemapTokenExpiresAt: '2026-06-01T10:09:14.000Z',
      lta: false,
    })
  })

  it('keeps the app on fallback when the gateway fails', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
    } satisfies Partial<Response>)

    await expect(fetchProviderHealth(fetcher, 'https://edge.example')).resolves.toMatchObject({
      status: 'error',
      message: 'Official gateway unreachable',
      onemap: false,
      lta: false,
    })
  })
})
