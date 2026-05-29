import { BatteryCharging, BusFront, CircleAlert, ParkingCircle, Route } from 'lucide-react'
import { mapLayers } from '../data/layers'

interface LayerDockProps {
  visibleLayerIds: string[]
  onToggleLayer: (layerId: string) => void
}

export function LayerDock({ visibleLayerIds, onToggleLayer }: LayerDockProps) {
  return (
    <nav className="layer-dock" aria-label="Map layers">
      {mapLayers.map((layer) => (
        <button
          key={layer.id}
          type="button"
          className={visibleLayerIds.includes(layer.id) ? 'active' : ''}
          onClick={() => onToggleLayer(layer.id)}
          title={layer.description}
        >
          {getLayerIcon(layer.id)}
          <span>{layer.label}</span>
        </button>
      ))}
    </nav>
  )
}

function getLayerIcon(layerId: string) {
  const props = { size: 17, strokeWidth: 2.3 }

  if (layerId === 'traffic') {
    return <Route {...props} />
  }

  if (layerId === 'bus') {
    return <BusFront {...props} />
  }

  if (layerId === 'parking') {
    return <ParkingCircle {...props} />
  }

  if (layerId === 'ev') {
    return <BatteryCharging {...props} />
  }

  return <CircleAlert {...props} />
}
