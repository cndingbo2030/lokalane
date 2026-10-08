import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { loadConfig } from './config.ts'
import { MockLlm } from './llm/mock.ts'
import type { LlmClient } from './llm/types.ts'
import {
  anthropicKeyFormat,
  checkClaude,
  checkStt,
  configChecks,
  envFile,
  explainClaudeError,
  nodeVersion,
  runningServer,
  shellOverrides,
  summarize,
} from './preflight.ts'
import type { SttProvider, SttStreamOptions } from './stt/types.ts'

describe('preflight: local checks', () => {
  it('needs Node 22+ and a .env file', () => {
    expect(nodeVersion('26.8.2').status).toBe('ok')
    expect(nodeVersion('20.11.0').status).toBe('fail')
    expect(envFile(null).status).toBe('fail')
    expect(envFile('PORT=8790').status).toBe('ok')
  })

  it('finds shell variables that would override .env, but not the official API address, and prints no values', () => {
    const dotenv = 'ANTHROPIC_API_KEY=sk-new\nSONIOX_API_KEY=abc123\nPORT=8790\n'
    expect(shellOverrides(dotenv, { ANTHROPIC_BASE_URL: 'https://api.anthropic.com', HOME: '/Users/x' })).toEqual([
      expect.objectContaining({ status: 'ok', detail: expect.stringContaining('官方地址') }),
    ])

    const issues = shellOverrides(dotenv, {
      ANTHROPIC_API_KEY: 'sk-old',
      SONIOX_API_KEY: 'abc123', // same as .env: harmless
      DEEPGRAM_API_KEY: 'dg-key',
      ANTHROPIC_BASE_URL: 'https://proxy.example.com/v1',
    })
    expect(issues.map((r) => [r.status, r.title])).toEqual([
      ['fail', expect.stringContaining('proxy.example.com')],
      ['fail', expect.stringContaining('ANTHROPIC_API_KEY')],
      ['warn', expect.stringContaining('DEEPGRAM_API_KEY')],
    ])
    expect(JSON.stringify(issues)).not.toMatch(/sk-old|sk-new|abc123|dg-key/)
  })

  it('flags a PORT in .env that the web dev server would not see', () => {
    expect(shellOverrides('PORT=9000', {})).toEqual([expect.objectContaining({ status: 'fail', title: expect.stringContaining('PORT=9000') })])
    expect(shellOverrides('PORT=9000', { PORT: '9000' })).toEqual([expect.objectContaining({ status: 'ok' })])
  })

  it('explains an STT_PROVIDER whose key is empty, which would silently fall back to mock', () => {
    const env = { STT_PROVIDER: 'soniox', ANTHROPIC_API_KEY: 'k' }
    const results = configChecks(loadConfig(env), env)
    expect(results[0]).toMatchObject({ status: 'fail', detail: expect.stringContaining('SONIOX_API_KEY') })
    expect(results.at(-1)).toEqual({ status: 'ok', title: 'Claude：claude-opus-5-5' })

    const ready = { SONIOX_API_KEY: 's', ANTHROPIC_API_KEY: 'k', SONIOX_MAX_ENDPOINT_DELAY_MS: '1000' }
    expect(configChecks(loadConfig(ready), ready)[0]).toEqual({ status: 'ok', title: '语音识别：soniox（stt-rt-v5，端点上限 1000 ms）' })
    const typo = { SONIOX_API_KEY: 's', ANTHROPIC_API_KEY: 'k', SONIOX_MAX_ENDPOINT_DELAY_MS: '100' }
    expect(configChecks(loadConfig(typo), typo)).toContainEqual(expect.objectContaining({ status: 'warn', title: expect.stringContaining('无效') }))
  })
})

describe('preflight: a server already running', () => {
  async function serve(health: unknown) {
    const server = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(health))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const stop = () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
    return { port: (server.address() as AddressInfo).port, stop }
  }

  it('spots one still in mock mode (started before the keys were filled in)', async () => {
    const stale = await serve({ ok: true, stt: 'mock', llm: 'anthropic' })
    expect(await runningServer(stale.port)).toMatchObject({ status: 'fail', detail: expect.stringContaining('Ctrl+C') })
    await stale.stop()

    const ready = await serve({ ok: true, stt: 'soniox', llm: 'anthropic' })
    expect(await runningServer(ready.port)).toMatchObject({ status: 'ok', title: expect.stringContaining('STT soniox，LLM anthropic') })
    await ready.stop()
  })

  it('spots one still running with the settings from before .env was edited', async () => {
    const models = { copilot: 'claude-opus-5-5', translate: 'claude-sonnet-5-5', summary: 'claude-opus-5-5' }
    const stale = await serve({ ok: true, stt: 'soniox', llm: 'anthropic', models: { ...models, translate: 'claude-opus-5-5' }, sonioxMaxEndpointDelayMs: null })
    const result = await runningServer(stale.port, { models, sonioxMaxEndpointDelayMs: 1_000 })
    expect(result).toMatchObject({ status: 'fail', detail: expect.stringContaining('Ctrl+C') })
    expect(result.title).toContain('翻译模型是 claude-opus-5-5，.env 里是 claude-sonnet-5-5')
    expect(result.title).toContain('断句上限是 默认，.env 里是 1000')
    await stale.stop()

    // A server from before /health reported the endpoint delay: only the models are compared.
    const older = await serve({ ok: true, stt: 'soniox', llm: 'anthropic', models })
    expect(await runningServer(older.port, { models, sonioxMaxEndpointDelayMs: 1_000 })).toMatchObject({ status: 'ok' })
    await older.stop()
  })

  it('reports a free port', async () => {
    const { port, stop } = await serve({})
    await stop()
    expect(await runningServer(port)).toMatchObject({ status: 'ok', title: expect.stringContaining('空闲') })
  })
})

describe('preflight: Claude', () => {
  const failing = (error: Error): LlmClient => ({
    name: 'anthropic',
    streamText: () => ({ [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(error) }) }),
    completeJson: () => Promise.reject(error),
    prewarm: () => Promise.reject(error),
  })
  const apiError = (status: number, message: string) => Object.assign(new Error(message), { status })

  it('passes with a working client and reports the time to the first token', async () => {
    let clock = 0
    const result = await checkClaude(new MockLlm(), 'claude-opus-5-5', () => (clock += 400))
    expect(result).toEqual({ status: 'ok', title: 'Claude claude-opus-5-5：正常（首字 0.4 秒）' })
  })

  it('warns when the first token is slow', async () => {
    let clock = 0
    expect(await checkClaude(new MockLlm(), 'm', () => (clock += 3_500))).toMatchObject({ status: 'warn', detail: expect.stringContaining('claude-sonnet-5-5') })
  })

  it('catches paste slips in the key before any request, showing only the generic start', () => {
    expect(anthropicKeyFormat(undefined)).toBeNull()
    expect(anthropicKeyFormat('sk-ant-usr-17sAbc_def-FwAA')).toBeNull()
    const extraLetter = anthropicKeyFormat('ssk-ant-usr-17sAbcSECRETdefFwAA')
    expect(extraLetter).toMatchObject({ status: 'fail', detail: expect.stringContaining('「ssk-ant…」') })
    expect(JSON.stringify(extraLetter)).not.toContain('SECRET')
    expect(anthropicKeyFormat('"sk-ant-usr-17s"')).toMatchObject({ status: 'fail', detail: expect.stringContaining('「?sk-ant…」') })
  })

  it('explains an organization key that is not scoped to a workspace', () => {
    const error = apiError(400, 'This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header')
    expect(explainClaudeError(error)).toMatchObject({ title: '这是组织级密钥，没有绑定工作区', detail: expect.stringContaining('Default') })
  })

  it('turns API errors into a plain explanation', async () => {
    expect(await checkClaude(failing(apiError(401, 'invalid x-api-key')), 'm')).toMatchObject({ status: 'fail', title: 'Claude m：密钥无效' })
    expect(explainClaudeError(apiError(404, 'model: claude-x')).title).toBe('模型不存在或账户无权使用')
    expect(explainClaudeError(apiError(400, 'Your credit balance is too low to access the Anthropic API.')).title).toBe('账户余额不足')
    expect(explainClaudeError(apiError(529, 'Overloaded')).title).toContain('繁忙')
    expect(explainClaudeError(new TypeError('fetch failed')).title).toBe('连不上 Anthropic')
  })
})

describe('preflight: speech to text', () => {
  const sample = { frames: [new Uint8Array(3_200), new Uint8Array(3_200)], text: 'Hello, this is the meeting copilot preflight check.' }
  /** A provider that reports whatever `atEnd` does when the stream is closed. */
  const provider = (atEnd: (options: SttStreamOptions) => void): SttProvider => ({
    name: 'soniox',
    open: (options) => ({ write: () => {}, close: async () => atEnd(options) }),
  })
  const final = (text: string) => ({ text, isFinal: true, startMs: 0, endMs: 3_000 })

  it('passes when the spoken words come back', async () => {
    const result = await checkStt(provider((o) => o.onResult(final('Hello, this is the meeting co-pilot pre-flight check.'))), sample, 0)
    expect(result).toEqual({ status: 'ok', title: 'soniox：识别正常 —「Hello, this is the meeting co-pilot pre-flight check.」' })
  })

  it('warns when it connects but hears something else', async () => {
    expect(await checkStt(provider((o) => o.onResult(final('Something else entirely'))), sample, 0)).toMatchObject({ status: 'warn' })
  })

  it('fails with a plain explanation for a bad key', async () => {
    const rejected = provider((o) => {
      o.onError(new Error('Soniox 401: Invalid API key.'))
      o.onClose?.({ detail: 'Soniox 断开了连接（错误 401）', fatal: true })
    })
    expect(await checkStt(rejected, sample, 0)).toMatchObject({ status: 'fail', title: expect.stringContaining('密钥无效') })
  })

  it('still checks the connection and key without a speech sample', async () => {
    expect(await checkStt(provider(() => {}), null, 0)).toMatchObject({ status: 'ok', title: 'soniox：连接和密钥正常' })
  })

  it('counts what needs fixing', () => {
    expect(summarize([{ status: 'ok', title: 'a' }, { status: 'warn', title: 'b' }, { status: 'fail', title: 'c' }])).toEqual({ failed: 1, warned: 1 })
  })
})
