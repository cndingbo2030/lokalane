import { describe, expect, it } from 'vitest'
import type { ServerMessage } from '../shared/protocol.ts'
import { forViewers } from './share.ts'

describe('forViewers', () => {
  const outcomes = { decisions: ['d'], actionItems: [], followUpEmail: { subject: 'Private', body: 'Draft' } }

  it('forwards the transcript and summary, never metrics, errors or the email draft', () => {
    const transcript: ServerMessage = { type: 'transcript', segment: { id: 'a', source: 'remote', text: 'hi', isFinal: true, startMs: 0, endMs: 1 } }
    expect(forViewers(transcript, false)).toBe(transcript)
    expect(forViewers({ type: 'summary.delta', delta: 'x' }, false)).toEqual({ type: 'summary.delta', delta: 'x' })
    expect(forViewers({ type: 'error', message: 'boom', recoverable: true }, true)).toBeNull()
    expect(forViewers({ type: 'bot', state: 'joining' }, true)).toBeNull()
    expect(forViewers({ type: 'outcomes', outcomes }, true)).toEqual({ type: 'outcomes', outcomes: { ...outcomes, followUpEmail: { subject: '', body: '' } } })
  })

  it('forwards suggestions only when the owner shares them', () => {
    const start: ServerMessage = { type: 'suggestion.start', id: 's1', trigger: { kind: 'question', text: 'q' } }
    expect(forViewers(start, false)).toBeNull()
    expect(forViewers(start, true)).toBe(start)
  })
})
