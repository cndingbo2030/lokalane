import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ReportIncidentPanel } from './ReportIncidentPanel'
import type { Place } from '../domain/types'

const place: Place = {
  id: 'woodlands-checkpoint',
  name: 'Woodlands Checkpoint',
  category: 'checkpoint',
  country: 'SG',
  area: 'Woodlands',
  address: '21 Woodlands Crossing, Singapore',
  coordinates: { lat: 1.4452, lng: 103.7683 },
  sourceId: 'lokalane-curated',
  confidence: 0.92,
  tags: ['causeway'],
  signal: 'Cross-border route anchor',
  updatedAt: '2026-05-29',
}

describe('ReportIncidentPanel', () => {
  it('submits a community report for the selected place', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()

    render(
      <ReportIncidentPanel
        selectedPlace={place}
        reportCount={0}
        onSubmit={onSubmit}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Closure' }))
    await user.type(
      screen.getByPlaceholderText('Example: queue starts before the slip road'),
      'Lane closed before checkpoint',
    )
    await user.click(screen.getByRole('button', { name: 'Send report' }))

    expect(onSubmit).toHaveBeenCalledWith({
      type: 'closure',
      placeId: 'woodlands-checkpoint',
      note: 'Lane closed before checkpoint',
      coordinates: place.coordinates,
    })
    expect(screen.getByText('Added to community layer.')).toBeInTheDocument()
  })
})
