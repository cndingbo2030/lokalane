import { useEffect, useState } from 'react'
import {
  fetchProviderHealth,
  getInitialProviderHealth,
  type ProviderHealth,
} from '../services/providerHealth'

export function useProviderHealth() {
  const [health, setHealth] = useState<ProviderHealth>(() => getInitialProviderHealth())

  useEffect(() => {
    let isMounted = true

    async function refresh() {
      const nextHealth = await fetchProviderHealth()
      if (isMounted) {
        setHealth(nextHealth)
      }
    }

    refresh()
    const intervalId = window.setInterval(refresh, 60_000)

    return () => {
      isMounted = false
      window.clearInterval(intervalId)
    }
  }, [])

  return health
}
