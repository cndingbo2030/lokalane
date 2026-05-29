import { Clock3, Milestone, Navigation2, ShieldCheck, TimerReset } from 'lucide-react'
import { routeInsights } from '../data/layers'

interface CommutePanelProps {
  activeRouteId: string
  onSelectRoute: (routeId: string) => void
  onStartNavigation: () => void
}

export function CommutePanel({
  activeRouteId,
  onSelectRoute,
  onStartNavigation,
}: CommutePanelProps) {
  return (
    <section className="commute-panel" aria-label="Commute dashboard">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Commute intelligence</p>
          <h2>Checkpoint and city routes</h2>
        </div>
        <span className="live-chip">Live-ready</span>
      </div>

      <div className="checkpoint-grid">
        <article>
          <ShieldCheck size={18} />
          <strong>Woodlands</strong>
          <span>42m estimate · high variance</span>
        </article>
        <article>
          <Milestone size={18} />
          <strong>Tuas</strong>
          <span>31m estimate · steadier</span>
        </article>
      </div>

      <div className="route-stack">
        {routeInsights.map((route) => (
          <button
            key={route.id}
            type="button"
            className={activeRouteId === route.id ? 'route-row active' : 'route-row'}
            onClick={() => onSelectRoute(route.id)}
          >
            <span className="route-icon">
              <TimerReset size={18} />
            </span>
            <div>
              <strong>{route.title}</strong>
              <span>{route.subtitle}</span>
              <small>{route.distanceKm.toFixed(1)} km · {Math.round(route.confidence * 100)}% confidence</small>
            </div>
            <span className="eta">
              <Clock3 size={15} />
              {route.durationMinutes}m
            </span>
          </button>
        ))}
      </div>

      <button type="button" className="wide-primary" onClick={onStartNavigation}>
        <Navigation2 size={17} />
        Start selected route
      </button>
    </section>
  )
}
