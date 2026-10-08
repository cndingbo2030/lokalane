import { describe, expect, it } from 'vitest'
import type { ServerMessage, TranscriptSegment } from '../../shared/protocol.ts'
import { initialState, reducer, transcriptToMarkdown, type AppState } from './reducer.ts'

const segment = (id: string, text: string, isFinal: boolean): TranscriptSegment => ({
  id,
  source: 'remote',
  speaker: 'S1',
  text,
  isFinal,
  startMs: 61_000,
  endMs: 62_000,
})

const server = (state: AppState, message: ServerMessage) => reducer(state, { type: 'server', message })

describe('reducer', () => {
  it('goes live on ready', () => {
    const connecting = reducer(initialState, { type: 'phase', phase: 'connecting' })
    const live = server(connecting, { type: 'ready', sessionId: 's', stt: 'soniox', llm: 'anthropic' })
    expect(live).toMatchObject({ phase: 'live', stt: 'soniox', llm: 'anthropic' })
  })

  it('replaces partial segments in place and appends new ones', () => {
    let state = server(initialState, { type: 'transcript', segment: segment('a', 'Hel', false) })
    state = server(state, { type: 'transcript', segment: segment('a', 'Hello', true) })
    state = server(state, { type: 'transcript', segment: segment('b', 'Next', false) })
    expect(state.segments.map((s) => [s.id, s.text, s.isFinal])).toEqual([
      ['a', 'Hello', true],
      ['b', 'Next', false],
    ])
  })

  it('streams suggestions newest-first', () => {
    let state = server(initialState, { type: 'suggestion.start', id: '1', trigger: { kind: 'question', text: 'q1' } })
    state = server(state, { type: 'suggestion.delta', id: '1', delta: 'Hi ' })
    state = server(state, { type: 'suggestion.start', id: '2', trigger: { kind: 'objection', text: 'q2' } })
    state = server(state, { type: 'suggestion.delta', id: '1', delta: 'there' })
    state = server(state, { type: 'suggestion.done', id: '1' })
    expect(state.suggestions.map((s) => [s.id, s.text, s.done])).toEqual([
      ['2', '', false],
      ['1', 'Hi there', true],
    ])
  })

  it('accumulates the summary and records errors once', () => {
    let state = server(initialState, { type: 'summary.start' })
    state = server(state, { type: 'summary.delta', delta: '## A' })
    state = server(state, { type: 'summary.done' })
    expect(state.summary).toEqual({ status: 'done', text: '## A' })

    state = server(state, { type: 'error', message: 'boom', recoverable: true })
    state = server(state, { type: 'error', message: 'boom', recoverable: true })
    expect(state.errors).toHaveLength(1)
  })

  it('stores metrics, ratings and speaker names', () => {
    let state = server(initialState, { type: 'suggestion.start', id: '1', trigger: { kind: 'question', text: 'q' } })
    state = reducer(state, { type: 'rate', id: '1', rating: 'up' })
    expect(state.suggestions[0].rating).toBe('up')
    state = reducer(state, { type: 'rate', id: '1', rating: null })
    expect(state.suggestions[0].rating).toBeUndefined()

    state = reducer(state, { type: 'renameSpeaker', speaker: 'S1', name: ' 王总 ' })
    expect(state.speakerNames).toEqual({ S1: '王总' })
    state = server(state, { type: 'transcript', segment: segment('a', 'Hi', true) })
    expect(transcriptToMarkdown(state)).toContain('**王总**')
    state = reducer(state, { type: 'renameSpeaker', speaker: 'S1', name: '' })
    expect(state.speakerNames).toEqual({})
  })

  it('tracks outcomes, lets the user tick action items off and resets on a new summary', () => {
    const outcomes = {
      decisions: ['推进试点'],
      actionItems: [
        { id: 'a1', owner: '我', task: '发送报价单', due: '2026-10-09' },
        { id: 'a2', owner: 'S1', task: '确认预算', due: null },
      ],
      followUpEmail: { subject: '跟进', body: '感谢' },
    }
    let state = server(initialState, { type: 'outcomes.start' })
    expect(state.outcomes).toEqual({ status: 'loading' })
    state = server(state, { type: 'outcomes', outcomes })
    expect(state.outcomes.status).toBe('done')
    state = reducer(state, { type: 'toggleActionItem', id: 'a2' })
    expect(state.outcomes.data?.actionItems.map((i) => Boolean(i.done))).toEqual([false, true])
    state = reducer(state, { type: 'toggleActionItem', id: 'a2' })
    expect(state.outcomes.data?.actionItems[1].done).toBe(false)

    state = server(state, { type: 'summary.start' })
    expect(state.outcomes).toEqual({ status: 'idle' })
    state = server(state, { type: 'outcomes', error: 'model refused' })
    expect(state.outcomes).toEqual({ status: 'error', error: 'model refused' })
  })

  it('exports finals with translations as markdown', () => {
    let state = server(initialState, { type: 'transcript', segment: segment('a', 'Hello', true) })
    state = server(state, { type: 'transcript', segment: segment('b', 'partial', false) })
    state = server(state, { type: 'translation', segmentId: 'a', text: '你好', targetLanguage: 'zh' })
    const md = transcriptToMarkdown(state)
    expect(md).toContain('**对方 S1** (01:01): Hello')
    expect(md).toContain('_你好_')
    expect(md).not.toContain('partial')
  })
})
