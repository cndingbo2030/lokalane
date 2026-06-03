import { describe, expect, it } from 'vitest'
import { searchPlaces } from './search'

describe('searchPlaces', () => {
  it('returns high-confidence seed places when the query is empty', () => {
    const results = searchPlaces('', { limit: 3 })

    expect(results).toHaveLength(3)
    expect(results[0].confidence).toBeGreaterThanOrEqual(results[1].confidence)
  })

  it('matches cross-border checkpoint terms', () => {
    const results = searchPlaces('causeway jb')

    expect(results.map((place) => place.id)).toContain('woodlands-checkpoint')
  })

  it('matches common mobile test queries without a live provider', () => {
    expect(searchPlaces('Suntec').map((place) => place.id)).toContain('suntec-city')
    expect(searchPlaces('310c').map((place) => place.id)).toContain('310c-jalan-murai')
  })

  it('can restrict results by country', () => {
    const results = searchPlaces('mall', { country: 'MY' })

    expect(results.length).toBeGreaterThan(0)
    expect(results.every((place) => place.country === 'MY')).toBe(true)
  })
})
