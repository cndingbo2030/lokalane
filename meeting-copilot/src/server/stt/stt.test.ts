import { EventEmitter } from 'node:events'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket, { WebSocketServer } from 'ws'
import { DeepgramAccumulator, deepgramLanguage, DeepgramProvider } from './deepgram.ts'
import { MockSttProvider } from './mock.ts'
import { watchLiveness } from './socket.ts'
import { PauseFinalizer, SonioxAccumulator, SonioxProvider } from './soniox.ts'
import type { SttCloseInfo, SttResult, SttStreamOptions } from './types.ts'

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

  it('flushes on finished', () => {
    const acc = new SonioxAccumulator()
    acc.handle({ tokens: [tok('done', true)] })
    expect(acc.handle({ tokens: [tok('<fin>', true)], finished: true })).toMatchObject([{ text: 'done', isFinal: true }])
    expect(acc.hasOpenUtterance).toBe(false)
  })

  it('closes the utterance on <fin> (a finalize request completed) and tracks whether one is open', () => {
    const acc = new SonioxAccumulator()
    expect(acc.hasOpenUtterance).toBe(false)
    acc.handle({ tokens: [tok('Is it', false)] })
    expect(acc.hasOpenUtterance).toBe(true)
    const out = acc.handle({ tokens: [tok('Is it paid up?', true, { end_ms: 900 }), tok('<fin>', true), tok('So', false)] })
    expect(out).toEqual([
      expect.objectContaining({ text: 'Is it paid up?', isFinal: true, endMs: 900 }),
      expect.objectContaining({ text: 'So', isFinal: false }),
    ])
    expect(acc.hasOpenUtterance).toBe(true)
    expect(acc.handle({ tokens: [tok('So.', true), tok('<end>', true)] })).toMatchObject([{ text: 'So.', isFinal: true }])
    expect(acc.hasOpenUtterance).toBe(false)
  })
})

describe('PauseFinalizer', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  function setup(open: { value: boolean }) {
    vi.useFakeTimers()
    const finalize = vi.fn()
    return { finalize, finalizer: new PauseFinalizer(500, () => open.value, finalize) }
  }

  it('finalizes once per pause in the audio', () => {
    const { finalize, finalizer } = setup({ value: true })
    finalizer.onAudio()
    vi.advanceTimersByTime(400)
    finalizer.onAudio() // still talking: the pause starts over
    vi.advanceTimersByTime(499)
    expect(finalize).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(finalize).toHaveBeenCalledTimes(1)

    finalizer.onResults() // more results during the same pause
    vi.advanceTimersByTime(5_000)
    expect(finalize).toHaveBeenCalledTimes(1)

    finalizer.onAudio() // the next sentence
    vi.advanceTimersByTime(500)
    expect(finalize).toHaveBeenCalledTimes(2)
    finalizer.stop()
  })

  it('waits for the last words when they are recognized after the pause began', () => {
    const open = { value: false }
    const { finalize, finalizer } = setup(open)
    finalizer.onAudio()
    vi.advanceTimersByTime(500)
    expect(finalize).not.toHaveBeenCalled() // nothing open yet
    open.value = true
    finalizer.onResults()
    expect(finalize).toHaveBeenCalledTimes(1)
  })

  it('does nothing once stopped', () => {
    const { finalize, finalizer } = setup({ value: true })
    finalizer.onAudio()
    finalizer.stop()
    vi.advanceTimersByTime(1_000)
    expect(finalize).not.toHaveBeenCalled()
  })
})

/** A local stand-in for the Soniox WebSocket API: records what the provider sends and lets the test answer. */
async function fakeSoniox() {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise<void>((resolve) => server.once('listening', () => resolve()))
  const configs: Array<Record<string, unknown>> = []
  const controls: Array<Record<string, unknown> | ''> = []
  const audio = { frames: 0 }
  const authorization: Array<string | undefined> = []
  let client: WebSocket | undefined
  server.on('connection', (socket, request) => {
    authorization.push(request.headers.authorization)
    client = socket
    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        audio.frames++
        return
      }
      const text = data.toString()
      if (text === '') {
        // End of stream, as Soniox does it: a last message, then close.
        controls.push('')
        socket.send(JSON.stringify({ tokens: [], finished: true }))
        socket.close()
        return
      }
      const message = JSON.parse(text) as Record<string, unknown>
      if ('type' in message) controls.push(message)
      else configs.push(message)
    })
  })
  return {
    url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`,
    configs,
    controls,
    audio,
    authorization,
    send: (message: unknown) => client!.send(JSON.stringify(message)),
    /** The server ends the connection on its own, as on a server error or restart. */
    drop: () => client!.close(1011, 'internal error'),
    /** Soniox's error flow: an error response, then the connection closes. */
    fail: (status: number, message: string) => {
      client!.send(JSON.stringify({ error_code: status, error_type: 'request_error', error_message: message }))
      client!.close()
    },
    close: async () => {
      for (const socket of server.clients) socket.terminate()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

describe('SonioxProvider against a fake Soniox server', () => {
  const frame = new Uint8Array(3_200) // 100 ms of 16 kHz PCM16
  const streamOptions = (results: SttResult[]): SttStreamOptions => ({
    source: 'remote',
    languages: ['en'],
    diarize: true,
    onResult: (r) => results.push(r),
    onError: () => {},
  })

  it('asks Soniox to finalize when the audio pauses mid-utterance, then emits the final', async () => {
    const soniox = await fakeSoniox()
    const results: SttResult[] = []
    const stream = new SonioxProvider('key', 'stt-rt-v5', { url: soniox.url, finalizeAfterGapMs: 20 }).open(streamOptions(results))
    stream.write(frame)
    await vi.waitFor(() => expect(soniox.audio.frames).toBe(1))
    expect(soniox.configs[0]).toMatchObject({ model: 'stt-rt-v5', enable_endpoint_detection: true })
    expect(soniox.configs[0]).not.toHaveProperty('max_endpoint_delay_ms')
    // The key goes with the connection, not in the (deprecated) start-request field.
    expect(soniox.authorization).toEqual(['Bearer key'])
    expect(soniox.configs[0]).not.toHaveProperty('api_key')

    // The VAD stopped sending; Soniox still holds the sentence open.
    soniox.send({ tokens: [{ text: 'Is it paid', is_final: false, start_ms: 0, end_ms: 400 }] })
    await vi.waitFor(() => expect(soniox.controls).toEqual([{ type: 'finalize' }]))
    soniox.send({ tokens: [{ text: 'Is it paid up?', is_final: true, start_ms: 0, end_ms: 900 }, { text: '<fin>', is_final: true }] })
    await vi.waitFor(() => expect(results.at(-1)).toMatchObject({ text: 'Is it paid up?', isFinal: true }))

    await stream.close()
    // The end-of-stream frame is ordered after everything else the provider sent: one finalize, no repeats.
    expect(soniox.controls).toEqual([{ type: 'finalize' }, ''])
    await soniox.close()
  })

  it('sends max_endpoint_delay_ms only when configured', async () => {
    const soniox = await fakeSoniox()
    const stream = new SonioxProvider('key', 'stt-rt-v5', { url: soniox.url, maxEndpointDelayMs: 1_000 }).open(streamOptions([]))
    stream.write(frame)
    await vi.waitFor(() => expect(soniox.configs).toHaveLength(1))
    expect(soniox.configs[0]).toMatchObject({ max_endpoint_delay_ms: 1_000 })
    await stream.close()
    await soniox.close()
  })

  it('reports a dropped stream, marks a bad key as fatal, and stays quiet when closed on purpose', async () => {
    const soniox = await fakeSoniox()
    const closes: SttCloseInfo[] = []
    const errors: string[] = []
    const open = () =>
      new SonioxProvider('key', 'stt-rt-v5', { url: soniox.url }).open({
        ...streamOptions([]),
        onError: (e) => errors.push(e.message),
        onClose: (info) => closes.push(info),
      })

    open().write(frame)
    await vi.waitFor(() => expect(soniox.audio.frames).toBe(1))
    soniox.drop()
    await vi.waitFor(() => expect(closes).toHaveLength(1))
    expect(closes[0]).toEqual({ fatal: false, detail: expect.stringContaining('1011') })

    open().write(frame)
    await vi.waitFor(() => expect(soniox.audio.frames).toBe(2))
    soniox.fail(401, 'Invalid API key.')
    await vi.waitFor(() => expect(closes).toHaveLength(2))
    expect(closes[1]).toEqual({ fatal: true, detail: expect.stringContaining('错误 401') })
    expect(errors).toContainEqual(expect.stringContaining('Invalid API key.'))

    const ours = open()
    ours.write(frame)
    await vi.waitFor(() => expect(soniox.audio.frames).toBe(3))
    await ours.close()
    expect(closes).toHaveLength(2)
    await soniox.close()
  })
})

describe('DeepgramProvider', () => {
  it('ends a rejected handshake with one clear error instead of hanging in CONNECTING', async () => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0, verifyClient: (_info, done) => done(false, 401, 'Unauthorized') })
    await new Promise<void>((resolve) => server.once('listening', () => resolve()))
    const closes: SttCloseInfo[] = []
    const errors: string[] = []
    const stream = new DeepgramProvider('bad-key', 'nova-3', { url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}/v1/listen` }).open({
      source: 'remote',
      languages: ['en'],
      diarize: true,
      onResult: () => {},
      onError: (e) => errors.push(e.message),
      onClose: (info) => closes.push(info),
    })
    stream.write(new Uint8Array(3_200))
    await vi.waitFor(() => expect(closes).toEqual([{ fatal: true, detail: expect.stringContaining('错误 401') }]))
    expect(errors).toEqual([expect.stringContaining('HTTP 401')])
    await stream.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
})

describe('watchLiveness', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  const fakeSocket = () => Object.assign(new EventEmitter(), { readyState: WebSocket.OPEN, ping: vi.fn(), terminate: vi.fn() })

  it('terminates a connection that stops answering pings', () => {
    vi.useFakeTimers()
    const socket = fakeSocket()
    const stop = watchLiveness(socket as unknown as WebSocket, 1_000)
    vi.advanceTimersByTime(1_000)
    expect(socket.ping).toHaveBeenCalledTimes(1)
    socket.emit('pong')
    vi.advanceTimersByTime(2_000) // two more pings, no answer
    expect(socket.terminate).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1_000)
    expect(socket.terminate).toHaveBeenCalledTimes(1)
    stop()
  })

  it('treats any message as a sign of life', () => {
    vi.useFakeTimers()
    const socket = fakeSocket()
    const stop = watchLiveness(socket as unknown as WebSocket, 1_000)
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(1_000)
      socket.emit('message', Buffer.from('{}'), false)
    }
    expect(socket.terminate).not.toHaveBeenCalled()
    stop()
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
