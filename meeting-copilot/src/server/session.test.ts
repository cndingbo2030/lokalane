import { describe, expect, it } from 'vitest'
import type { ServerMessage, SessionConfig } from '../shared/protocol.ts'
import { encodeAudioFrame } from '../shared/protocol.ts'
import { DEMO_SCRIPT, playDemo } from './demo.ts'
import { MockLlm } from './llm/mock.ts'
import { MockSttProvider } from './stt/mock.ts'
import type { LlmTextRequest } from './llm/types.ts'
import { MeetingSession } from './session.ts'
import type { SttProvider, SttResult, SttStreamOptions } from './stt/types.ts'

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
    metricsIntervalMs: 0,
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
      metricsIntervalMs: 0,
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

describe('MeetingSession phase 1', () => {
  const docs = [{ id: 'file_abc', name: '报价单.pdf', kind: 'pdf' as const, sizeBytes: 1000 }]

  it('asks for a reply in the other side’s language with a translation for the user', async () => {
    const { session, llm, messages } = setup()
    session.handleMessage({ type: 'start', config: { ...baseConfig, translate: false } })
    session.onSttResult('remote', { ...result('What is included in the enterprise plan?'), language: 'en' })
    await session.idle()
    expect(llm.requests[0].prompt).toContain('<reply_language>English</reply_language>')
    expect(llm.requests[0].system).toContain('↳')
    const start = messages.find((m) => m.type === 'suggestion.start')
    expect(start?.type === 'suggestion.start' && start.trigger.replyLanguage).toBe('en')
  })

  it('uses speaker names in copilot prompts', async () => {
    const { session, llm } = setup()
    session.handleMessage({ type: 'start', config: { ...baseConfig, translate: false } })
    session.handleMessage({ type: 'speakers', names: { S1: '王总', bad: 'x', S2: '<script>' } })
    session.onSttResult('remote', result('价格还能再优惠吗？', true, 'S1'))
    await session.idle()
    expect(llm.requests[0].prompt).toContain('对方(S1:王总): 价格还能再优惠吗？')
  })

  it('sends documents to the copilot and summary but not the translator', async () => {
    const { session, llm } = setup()
    session.handleMessage({ type: 'start', config: { ...baseConfig, documents: docs } })
    session.onSttResult('remote', result('What does the enterprise plan include?'))
    await session.idle()
    session.handleMessage({ type: 'summary' })
    await new Promise((r) => setTimeout(r, 50))
    const byRole = (tag: string) => llm.requests.filter((r) => r.system.includes(tag))
    expect(byRole('[role:translator]')[0].documents).toBeUndefined()
    expect(byRole('[role:copilot]')[0].documents).toEqual(docs)
    expect(byRole('[role:copilot]')[0].system).toContain('来源')
    expect(byRole('[role:summarizer]')[0].documents).toEqual(docs)
  })

  it('drops malformed document refs from the client', () => {
    const { session, llm } = setup()
    session.handleMessage({
      type: 'start',
      config: { ...baseConfig, translate: false, documents: [{ id: '../etc', name: 'x', kind: 'pdf', sizeBytes: 1 }, ...docs] },
    })
    session.handleMessage({ type: 'ask', question: 'hi' })
    return session.idle().then(() => expect(llm.requests[0].documents).toEqual(docs))
  })

  it('tracks latency, usage, skips and feedback in metrics', async () => {
    let clock = 1_000
    const messages: ServerMessage[] = []
    const llm = new MockLlm((r) => (r.system.includes('[role:copilot]') && r.prompt.includes('weather') ? 'SKIP' : '**建议回应**：OK'))
    const session = new MeetingSession({
      send: (m) => messages.push(m),
      stt: new FakeStt(),
      llm,
      models: { copilot: 'claude-opus-5-5', translate: 'claude-opus-5-5', summary: 'claude-opus-5-5' },
      metricsIntervalMs: 0,
      now: () => clock,
    })
    session.handleMessage({ type: 'start', config: baseConfig })
    session.onSttResult('remote', result('What is the price?'))
    await session.idle()
    clock += 7_000
    session.onSttResult('remote', result('How is the weather?'))
    await session.idle()
    const shown = messages.find((m) => m.type === 'suggestion.start')
    session.handleMessage({ type: 'feedback', suggestionId: shown?.type === 'suggestion.start' ? shown.id : '', rating: 'up' })

    const m = session.metricsSnapshot()
    expect(m.finalSegments.remote).toBe(2)
    expect(m.suggestions).toMatchObject({ triggered: 2, shown: 1, skipped: 1, up: 1, down: 0 })
    expect(m.llm.copilot.calls).toBe(2)
    expect(m.llm.translate.calls).toBe(2)
    expect(m.llm.copilot.inputTokens).toBeGreaterThan(0)
    expect(m.costUsd).toBeGreaterThan(0)
    expect(m.translationLatencyMs.count).toBe(2)
    expect(messages.some((x) => x.type === 'metrics')).toBe(true)
  })

  it('maps STT timestamps from gated audio back to meeting time', () => {
    let clock = 0
    let emit: ((r: SttResult) => void) | undefined
    const stt: SttProvider = {
      name: 'fake',
      open: (options) => {
        emit = (r) => options.onResult(r)
        return { write: () => {}, close: async () => {} }
      },
    }
    const messages: ServerMessage[] = []
    const session = new MeetingSession({
      send: (m) => messages.push(m),
      stt,
      llm: new MockLlm(),
      models: { copilot: 'c', translate: 't', summary: 's' },
      metricsIntervalMs: 0,
      now: () => clock,
    })
    session.handleMessage({ type: 'start', config: { ...baseConfig, translate: false, copilot: { enabled: false, autoTrigger: false } } })
    const frame = () => new Uint8Array(encodeAudioFrame('remote', new Int16Array(1600)))
    clock = 2_000
    session.handleAudio(frame()) // provider 0–100 ms = meeting 2000–2100
    clock = 30_000
    session.handleAudio(frame()) // provider 100–200 ms = meeting 30000–30100 (VAD skipped the silence)
    emit!({ text: 'later', isFinal: true, startMs: 120, endMs: 180 })
    const seg = messages.find((m) => m.type === 'transcript')
    expect(seg?.type === 'transcript' && [seg.segment.startMs, seg.segment.endMs]).toEqual([30_020, 30_080])
    expect(session.metricsSnapshot().audioSentSeconds.remote).toBe(0.2)
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
