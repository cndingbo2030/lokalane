import { Send, ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import type { Place, QualityReport } from '../domain/types'

interface QualityReportPanelProps {
  place?: Place
  reportCount: number
  onSubmit: (report: Omit<QualityReport, 'createdAt'>) => void
}

const reportReasons: Array<{ value: QualityReport['reason']; label: string }> = [
  { value: 'wrong-location', label: 'Wrong pin' },
  { value: 'closed', label: 'Closed' },
  { value: 'missing-detail', label: 'Missing detail' },
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'other', label: 'Other' },
]

export function QualityReportPanel({
  place,
  reportCount,
  onSubmit,
}: QualityReportPanelProps) {
  const [reason, setReason] = useState<QualityReport['reason']>('wrong-location')
  const [note, setNote] = useState('')
  const [submitted, setSubmitted] = useState(false)

  if (!place) {
    return null
  }

  const canSubmit = note.trim().length >= 4

  return (
    <section className="quality-panel" aria-label="Data quality report">
      <div className="quality-heading">
        <span className="quality-icon">
          <ShieldAlert size={17} />
        </span>
        <div>
          <strong>Improve this place</strong>
          <span>{reportCount} pending local correction{reportCount === 1 ? '' : 's'}</span>
        </div>
      </div>

      <div className="reason-grid" aria-label="Report reason">
        {reportReasons.map((option) => (
          <button
            key={option.value}
            type="button"
            className={reason === option.value ? 'active' : ''}
            onClick={() => setReason(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <label className="report-note">
        <span>Correction note</span>
        <textarea
          value={note}
          onChange={(event) => {
            setNote(event.target.value)
            setSubmitted(false)
          }}
          placeholder="Example: carpark entrance is on the other side"
          rows={3}
        />
      </label>

      <button
        type="button"
        className="submit-report"
        disabled={!canSubmit}
        onClick={() => {
          if (!canSubmit) {
            return
          }

          onSubmit({
            placeId: place.id,
            reason,
            note: note.trim(),
          })
          setNote('')
          setSubmitted(true)
        }}
      >
        <Send size={16} />
        Submit correction
      </button>

      {submitted ? <p className="report-success">Saved to the moderation queue.</p> : null}
    </section>
  )
}
