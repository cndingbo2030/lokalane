import { AlertTriangle, BusFront, Clock3, Footprints, TrainFront } from 'lucide-react'
import {
  transitArrivals,
  transitJourneys,
  transitLines,
  transitStops,
} from '../data/publicTransport'
import type { TransitLine, UserMode } from '../domain/types'

interface PublicTransportPanelProps {
  userMode: UserMode
  onStartNavigation: () => void
}

export function PublicTransportPanel({
  userMode,
  onStartNavigation,
}: PublicTransportPanelProps) {
  const recommendedJourneys = transitJourneys.filter((journey) =>
    journey.bestFor.includes(userMode),
  )
  const linesToShow = getLinesForMode(userMode)

  return (
    <section className="transit-panel" aria-label="Public transport">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Public transport</p>
          <h2>Bus, MRT and cross-border options</h2>
        </div>
        <span className="live-chip">LTA-ready</span>
      </div>

      <div className="transit-line-strip" aria-label="Transit line status">
        {linesToShow.map((line) => (
          <article key={line.id} className={`transit-line ${line.status}`}>
            <span style={{ backgroundColor: line.color }}>
              {line.mode === 'bus' || line.mode === 'cross-border' ? (
                <BusFront size={16} />
              ) : (
                <TrainFront size={16} />
              )}
            </span>
            <div>
              <strong>{line.label}</strong>
              <small>{line.area} · {formatCrowd(line.crowdLevel)}</small>
            </div>
          </article>
        ))}
      </div>

      <div className="arrival-board" aria-label="Next arrivals">
        {transitArrivals.slice(0, 3).map((arrival) => {
          const stop = transitStops.find((item) => item.id === arrival.stopId)
          return (
            <article key={arrival.id}>
              <span className="arrival-service">{arrival.service}</span>
              <div>
                <strong>{arrival.destination}</strong>
                <small>{stop?.name ?? arrival.stopId} · {formatCrowd(arrival.load)}</small>
              </div>
              <span className="eta">
                <Clock3 size={15} />
                {arrival.minutes}m
              </span>
            </article>
          )
        })}
      </div>

      <div className="journey-list" aria-label="Recommended transit journeys">
        {recommendedJourneys.map((journey) => (
          <article key={journey.id} className="journey-card">
            <div>
              <strong>{journey.title}</strong>
              <span>{journey.subtitle}</span>
            </div>
            <div className="journey-meta">
              <span>
                <Clock3 size={14} />
                {journey.durationMinutes}m
              </span>
              <span>
                <Footprints size={14} />
                {journey.walkMinutes}m walk
              </span>
            </div>
            <ol>
              {journey.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </article>
        ))}
      </div>

      <div className="transit-alert">
        <AlertTriangle size={16} />
        <span>Train service alerts and station crowding will activate through LTA DataMall once the worker key is configured.</span>
      </div>

      <button type="button" className="wide-primary" onClick={onStartNavigation}>
        <BusFront size={17} />
        Use public transport route
      </button>
    </section>
  )
}

function getLinesForMode(userMode: UserMode): TransitLine[] {
  if (userMode === 'visitor') {
    return transitLines.filter((line) =>
      ['sg-ewl', 'sg-dtl', 'my-ktmb-shuttle'].includes(line.id),
    )
  }

  if (userMode === 'local') {
    return transitLines.filter((line) => ['sg-nsl', 'sg-ewl', 'sg-dtl'].includes(line.id))
  }

  if (userMode === 'driver') {
    return transitLines.filter((line) => line.mode === 'cross-border')
  }

  return transitLines
}

function formatCrowd(level: TransitLine['crowdLevel']) {
  const labels: Record<TransitLine['crowdLevel'], string> = {
    low: 'low crowd',
    moderate: 'moderate crowd',
    high: 'high crowd',
    unknown: 'crowd unknown',
  }

  return labels[level]
}
