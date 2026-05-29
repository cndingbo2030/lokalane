import { BriefcaseBusiness, BusFront, Camera, Car } from 'lucide-react'
import { useState } from 'react'
import { modeProfiles, userModeOrder } from '../data/modes'
import type { UserMode } from '../domain/types'

interface ModeMenuProps {
  userMode: UserMode
  onModeChange: (mode: UserMode) => void
}

export function ModeMenu({ userMode, onModeChange }: ModeMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const activeProfile = modeProfiles[userMode]
  const ActiveIcon = modeIcons[userMode]

  return (
    <div className="mode-menu">
      <button
        type="button"
        className="mode-menu-trigger"
        aria-expanded={isOpen}
        aria-label={`Mode: ${activeProfile.shortLabel}`}
        title={`Mode: ${activeProfile.shortLabel}`}
        onClick={() => setIsOpen((value) => !value)}
      >
        <ActiveIcon size={18} />
        <span>{activeProfile.shortLabel}</span>
      </button>

      {isOpen ? (
        <div className="mode-menu-popover" aria-label="User mode">
          {userModeOrder.map((mode) => {
            const profile = modeProfiles[mode]
            const Icon = modeIcons[mode]
            return (
              <button
                key={mode}
                type="button"
                className={mode === userMode ? 'active' : ''}
                onClick={() => {
                  onModeChange(mode)
                  setIsOpen(false)
                }}
              >
                <Icon size={16} />
                <span>
                  <strong>{profile.shortLabel}</strong>
                  <small>{getModeSummary(mode)}</small>
                </span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

const modeIcons = {
  visitor: Camera,
  local: BriefcaseBusiness,
  driver: Car,
  transit: BusFront,
} satisfies Record<UserMode, typeof Camera>

function getModeSummary(mode: UserMode) {
  const labels: Record<UserMode, string> = {
    visitor: 'Attractions and food',
    local: 'Daily commute',
    driver: 'Roads and parking',
    transit: 'MRT and buses',
  }

  return labels[mode]
}
