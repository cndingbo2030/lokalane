import {
  Award,
  CarFront,
  CircleDot,
  Home,
  ShieldCheck,
  Sparkles,
  TrainFront,
  Utensils,
} from 'lucide-react'
import type { Place } from '../domain/types'

interface PlaceBadgesProps {
  place: Place
}

export function PlaceBadges({ place }: PlaceBadgesProps) {
  const badges = getPlaceBadges(place)

  return (
    <div className="place-badge-strip" aria-label="Place badges">
      {badges.map((badge) => {
        const Icon = badge.icon
        return (
          <span key={badge.label} className={`place-badge ${badge.tone}`}>
            <Icon size={14} />
            {badge.label}
          </span>
        )
      })}
    </div>
  )
}

function getPlaceBadges(place: Place) {
  const badges: Array<{
    label: string
    icon: typeof Award
    tone: 'green' | 'blue' | 'gold' | 'soft'
  }> = []

  if (place.sourceId === 'onemap' || place.sourceId === 'lta-datamall') {
    badges.push({ label: 'Official', icon: ShieldCheck, tone: 'green' })
  } else if (place.sourceId === 'community') {
    badges.push({ label: 'Reviewed', icon: CircleDot, tone: 'gold' })
  } else {
    badges.push({ label: 'Local seed', icon: Award, tone: 'soft' })
  }

  if (place.category === 'food') {
    badges.push({ label: 'Food pick', icon: Utensils, tone: 'gold' })
  }

  if (place.category === 'hdb' || place.category === 'condo' || place.category === 'building') {
    badges.push({ label: 'Easy address', icon: Home, tone: 'blue' })
  }

  if (place.category === 'checkpoint' || place.tags.includes('cross-border')) {
    badges.push({ label: 'Cross-border', icon: CarFront, tone: 'blue' })
  }

  if (
    place.category === 'transport' ||
    place.tags.includes('mrt') ||
    place.tags.includes('bus') ||
    place.tags.includes('transit')
  ) {
    badges.push({ label: 'Transit easy', icon: TrainFront, tone: 'blue' })
  }

  if (place.tags.includes('tourist') || place.tags.includes('attraction')) {
    badges.push({ label: 'Visitor easy', icon: Sparkles, tone: 'gold' })
  }

  return badges.slice(0, 3)
}
