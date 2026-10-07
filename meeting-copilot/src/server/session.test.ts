import { describe, expect, it } from 'vitest'
import type { ServerMessage, SessionConfig } from '../shared/protocol.ts'
import { encodeAudioFrame } from '../shared/protocol.ts'
import { DEMO_SCRIPT, playDemo } from './demo.ts'
import { MockLlm } from './llm/mock.ts'
import { MockSttProvider } from './stt/mock.ts'
import type { LlmTextRequest } from './llm/types.ts'
import { MeetingSession } from './session.ts'
import type { SttProvider, SttStreamOptions } from './stt/types.ts'

const baseConfig: SessionConfig = {
  platform: 'zoom',
  spokenLanguages: ['zh', 'en'],
  targetLanguage: 'zh',
  translate: true,
  copilot: { enabled: true, autoTrigger: true },
  brief: { myRole: 'Lawgorithm 销售负责人', goal: '拿下试点', context: '企业版 SGD 2,000/月，数据驻留新加坡。' },
}

class FakeStt implements SttProvider {
  readonly name = 'fake'
  readonly opened: SttStreamOptions[] = []
  readonly written: Record<string, number> = {}
  open(options: SttStreamOptions) {
    this.opened.push(options)
    return {
      write: (pcm: Uint8Array) => {
        this.written[options.source] = (this.written[options.source] ?? 0) + pcm.byteLength
      },
      close: async () => {},
    }
  }
}

function setup(respond?: (r: LlmTextRequest) => string) {
  const messages: ServerMessage[] = []
  const stt = new FakeStt()
  const llm = new MockLlm(respond)
  const session = new MeetingSession({
    send: (m) => messages.push(m),
    stt,
    llm,
    models: { copilot: 'copilot-model', translate: 'translate-model', summary: 'summary-model' },
  })
  return { messages, stt, llm, session }
}

const result = (text: string, isFinal = true, speaker?: string) => ({ text, isFinal, speaker, startMs: 0, endMs: 1000 })

describe('MeetingSession', () => {
  it('routes audio frames to one STT stream per source, diarizing only remote audio', () => {
    const { session, stt, messages } = setup()
    session.handleAudio(new Uint8Array(encodeAudioFrame('remote', new Int16Array(1600))))
    expect(stt.opened).toHaveLength(0) // ignored before start
    session.handleMessage({ type: 'start', config: baseConfig })
    expect(messages[0]).toMatchObject({ type: 'ready', stt: 'fake', llm: 'mock' })

    session.handleAudio(new Uint8Array(encodeAudioFrame('remote', new Int16Array(1600))))
    session.handleAudio(new Uint8Array(encodeAudioFrame('me', new Int16Array(1600))))
    session.handleAudio(new Uint8Array(encodeAudioFrame('remote', new Int16Array(1600))))
    expect(stt.opened.map((o) => [o.source, o.diarize])).toEqual([
      ['remote', true],
      ['me', false],
    ])
    expect(stt.written).toEqual({ remote: 6400, me: 3200 })
  })

  it('decodes real audio frames for providers that read Int16 samples', () => {
    const messages: ServerMessage[] = []
    const session = new MeetingSession({
      send: (m) => messages.push(m),
      stt: new MockSttProvider(),
      llm: new MockLlm(),
      models: { copilot: 'c', translate: 't', summary: 's' },
    })
    session.handleMessage({ type: 'start', config: baseConfig })
    const loud = new Int16Array(1600).fill(8000)
    for (let i = 0; i < 3; i++) session.handleAudio(new Uint8Array(encodeAudioFrame('remote', loud)))
    expect(messages.some((m) => m.type === 'transcript')).toBe(true)
  })

  it('keeps segment ids stable across partials and advances after finals', () => {
    const { session, messages } = setup()
    session.handleMessage({ type: 'start', config: { ...baseConfig, translate: false, copilot: { enabled: false, autoTrigger: false } } })
    session.onSttResult('remote', result('Hel', false))
    session.onSttResult('remote', result('Hello', true))
    session.onSttResult('remote', result('Next', false))
    const ids = messages.filter((m) => m.type === 'transcript').map((m) => (m.type === 'transcript' ? m.segment.id : ''))
    expect(ids[0]).toBe(ids[1])
    expect(ids[2]).not.toBe(ids[1])
  })

  it('translates finals that are not already in the target language', async () => {
    const { session, messages, llm } = setup()
    session.handleMessage({ type: 'start', config: { ...baseConfig, copilot: { enabled: false, autoTrigger: false } } })
    session.onSttResult('remote', result('We review two hundred contracts a month.'))
    session.onSttResult('remote', result('我们每个月审核两百份合同。'))
    await session.idle()
    const translations = messages.filter((m) => m.type === 'translation')
    expect(translations).toHaveLength(1)
    expect(translations[0]).toMatchObject({ text: '〔模拟翻译〕We review two hundred contracts a month.' })
    const request = llm.requests[0]
    expect(request.model).toBe('translate-model')
    expect(request.effort).toBe('low')
    expect(request.cachedContext).toContain('SGD 2,000')
  })

  it('streams a suggestion for a remote question but not for the user’s own question', async () => {
    const { session, messages } = setup()
    session.handleMessage({ type: 'start', config: { ...baseConfig, translate: false } })
    session.onSttResult('me', result('你们预算是多少？'))
    session.onSttResult('remote', result('数据是存在新加坡的吗？', true, 'S1'))
    await session.idle()
    const starts = messages.filter((m) => m.type === 'suggestion.start')
    expect(starts).toHaveLength(1)
    expect(starts[0]).toMatchObject({ trigger: { kind: 'question', text: '数据是存在新加坡的吗？' } })
    const text = messages.map((m) => (m.type === 'suggestion.delta' ? m.delta : '')).join('')
    expect(text).toContain('**建议回应**')
    expect(messages.at(-1)).toMatchObject({ type: 'suggestion.done', error: undefined })
  })

  it('drops automatic suggestions when the model answers SKIP', async () => {
    const { session, messages } = setup((r) => (r.system.includes('[role:copilot]') ? 'SKIP' : ''))
    session.handleMessage({ type: 'start', config: { ...baseConfig, translate: false } })
    session.onSttResult('remote', result('How are you doing today?'))
    await session.idle()
    expect(messages.some((m) => m.type.startsWith('suggestion'))).toBe(false)
  })

  it('answers manual questions with the user question in the prompt', async () => {
    const { session, messages, llm } = setup()
    session.handleMessage({ type: 'start', config: { ...baseConfig, translate: false, copilot: { enabled: true, autoTrigger: false } } })
    session.onSttResult('remote', result('That quote is too expensive.'))
    session.handleMessage({ type: 'ask', question: '怎么回应价格异议？' })
    await session.idle()
    expect(messages.filter((m) => m.type === 'suggestion.start')).toHaveLength(1)
    expect(llm.requests[0].prompt).toContain('<user_question>\n怎么回应价格异议？')
    expect(llm.requests[0].prompt).toContain('对方: That quote is too expensive.')
  })

  it('streams a summary over the whole transcript', async () => {
    const { session, messages, llm } = setup()
    session.handleMessage({ type: 'start', config: { ...baseConfig, translate: false, copilot: { enabled: false, autoTrigger: false } } })
    session.onSttResult('remote', result('Let us sign next week.'))
    session.handleMessage({ type: 'summary' })
    await new Promise((r) => setTimeout(r, 50))
    expect(messages.map((m) => m.type)).toEqual(expect.arrayContaining(['summary.start', 'summary.delta', 'summary.done']))
    expect(llm.requests[0].model).toBe('summary-model')
    expect(llm.requests[0].prompt).toContain('Let us sign next week.')
  })
})

describe('demo script', () => {
  it('drives the full pipeline: transcript, translation and copilot suggestions', async () => {
    const { session, messages } = setup()
    session.handleMessage({ type: 'start', config: baseConfig })
    await playDemo((source, r) => session.onSttResult(source, r), { msPerToken: 0, script: DEMO_SCRIPT.map((l) => ({ ...l, gapMs: 0 })) })
    await session.idle()
    const finals = messages.filter((m) => m.type === 'transcript' && m.segment.isFinal)
    expect(finals).toHaveLength(DEMO_SCRIPT.length)
    expect(messages.filter((m) => m.type === 'translation').length).toBeGreaterThanOrEqual(3)
    expect(messages.filter((m) => m.type === 'suggestion.start').length).toBeGreaterThanOrEqual(1)
  })
})
