import { afterEach, describe, expect, it, vi } from 'vitest'
import { keepFocusController, tabCaptureOptions, withTitleHint } from './engine.ts'

describe('tab capture', () => {
  it('asks Chrome to keep this tab in front, before the picker opens, and hides "share this tab instead"', () => {
    const calls: string[] = []
    class CaptureController {
      setFocusBehavior(behavior: string) {
        calls.push(behavior)
      }
    }
    const controller = keepFocusController({ CaptureController })
    expect(calls).toEqual(['no-focus-change'])
    expect(tabCaptureOptions(controller)).toMatchObject({ controller, surfaceSwitching: 'exclude', selfBrowserSurface: 'exclude', systemAudio: 'include' })
  })

  it('falls back to the old behavior where the API is missing or refuses', () => {
    expect(keepFocusController({})).toBeUndefined()
    class Refusing {
      setFocusBehavior() {
        throw new DOMException('too late', 'InvalidStateError')
      }
    }
    expect(keepFocusController({ CaptureController: Refusing })).toBeUndefined()
    expect(tabCaptureOptions(undefined)).not.toHaveProperty('controller')
  })
})

describe('withTitleHint', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the hint in the tab title while the answer takes long, then restores it', async () => {
    vi.useFakeTimers()
    const doc = { title: 'Meeting Copilot' }
    let answer!: (value: string) => void
    const result = withTitleHint(new Promise<string>((resolve) => (answer = resolve)), doc, '🎙 请回到此页允许麦克风', 4_000)
    vi.advanceTimersByTime(3_999)
    expect(doc.title).toBe('Meeting Copilot')
    vi.advanceTimersByTime(1)
    expect(doc.title).toBe('🎙 请回到此页允许麦克风')
    answer('mic')
    await expect(result).resolves.toBe('mic')
    expect(doc.title).toBe('Meeting Copilot')
  })

  it('leaves the title alone when the answer is quick, and restores it when the user refuses', async () => {
    vi.useFakeTimers()
    const doc = { title: 'Meeting Copilot' }
    await expect(withTitleHint(Promise.resolve('ok'), doc, 'hint', 4_000)).resolves.toBe('ok')
    vi.advanceTimersByTime(10_000)
    expect(doc.title).toBe('Meeting Copilot')

    let refuse!: (error: Error) => void
    const denied = withTitleHint(new Promise<string>((_, reject) => (refuse = reject)), doc, 'hint', 4_000)
    vi.advanceTimersByTime(4_000)
    expect(doc.title).toBe('hint')
    refuse(new Error('NotAllowedError'))
    await expect(denied).rejects.toThrow('NotAllowedError')
    expect(doc.title).toBe('Meeting Copilot')
  })
})
