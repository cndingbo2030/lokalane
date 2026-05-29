import { Coffee, Hotel, Landmark, Utensils } from 'lucide-react'

interface VisitorFocusProps {
  onQueryChange: (query: string) => void
}

const visitorIntents = [
  { label: 'Attractions', query: 'attraction', icon: Landmark },
  { label: 'Hawker food', query: 'hawker food', icon: Utensils },
  { label: 'Hotels', query: 'hotel', icon: Hotel },
  { label: 'Cafes', query: 'cafe', icon: Coffee },
]

export function VisitorFocus({ onQueryChange }: VisitorFocusProps) {
  return (
    <section className="visitor-focus" aria-label="Visitor focus">
      {visitorIntents.map((intent) => {
        const Icon = intent.icon
        return (
          <button
            key={intent.label}
            type="button"
            onClick={() => onQueryChange(intent.query)}
          >
            <Icon size={15} />
            <span>{intent.label}</span>
          </button>
        )
      })}
    </section>
  )
}
