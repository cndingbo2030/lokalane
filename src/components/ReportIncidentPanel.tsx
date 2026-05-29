import { MessageSquareWarning, Send } from 'lucide-react'
import { useState } from 'react'
import type { IncidentReport, IncidentType, Place } from '../domain/types'

interface ReportIncidentPanelProps {
  selectedPlace?: Place
  reportCount: number
  onSubmit: (report: Omit<IncidentReport, 'id' | 'createdAt'>) => void
}

const incidentOptions: Array<{ type: IncidentType; label: string }> = [
  { type: 'jam', label: 'Jam' },
  { type: 'accident', label: 'Accident' },
  { type: 'closure', label: 'Closure' },
  { type: 'hazard', label: 'Hazard' },
  { type: 'police', label: 'Police' },
]

export function ReportIncidentPanel({
  selectedPlace,
  reportCount,
  onSubmit,
}: ReportIncidentPanelProps) {
  const [type, setType] = useState<IncidentType>('jam')
  const [note, setNote] = useState('')
  const [submitted, setSubmitted] = useState(false)

  if (!selectedPlace) {
    return null
  }

  return (
    <section className="report-panel" aria-label="Report road condition">
      <div className="quality-heading">
        <span className="quality-icon">
          <MessageSquareWarning size={17} />
        </span>
        <div>
          <strong>Report near {selectedPlace.name}</strong>
          <span>{reportCount} community report{reportCount === 1 ? '' : 's'} this session</span>
        </div>
      </div>

      <div className="incident-grid" aria-label="Incident type">
        {incidentOptions.map((option) => (
          <button
            key={option.type}
            type="button"
            className={type === option.type ? 'active' : ''}
            onClick={() => {
              setType(option.type)
              setSubmitted(false)
            }}
          >
            {option.label}
          </button>
        ))}
      </div>

      <label className="report-note">
        <span>What should other commuters know?</span>
        <textarea
          value={note}
          onChange={(event) => {
            setNote(event.target.value)
            setSubmitted(false)
          }}
          placeholder="Example: queue starts before the slip road"
          rows={3}
        />
      </label>

      <button
        type="button"
        className="submit-report"
        disabled={note.trim().length < 4}
        onClick={() => {
          if (note.trim().length < 4) {
            return
          }

          onSubmit({
            type,
            placeId: selectedPlace.id,
            note: note.trim(),
            coordinates: selectedPlace.coordinates,
          })
          setNote('')
          setSubmitted(true)
        }}
      >
        <Send size={16} />
        Send report
      </button>

      {submitted ? <p className="report-success">Added to community layer.</p> : null}
    </section>
  )
}
