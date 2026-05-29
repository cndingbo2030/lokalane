import { BellOff, CircleStop, Navigation } from 'lucide-react'
import { routeInsights } from '../data/layers'
import type { Place } from '../domain/types'

interface NavigationBannerProps {
  activeRouteId: string
  destination?: Place
  isNavigating: boolean
  onStop: () => void
}

export function NavigationBanner({
  activeRouteId,
  destination,
  isNavigating,
  onStop,
}: NavigationBannerProps) {
  if (!isNavigating || !destination) {
    return null
  }

  const route = routeInsights.find((item) => item.id === activeRouteId) ?? routeInsights[0]

  return (
    <section className="navigation-banner" aria-label="Active navigation">
      <span className="nav-direction-icon">
        <Navigation size={20} />
      </span>
      <div>
        <p>Continue toward {destination.name}</p>
        <strong>{route.durationMinutes} min · {route.distanceKm.toFixed(1)} km</strong>
      </div>
      <button type="button" title="Mute guidance">
        <BellOff size={18} />
      </button>
      <button type="button" title="Stop navigation" onClick={onStop}>
        <CircleStop size={18} />
      </button>
    </section>
  )
}
