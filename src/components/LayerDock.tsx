import { BatteryCharging, BusFront, CircleAlert, ParkingCircle, Route, TriangleAlert } from 'lucide-react'
import { mapLayers } from '../data/layers'

interface LayerDockProps {
  visibleLayerIds: string[]
  onToggleLayer: (layerId: string) => void
  onReportClick: () => void
}

export function LayerDock({ visibleLayerIds, onToggleLayer, onReportClick }: LayerDockProps) {
  return (
    <nav className="layer-dock fab-stack" aria-label="Map controls">
      {mapLayers.map((layer) => (
        <button
          key={layer.id}
          type="button"
          className={visibleLayerIds.includes(layer.id) ? 'active' : ''}
          onClick={() => onToggleLayer(layer.id)}
          title={layer.description}
          aria-label={layer.label}
        >
          {getLayerIcon(layer.id)}
          <span className="fab-label">{layer.label}</span>
        </button>
      ))}
      <button
        type="button"
        className="fab-report"
        onClick={onReportClick}
        title="Report nearby community signal"
        aria-label="Report nearby community signal"
      >
        <TriangleAlert size={22} strokeWidth={2.4} />
        <span className="fab-label">Report</span>
      </button>
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
