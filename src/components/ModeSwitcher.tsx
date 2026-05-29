import { BriefcaseBusiness, BusFront, Camera, Car } from 'lucide-react'
import { modeProfiles, userModeOrder } from '../data/modes'
import type { UserMode } from '../domain/types'

interface ModeSwitcherProps {
  userMode: UserMode
  onModeChange: (mode: UserMode) => void
}

export function ModeSwitcher({ userMode, onModeChange }: ModeSwitcherProps) {
  return (
    <section className="mode-switcher" aria-label="User mode">
      {userModeOrder.map((mode) => {
        const profile = modeProfiles[mode]
        const Icon = getModeIcon(mode)
        return (
          <button
            key={mode}
            type="button"
            className={userMode === mode ? 'active' : ''}
            onClick={() => onModeChange(mode)}
            title={profile.description}
          >
            <Icon size={16} />
            <span>{profile.shortLabel}</span>
          </button>
        )
      })}
    </section>
  )
}

function getModeIcon(mode: UserMode) {
  if (mode === 'visitor') {
    return Camera
  }

  if (mode === 'local') {
    return BriefcaseBusiness
  }

  if (mode === 'driver') {
    return Car
  }

  return BusFront
}
