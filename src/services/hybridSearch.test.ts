import { describe, expect, it, vi } from 'vitest'
import { hybridSearch, mergePlaces } from './hybridSearch'
import type { Place } from '../domain/types'

describe('mergePlaces', () => {
  it('prefers live provider records and removes postal duplicates', () => {
    const local: Place = {
      id: 'local',
      name: 'Revenue House',
      category: 'landmark',
      country: 'SG',
      area: 'Novena',
      address: '55 Newton Road Singapore 307987',
      coordinates: { lat: 1.32, lng: 103.84 },
      sourceId: 'lokalane-curated',
      confidence: 0.8,
      tags: [],
      signal: 'Seed',
      updatedAt: '2026-05-29',
    }
    const live: Place = {
      ...local,
      id: 'live',
      sourceId: 'onemap',
      confidence: 0.96,
    }

    expect(mergePlaces([local], [live], 4)).toEqual([live])
  })
})

describe('hybridSearch', () => {
  it('returns Malaysia fallback without calling OneMap', async () => {
    const fetcher = vi.fn()

    const result = await hybridSearch('mall', {
      country: 'MY',
      fetcher,
    })

    expect(fetcher).not.toHaveBeenCalled()
    expect(result.places.every((place) => place.country === 'MY')).toBe(true)
    expect(result.signals.some((signal) => signal.id === 'openstreetmap')).toBe(true)
  })
})
