import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ModeSwitcher } from './ModeSwitcher'

describe('ModeSwitcher', () => {
  it('switches between product modes', async () => {
    const user = userEvent.setup()
    const onModeChange = vi.fn()

    render(<ModeSwitcher userMode="visitor" onModeChange={onModeChange} />)

    await user.click(screen.getByRole('button', { name: 'Local' }))
    await user.click(screen.getByRole('button', { name: 'Transit' }))

    expect(onModeChange).toHaveBeenNthCalledWith(1, 'local')
    expect(onModeChange).toHaveBeenNthCalledWith(2, 'transit')
  })
})
