import { useEffect, useMemo, useState } from 'react'
import type { CountryCode, Place, ProviderSignal } from '../domain/types'
import { hybridSearch } from '../services/hybridSearch'
import { searchPlaces } from '../services/search'

interface UseHybridSearchOptions {
  country: CountryCode | 'ALL'
  limit?: number
}

interface UseHybridSearchState {
  places: Place[]
  signals: ProviderSignal[]
  isLoading: boolean
  key: string
}

const debounceMs = 240

export function useHybridSearch(query: string, options: UseHybridSearchOptions) {
  const limit = options.limit ?? 8
  const key = `${query}|${options.country}|${limit}`
  const immediatePlaces = useMemo(
    () => searchPlaces(query, { country: options.country, limit }),
    [options.country, limit, query],
  )
  const immediateSignals = useMemo<ProviderSignal[]>(
    () => [
      {
        id: 'lokalane-curated',
        status: 'success',
        label: 'Curated seed',
        message: `${immediatePlaces.length} instant local results`,
      },
    ],
    [immediatePlaces.length],
  )

  const [state, setState] = useState<UseHybridSearchState>({
    places: immediatePlaces,
    signals: immediateSignals,
    isLoading: false,
    key,
  })

  useEffect(() => {
    let cancelled = false

    const timeout = window.setTimeout(() => {
      setState({
        places: immediatePlaces,
        signals: immediateSignals,
        isLoading: true,
        key,
      })

      hybridSearch(query, {
        country: options.country,
        limit,
      })
        .then((result) => {
          if (!cancelled) {
            setState({
              places: result.places,
              signals: result.signals,
              isLoading: false,
              key,
            })
          }
        })
        .catch(() => {
          if (!cancelled) {
            setState({
              places: immediatePlaces,
              signals: [
                ...immediateSignals,
                {
                  id: 'onemap',
                  status: 'error',
                  label: 'OneMap live',
                  message: 'Search pipeline failed; local results preserved',
                },
              ],
              isLoading: false,
              key,
            })
          }
        })
    }, debounceMs)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [immediatePlaces, immediateSignals, key, limit, options.country, query])

  if (state.key !== key) {
    return {
      places: immediatePlaces,
      signals: immediateSignals,
      isLoading: true,
    }
  }

  return state
}
