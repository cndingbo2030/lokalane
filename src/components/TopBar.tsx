import { Layers3, MapPinned, Navigation, Search, X } from 'lucide-react'
import type { BaseMapMode, CountryCode, UserMode } from '../domain/types'
import { ModeMenu } from './ModeMenu'

interface TopBarProps {
  baseMapMode: BaseMapMode
  countryFilter: CountryCode | 'ALL'
  query: string
  searchPlaceholder: string
  userMode: UserMode
  onBaseMapChange: (mode: BaseMapMode) => void
  onCountryChange: (country: CountryCode | 'ALL') => void
  onUserModeChange: (mode: UserMode) => void
  onQueryChange: (query: string) => void
  onSearchClear: () => void
  onSearchFocus: () => void
}

export function TopBar({
  baseMapMode,
  countryFilter,
  query,
  searchPlaceholder,
  userMode,
  onBaseMapChange,
  onCountryChange,
  onUserModeChange,
  onQueryChange,
  onSearchClear,
  onSearchFocus,
}: TopBarProps) {
  const hasQuery = query.trim().length > 0

  return (
    <header className="top-bar">
      <div className="brand-lockup" aria-label="LokaLane">
        <span className="brand-mark">
          <Navigation size={19} strokeWidth={2.4} />
        </span>
        <span className="brand-name">LokaLane</span>
      </div>

      <div className="search-shell">
        <Search size={18} aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onFocus={onSearchFocus}
          placeholder={searchPlaceholder}
          aria-label="Search places"
        />
        {hasQuery ? (
          <button
            type="button"
            className="search-clear-button"
            aria-label="Clear search"
            title="Clear search"
            onClick={onSearchClear}
          >
            <X size={18} />
          </button>
        ) : null}
      </div>

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
          aria-label="Regional map"
        >
          <MapPinned size={18} />
        </button>
        <button
          type="button"
          className={baseMapMode === 'sg-official' ? 'active' : ''}
          onClick={() => onBaseMapChange('sg-official')}
          title="OneMap Singapore"
          aria-label="OneMap Singapore"
        >
          <Layers3 size={18} />
        </button>
        <ModeMenu userMode={userMode} onModeChange={onUserModeChange} />
      </div>
    </header>
  )
}
