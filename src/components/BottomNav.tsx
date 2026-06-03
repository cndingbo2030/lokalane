import { Bookmark, Map, MessageCircle, MessageSquareWarning, TimerReset } from 'lucide-react'
import type { AppView } from '../domain/types'

interface BottomNavProps {
  activeView: AppView
  isNavigating: boolean
  onViewChange: (view: AppView) => void
}

const navItems: Array<{ view: AppView; label: string; icon: typeof Map }> = [
  { view: 'map', label: 'Map', icon: Map },
  { view: 'commute', label: 'Route', icon: TimerReset },
  { view: 'community', label: 'Nearby', icon: MessageCircle },
  { view: 'saved', label: 'Saved', icon: Bookmark },
  { view: 'report', label: 'Report', icon: MessageSquareWarning },
]

export function BottomNav({ activeView, isNavigating, onViewChange }: BottomNavProps) {
  return (
    <nav className={isNavigating ? 'bottom-nav navigating' : 'bottom-nav'} aria-label="Main app views">
      {navItems.map((item) => {
        const Icon = item.icon
        return (
          <button
            key={item.view}
            type="button"
            className={activeView === item.view ? 'active' : ''}
            onClick={() => onViewChange(item.view)}
          >
            <Icon size={18} />
            <span>{item.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
