import { describe, expect, it } from 'vitest'
import { initialState, type AppState } from '../state/reducer.ts'
import { deriveOverlayState } from './overlayState.ts'

describe('deriveOverlayState', () => {
  it('is idle with nothing to show before a meeting', () => {
    expect(deriveOverlayState(initialState)).toEqual({ phase: 'idle', lastRemote: undefined, suggestion: undefined })
  })

  it('shows the last final remote line with its translation and the newest suggestion', () => {
    const state: AppState = {
      ...initialState,
      phase: 'live',
      segments: [
        { id: 'a', source: 'remote', speaker: 'S1', text: 'What is the price?', isFinal: true, startMs: 0, endMs: 1 },
        { id: 'b', source: 'me', text: '我来说明一下', isFinal: true, startMs: 1, endMs: 2 },
        { id: 'c', source: 'remote', speaker: 'S1', text: 'And the tim', isFinal: false, startMs: 2, endMs: 3 },
      ],
      translations: { a: '价格是多少？' },
      speakerNames: { S1: '王总' },
      suggestions: [
        { id: 's2', trigger: { kind: 'objection', text: 'too expensive', replyLanguage: 'en' }, text: '**建议回应**：…', done: false },
        { id: 's1', trigger: { kind: 'question', text: 'q' }, text: 'old', done: true },
      ],
    }
    expect(deriveOverlayState(state)).toEqual({
      phase: 'live',
      lastRemote: { speaker: '王总', text: 'What is the price?', translation: '价格是多少？' },
      suggestion: { id: 's2', kind: '对方顾虑', quote: 'too expensive', text: '**建议回应**：…', done: false, replyLanguage: 'en' },
    })
  })

  it('skips lines from the speaker marked as the user', () => {
    const state: AppState = {
      ...initialState,
      phase: 'live',
      meSpeaker: 'S2',
      segments: [
        { id: 'a', source: 'remote', speaker: 'S1', text: 'Price?', isFinal: true, startMs: 0, endMs: 1 },
        { id: 'b', source: 'remote', speaker: 'S2', text: 'Let me check.', isFinal: true, startMs: 1, endMs: 2 },
      ],
    }
    expect(deriveOverlayState(state).lastRemote?.text).toBe('Price?')
  })
})
