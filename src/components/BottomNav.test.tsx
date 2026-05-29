import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { BottomNav } from './BottomNav'

describe('BottomNav', () => {
  it('routes users to the selected product view', async () => {
    const user = userEvent.setup()
    const onViewChange = vi.fn()

    render(
      <BottomNav
        activeView="map"
        isNavigating={false}
        onViewChange={onViewChange}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Commute' }))
    await user.click(screen.getByRole('button', { name: 'Report' }))

    expect(onViewChange).toHaveBeenNthCalledWith(1, 'commute')
    expect(onViewChange).toHaveBeenNthCalledWith(2, 'report')
  })
})
