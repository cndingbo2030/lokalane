import { MapPinned, Route, ShieldCheck } from 'lucide-react'
import { modeProfiles } from '../data/modes'
import type { UserMode } from '../domain/types'

interface ModeSummaryPanelProps {
  userMode: UserMode
}

export function ModeSummaryPanel({ userMode }: ModeSummaryPanelProps) {
  const profile = modeProfiles[userMode]

  return (
    <section className="mode-summary" aria-label="Mode summary">
      <div>
        <p className="eyebrow">{profile.label}</p>
        <h2>{profile.description}</h2>
      </div>
      <div className="mode-benefits">
        <span>
          <MapPinned size={15} />
          {profile.countryFilter === 'ALL' ? 'SG + MY' : profile.countryFilter}
        </span>
        <span>
          <Route size={15} />
          {profile.mobilityMode}
        </span>
        <span>
          <ShieldCheck size={15} />
          {profile.visibleLayerIds.length} layers
        </span>
      </div>
    </section>
  )
}
