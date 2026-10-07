import { describe, expect, it } from 'vitest'
import { DeepgramAccumulator, deepgramLanguage } from './deepgram.ts'
import { MockSttProvider } from './mock.ts'
import { SonioxAccumulator } from './soniox.ts'
import type { SttResult } from './types.ts'

const dgResult = (transcript: string, opts: { isFinal?: boolean; speechFinal?: boolean; start?: number; speaker?: number } = {}) => ({
  type: 'Results',
  is_final: opts.isFinal ?? false,
  speech_final: opts.speechFinal ?? false,
  start: opts.start ?? 0,
  duration: 1,
  channel: {
    alternatives: [
      { transcript, words: transcript ? [{ word: 'x', start: 0, end: 1, speaker: opts.speaker }] : [] },
    ],
  },
})

describe('DeepgramAccumulator', () => {
  it('merges is_final chunks into one utterance until speech_final', () => {
    const acc = new DeepgramAccumulator()
    expect(acc.handle(dgResult('what is'))).toMatchObject([{ text: 'what is', isFinal: false }])
    expect(acc.handle(dgResult('what is your', { isFinal: true }))).toMatchObject([{ text: 'what is your', isFinal: false }])
    expect(acc.handle(dgResult('price', { start: 1 }))).toMatchObject([{ text: 'what is your price', isFinal: false }])
    const final = acc.handle(dgResult('price?', { isFinal: true, speechFinal: true, start: 1, speaker: 0 }))
    expect(final).toEqual([
      expect.objectContaining({ text: 'what is your price?', isFinal: true, startMs: 0, endMs: 2000 }),
    ])
  })

  it('flushes on UtteranceEnd and labels speakers', () => {
    const acc = new DeepgramAccumulator()
    acc.handle(dgResult('你好', { isFinal: true, speaker: 1 }))
    const [result] = acc.handle({ type: 'UtteranceEnd' })
    expect(result).toMatchObject({ text: '你好', isFinal: true, speaker: 'S2' })
    expect(acc.handle({ type: 'UtteranceEnd' })).toEqual([])
  })

  it('picks a pinned language or multi', () => {
    expect(deepgramLanguage(['zh'])).toBe('zh-CN')
    expect(deepgramLanguage(['en'])).toBe('en')
    expect(deepgramLanguage(['en', 'es'])).toBe('multi')
    expect(deepgramLanguage(['auto'])).toBe('multi')
  })
})

describe('SonioxAccumulator', () => {
  const tok = (text: string, isFinal: boolean, extra: Record<string, unknown> = {}) => ({ text, is_final: isFinal, start_ms: 0, end_ms: 100, ...extra })

  it('emits partial = final + non-final tokens and closes on <end>', () => {
    const acc = new SonioxAccumulator()
    expect(acc.handle({ tokens: [tok('价格', true, { language: 'zh' }), tok('是多少', false)] })).toMatchObject([
      { text: '价格是多少', isFinal: false },
    ])
    const out = acc.handle({ tokens: [tok('是多少？', true, { language: 'zh', end_ms: 900 }), tok('<end>', true)] })
    expect(out).toEqual([expect.objectContaining({ text: '价格是多少？', isFinal: true, language: 'zh', endMs: 900 })])
  })

  it('splits utterances on speaker change', () => {
    const acc = new SonioxAccumulator()
    const out = acc.handle({ tokens: [tok('Hello', true, { speaker: '1' }), tok(' there', true, { speaker: '2' })] })
    expect(out[0]).toMatchObject({ text: 'Hello', isFinal: true, speaker: 'S1' })
    expect(out[1]).toMatchObject({ text: 'there', isFinal: false, speaker: 'S2' })
  })

  it('flushes on finished and ignores <fin>', () => {
    const acc = new SonioxAccumulator()
    acc.handle({ tokens: [tok('done', true)] })
    expect(acc.handle({ tokens: [tok('<fin>', true)], finished: true })).toMatchObject([{ text: 'done', isFinal: true }])
  })
})

describe('MockSttProvider', () => {
  it('turns loud audio followed by silence into a final placeholder segment', () => {
    const results: SttResult[] = []
    const stream = new MockSttProvider().open({
      source: 'remote',
      languages: ['zh'],
      diarize: false,
      onResult: (r) => results.push(r),
      onError: () => {},
    })
    const loud = new Int16Array(1600).fill(8000)
    const silent = new Int16Array(1600)
    for (let i = 0; i < 10; i++) stream.write(new Uint8Array(loud.buffer))
    for (let i = 0; i < 8; i++) stream.write(new Uint8Array(silent.buffer))
    const final = results.filter((r) => r.isFinal)
    expect(final).toHaveLength(1)
    expect(final[0].text).toContain('1.0s')
  })
})
