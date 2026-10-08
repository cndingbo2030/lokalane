import { parseEnv } from 'node:util'
import type { ServerConfig } from './config.ts'
import type { LlmClient } from './llm/types.ts'
import type { SttProvider } from './stt/types.ts'

/**
 * Pre-meeting checks behind `npm run preflight`: everything that can be verified
 * without a meeting, in a few seconds. The startup log and /health only show
 * that a key is filled in; these make real (tiny) calls to show that it works.
 */

export type CheckStatus = 'ok' | 'warn' | 'fail'

export interface CheckResult {
  status: CheckStatus
  title: string
  /** What it means or what to do, shown under the title. */
  detail?: string
}

const OFFICIAL_ANTHROPIC_URL = 'https://api.anthropic.com'
/** Variables the server reads; a value set in the shell wins over .env (process.loadEnvFile never overrides). */
const SERVER_VARIABLE = /^(ANTHROPIC_\w+|SONIOX_\w+|DEEPGRAM_\w+|STT_PROVIDER|COPILOT_MODEL|TRANSLATE_MODEL|SUMMARY_MODEL|PORT)$/

export function nodeVersion(version = process.versions.node): CheckResult {
  return Number(version.split('.')[0]) >= 22
    ? { status: 'ok', title: `Node v${version}` }
    : { status: 'fail', title: `Node v${version} 版本过低`, detail: '请安装 Node.js 22 或更高版本：https://nodejs.org/' }
}

export function envFile(text: string | null): CheckResult {
  return text === null
    ? { status: 'fail', title: '没有找到 .env', detail: '在 meeting-copilot 目录执行 cp .env.example .env，再填 SONIOX_API_KEY 和 ANTHROPIC_API_KEY' }
    : { status: 'ok', title: '.env 已找到' }
}

/** Shell variables that silently win over .env. `shell` is the environment before .env was loaded. */
export function shellOverrides(dotenvText: string | null, shell: NodeJS.ProcessEnv): CheckResult[] {
  const file = (dotenvText === null ? {} : parseEnv(dotenvText)) as Record<string, string | undefined>
  const results: CheckResult[] = []
  const overriding: string[] = []
  const shellOnly: string[] = []
  let officialBaseUrl = false

  for (const [name, value] of Object.entries(shell)) {
    if (!value || !SERVER_VARIABLE.test(name)) continue
    if (name === 'ANTHROPIC_BASE_URL') {
      if (value.replace(/\/+$/, '') === OFFICIAL_ANTHROPIC_URL) officialBaseUrl = true
      else {
        results.push({
          status: 'fail',
          title: `终端里的 ANTHROPIC_BASE_URL 会把 Claude 请求发到 ${originOf(value)}`,
          detail: '执行 unset ANTHROPIC_BASE_URL，并检查 ~/.zshrc 和 launchctl getenv ANTHROPIC_BASE_URL',
        })
      }
      continue
    }
    if (file[name] === value) continue
    if (file[name]) overriding.push(name)
    else shellOnly.push(name)
  }

  if (overriding.length > 0) {
    results.push({
      status: 'fail',
      title: `终端里的 ${overriding.join('、')} 会覆盖 .env 里填的值`,
      detail: `执行 unset ${overriding.join(' ')}，并检查 ~/.zshrc；否则 .env 的修改不会生效`,
    })
  }
  if (shellOnly.length > 0) {
    results.push({
      status: 'warn',
      title: `正在使用终端里的 ${shellOnly.join('、')}（.env 里没填）`,
      detail: '如果这是你的本意可以忽略；否则执行 unset 后在 .env 里填写',
    })
  }
  const filePort = file.PORT
  if (filePort && filePort !== '8790' && !shell.PORT) {
    results.push({
      status: 'fail',
      title: `.env 里 PORT=${filePort}，但网页开发服务只认终端里的 PORT`,
      detail: '把 .env 的 PORT 改回 8790；要换端口就用 PORT=xxxx npm run dev 启动',
    })
  }
  if (results.length === 0) {
    results.push({
      status: 'ok',
      title: '终端环境变量不会覆盖 .env',
      detail: officialBaseUrl ? '终端里的 ANTHROPIC_BASE_URL 是官方地址，无害' : undefined,
    })
  }
  return results
}

export function configChecks(config: ServerConfig, env: NodeJS.ProcessEnv): CheckResult[] {
  const results: CheckResult[] = []
  const requested = (env.STT_PROVIDER ?? '').toLowerCase()
  if (config.sttProvider === 'mock') {
    const keyName = requested === 'deepgram' ? 'DEEPGRAM_API_KEY' : 'SONIOX_API_KEY'
    results.push({
      status: 'fail',
      title: '语音识别没有配置，开会时只会显示「检测到语音」',
      detail:
        requested === 'soniox' || requested === 'deepgram'
          ? `STT_PROVIDER=${requested}，但 ${keyName} 是空的（会悄悄退回模拟识别）：在 .env 里填上`
          : '在 .env 里填 SONIOX_API_KEY',
    })
  } else {
    const model = config.sttProvider === 'soniox' ? config.sonioxModel : config.deepgramModel
    const delay = config.sttProvider === 'soniox' && config.sonioxMaxEndpointDelayMs ? `，端点上限 ${config.sonioxMaxEndpointDelayMs} ms` : ''
    results.push({ status: 'ok', title: `语音识别：${config.sttProvider}（${model}${delay}）` })
  }
  if (env.SONIOX_MAX_ENDPOINT_DELAY_MS && !config.sonioxMaxEndpointDelayMs) {
    results.push({
      status: 'warn',
      title: `SONIOX_MAX_ENDPOINT_DELAY_MS=${env.SONIOX_MAX_ENDPOINT_DELAY_MS} 无效，已忽略`,
      detail: '只能填 500–3000 之间的整数，或者留空',
    })
  }
  if (!config.anthropicConfigured) {
    results.push({ status: 'fail', title: 'Claude 没有配置，开会时只会显示模拟翻译和建议', detail: '在 .env 里填 ANTHROPIC_API_KEY' })
  } else {
    const { copilot, translate, summary } = config.models
    const models = copilot === translate && translate === summary ? copilot : `建议 ${copilot}／翻译 ${translate}／纪要 ${summary}`
    results.push({ status: 'ok', title: `Claude：${models}` })
  }
  return results
}

/**
 * What a server already running on `port` loaded. One started before the keys
 * were filled in keeps running in mock mode until it is restarted.
 */
export async function runningServer(port: number): Promise<CheckResult> {
  let health: { stt?: unknown; llm?: unknown }
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2_000) })
    health = (await response.json()) as typeof health
  } catch (error) {
    if (connectionRefused(error)) return { status: 'ok', title: `${port} 端口空闲（服务还没启动）` }
    return { status: 'warn', title: `${port} 端口有程序在用，但不像本服务`, detail: `用 lsof -nP -iTCP:${port} -sTCP:LISTEN 查是哪个程序，必要时 kill 掉` }
  }
  if (health.stt === 'mock' || health.llm === 'mock') {
    return {
      status: 'fail',
      title: `${port} 端口上正在运行的服务是模拟模式（STT ${String(health.stt)}，LLM ${String(health.llm)}）`,
      detail: '它是在填好密钥之前启动的：在运行它的终端按 Ctrl+C，再重新 npm run dev',
    }
  }
  return { status: 'ok', title: `${port} 端口上的服务已在运行：STT ${String(health.stt)}，LLM ${String(health.llm)}` }
}

/** A tiny real request through the app's own client: same headers, beta and parameters as in a meeting. */
export async function checkClaude(llm: LlmClient, model: string, now: () => number = () => performance.now()): Promise<CheckResult> {
  const started = now()
  let firstTokenMs: number | undefined
  try {
    // The translator's own limits (maxTokens 1024, effort low), so a request the meeting would send is what gets tested.
    const stream = llm.streamText({ model, system: 'Connectivity check. Reply with exactly: OK', prompt: 'OK?', maxTokens: 1024, effort: 'low' })
    for await (const delta of stream) if (delta) firstTokenMs ??= now() - started
  } catch (error) {
    const { title, detail } = explainClaudeError(error)
    return { status: 'fail', title: `Claude ${model}：${title}`, detail }
  }
  const seconds = (firstTokenMs ?? now() - started) / 1000
  return seconds > 3
    ? {
        status: 'warn',
        title: `Claude ${model}：能用，但首字要 ${seconds.toFixed(1)} 秒`,
        detail: '实时翻译可能偏慢；可以在 .env 里加 TRANSLATE_MODEL=claude-sonnet-5-5，然后重启',
      }
    : { status: 'ok', title: `Claude ${model}：正常（首字 ${seconds.toFixed(1)} 秒）` }
}

/**
 * Catches the commonest paste slips before any request is made (an extra or missing
 * leading character, quotes, spaces). Only the generic prefix is ever shown.
 */
export function anthropicKeyFormat(key: string | undefined): CheckResult | null {
  if (!key) return null
  if (/^sk-ant-[A-Za-z0-9_-]+$/.test(key)) return null
  const start = key.slice(0, 7).replace(/[^A-Za-z0-9_-]/g, '?')
  return {
    status: 'fail',
    title: 'ANTHROPIC_API_KEY 的格式不对',
    detail: `应该以 sk-ant- 开头，只含字母、数字、- 和 _；现在的开头是「${start}…」。重新从 Claude Console 复制，不要加引号或空格`,
  }
}

export function explainClaudeError(error: unknown): { title: string; detail: string } {
  const status = typeof error === 'object' && error !== null && 'status' in error ? Number((error as { status: unknown }).status) : undefined
  const message = error instanceof Error ? error.message : String(error)
  if (/not scoped to a workspace/i.test(message)) {
    return {
      title: '这是组织级密钥，没有绑定工作区',
      detail: '到 Claude Console 的 API keys 页面，换一把 Scope 为某个工作区（例如 Default）的密钥',
    }
  }
  if (status === 401) {
    return {
      title: '密钥无效',
      detail: `检查 .env 里的 ANTHROPIC_API_KEY 是否完整（开头是 sk-ant-）、没有多余字符，以及是否已在 Claude Console 被删除或过期。服务器返回：${message.slice(0, 160)}`,
    }
  }
  if (status === 403) return { title: '没有权限', detail: '检查这个 API 密钥所属的组织／工作区是否有权使用该模型' }
  if (status === 404) return { title: '模型不存在或账户无权使用', detail: '可以在 .env 里把 COPILOT_MODEL、TRANSLATE_MODEL、SUMMARY_MODEL 改为 claude-sonnet-5-5，然后重启' }
  if (/credit balance|billing/i.test(message)) return { title: '账户余额不足', detail: '到 Anthropic Console 的 Billing 页面充值' }
  if (status === 429) return { title: '被限流或额度已用完', detail: '稍后重试；一直这样的话，到 Anthropic Console 检查用量上限' }
  if (status === 529 || /overloaded/i.test(message)) return { title: '服务繁忙（overloaded）', detail: '稍后再试一次' }
  if (status !== undefined && status >= 500) return { title: `服务端错误（${status}）`, detail: '稍后再试一次' }
  if (status === 400) return { title: '请求被拒绝', detail: message.slice(0, 200) }
  return { title: '连不上 Anthropic', detail: `${message.slice(0, 160)}。检查网络、代理和 ANTHROPIC_BASE_URL` }
}

/** 16 kHz mono PCM16 in 100 ms frames, and the words that were spoken. */
export interface SpeechSample {
  frames: Uint8Array[]
  text: string
}

/**
 * Streams a short spoken sentence through the app's own STT adapter, paced like a
 * meeting, and checks the words come back. Without a sample (no text-to-speech on
 * this machine) it streams a second of silence: that still proves the connection
 * and the key.
 */
export async function checkStt(provider: SttProvider, sample: SpeechSample | null, frameMs = 100): Promise<CheckResult> {
  const finals: string[] = []
  const errors: string[] = []
  const stream = provider.open({
    source: 'remote',
    languages: ['en'],
    diarize: false,
    onResult: (result) => {
      if (result.isFinal) finals.push(result.text)
    },
    onError: (error) => errors.push(error.message),
    onClose: (info) => errors.push(info.detail),
  })
  for (const frame of sample?.frames ?? Array.from({ length: 10 }, () => new Uint8Array(3_200))) {
    stream.write(frame)
    if (frameMs > 0) await new Promise((resolve) => setTimeout(resolve, frameMs))
  }
  await stream.close()

  if (errors.length > 0) return { status: 'fail', title: `${provider.name}：${explainSttError(errors.join('；'))}`, detail: errors.join('；').slice(0, 300) }
  if (!sample) return { status: 'ok', title: `${provider.name}：连接和密钥正常`, detail: '本机没有 say 命令，没有测试识别效果' }
  const heard = finals.join(' ').trim()
  const expected = words(sample.text)
  const recognized = new Set(words(heard))
  if (expected.filter((w) => recognized.has(w)).length * 2 >= expected.length) {
    return { status: 'ok', title: `${provider.name}：识别正常 —「${heard}」` }
  }
  return { status: 'warn', title: `${provider.name}：能连上，但识别结果不对`, detail: `期望「${sample.text}」，实际「${heard || '（空）'}」` }
}

function explainSttError(text: string): string {
  if (/\b401\b|unauthori[sz]ed|invalid api key/i.test(text)) return '密钥无效（检查 .env 里对应的 API 密钥）'
  if (/\b402\b|balance|credit|payment/i.test(text)) return '余额不足（到服务商控制台充值）'
  if (/\b403\b/.test(text)) return '没有权限'
  if (/\b429\b/.test(text)) return '被限流或同时连接太多'
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timed out|handshake/i.test(text)) return '连不上服务（检查网络）'
  return '出错了'
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 3)
}

function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return '（无效地址）'
  }
}

function connectionRefused(error: unknown): boolean {
  const cause = typeof error === 'object' && error !== null && 'cause' in error ? (error as { cause?: { code?: string } }).cause : undefined
  return cause?.code === 'ECONNREFUSED'
}

export function summarize(results: CheckResult[]): { failed: number; warned: number } {
  return { failed: results.filter((r) => r.status === 'fail').length, warned: results.filter((r) => r.status === 'warn').length }
}
