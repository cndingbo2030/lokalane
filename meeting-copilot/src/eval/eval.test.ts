import { describe, expect, it } from 'vitest'
import { checkSuggestion, type CopilotCase } from './copilotCases.ts'
import { aggregate, editDistance, mixedErrorRate, tokenize } from './errorRate.ts'
import { decodeWav, encodeWav, toPcmFrames } from './wav.ts'

describe('mixed error rate', () => {
  it('tokenizes CJK per character and Latin per word, ignoring punctuation and case', () => {
    expect(tokenize('我们用 Soniox, OK？')).toEqual(['我', '们', '用', 'soniox', 'ok'])
  })

  it('computes edit distance', () => {
    expect(editDistance(['a', 'b', 'c'], ['a', 'x', 'c', 'd'])).toBe(2)
    expect(editDistance([], ['a'])).toBe(1)
  })

  it('scores code-switched transcripts', () => {
    expect(mixedErrorRate('价格是 SGD 2000', '价格是 SGD 2000').rate).toBe(0)
    const r = mixedErrorRate('数据存在新加坡 region', '数据存在新加坡 regions')
    expect(r).toEqual({ errors: 1, referenceTokens: 8, rate: 1 / 8 })
    expect(aggregate([r, { errors: 1, referenceTokens: 2, rate: 0.5 }]).rate).toBe(0.2)
  })
})

describe('wav', () => {
  it('round-trips 16-bit stereo, downmixes and resamples to 16 kHz frames', () => {
    const stereo = new Int16Array(48_000 * 2) // 1 s at 48 kHz
    for (let i = 0; i < 48_000; i++) {
      stereo[i * 2] = 16_000
      stereo[i * 2 + 1] = 0
    }
    const wav = decodeWav(encodeWav(stereo, 48_000, 2))
    expect(wav).toMatchObject({ sampleRate: 48_000, channels: 2 })
    expect(wav.samples[10]).toBeCloseTo(16_000 / 0x8000 / 2)
    const frames = toPcmFrames(wav)
    expect(frames).toHaveLength(10)
    expect(frames[0].byteLength).toBe(3200)
  })

  it('rejects non-WAV input', () => {
    expect(() => decodeWav(new TextEncoder().encode('hello world, not audio'))).toThrow('Not a WAV')
  })
})

describe('checkSuggestion', () => {
  const base: CopilotCase = { id: 'c', description: '', kind: 'question', transcript: [], expect: {} }

  it('passes when expectations hold', () => {
    const c = { ...base, expect: { mustMention: ['2,?000'], mustNotMention: ['1500'], replyLanguage: 'en', bilingual: true } }
    const output = '**建议回应**：The plan is SGD 2,000 per month.\n↳ 每月 2000 新元。\n**要点**\n- 报价单'
    expect(checkSuggestion(c, output).failures).toEqual([])
  })

  it('reports each failed expectation', () => {
    const c = { ...base, expect: { shouldSkip: false, mustMention: ['ISO 27001'], replyLanguage: 'zh', bilingual: true } }
    const { failures } = checkSuggestion(c, '**建议回应**：Sure, we can do that.')
    expect(failures).toEqual(['missing: ISO 27001', 'reply language: expected zh', 'missing ↳ translation line'])
    expect(checkSuggestion({ ...base, expect: { shouldSkip: true } }, 'Some answer').failures).toEqual(['expected SKIP'])
    expect(checkSuggestion({ ...base, expect: { shouldSkip: false } }, 'SKIP').failures).toEqual(['unexpected SKIP'])
  })
})
