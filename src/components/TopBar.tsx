import { Car, Layers3, MapPinned, Navigation, Search } from 'lucide-react'
import type { BaseMapMode, CountryCode } from '../domain/types'

interface TopBarProps {
  baseMapMode: BaseMapMode
  countryFilter: CountryCode | 'ALL'
  query: string
  onBaseMapChange: (mode: BaseMapMode) => void
  onCountryChange: (country: CountryCode | 'ALL') => void
  onQueryChange: (query: string) => void
}

export function TopBar({
  baseMapMode,
  countryFilter,
  query,
  onBaseMapChange,
  onCountryChange,
  onQueryChange,
}: TopBarProps) {
  return (
    <header className="top-bar">
      <div className="brand-lockup" aria-label="LokaLane">
        <span className="brand-mark">
          <Navigation size={19} strokeWidth={2.4} />
        </span>
        <span className="brand-name">LokaLane</span>
      </div>

      <label className="search-shell">
        <Search size={18} aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search address, mall, checkpoint, bus stop"
          aria-label="Search places"
        />
      </label>

      <div className="segmented-controls" aria-label="Country filter">
        {(['ALL', 'SG', 'MY'] as const).map((country) => (
          <button
            key={country}
            type="button"
            className={countryFilter === country ? 'active' : ''}
            onClick={() => onCountryChange(country)}
          >
            {country}
          </button>
        ))}
      </div>

      <div className="icon-toggle-group" aria-label="Base map">
        <button
          type="button"
          className={baseMapMode === 'regional' ? 'active' : ''}
          onClick={() => onBaseMapChange('regional')}
          title="Regional map"
        >
          <MapPinned size={18} />
        </button>
        <button
          type="button"
          className={baseMapMode === 'sg-official' ? 'active' : ''}
          onClick={() => onBaseMapChange('sg-official')}
          title="OneMap Singapore"
        >
          <Layers3 size={18} />
        </button>
        <button type="button" title="Driving mode">
          <Car size={18} />
        </button>
      </div>
    </header>
  )
}
