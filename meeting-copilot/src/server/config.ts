import { existsSync } from 'node:fs'

export interface ServerConfig {
  port: number
  sttProvider: 'soniox' | 'deepgram' | 'mock'
  sonioxApiKey?: string
  sonioxModel: string
  deepgramApiKey?: string
  deepgramModel: string
  anthropicConfigured: boolean
  models: {
    copilot: string
    translate: string
    summary: string
  }
  accessToken?: string
  allowedOrigins: string[]
  production: boolean
  /**
   * Let calendar feeds and webhooks reach private/LAN addresses. Off for servers
   * (SSRF protection); the desktop app turns it on since it runs on the user's machine.
   */
  allowPrivateNetwork: boolean
  /** Behind a reverse proxy (Caddy, nginx): read the client address from X-Forwarded-For. */
  trustProxy: boolean
  /** Concurrent meetings this server accepts (each one streams to STT and calls the LLM). */
  maxSessions: number
  /** Meeting bots via Attendee; null with a reason when not configured. */
  bot: { apiKey: string; baseUrl: string; audioBaseUrl: string } | null
  botUnavailableReason?: string
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const requested = (env.STT_PROVIDER ?? '').toLowerCase()
  const sonioxApiKey = env.SONIOX_API_KEY || undefined
  const deepgramApiKey = env.DEEPGRAM_API_KEY || undefined

  let sttProvider: ServerConfig['sttProvider'] = 'mock'
  if (requested === 'soniox' && sonioxApiKey) sttProvider = 'soniox'
  else if (requested === 'deepgram' && deepgramApiKey) sttProvider = 'deepgram'
  else if (!requested && sonioxApiKey) sttProvider = 'soniox'
  else if (!requested && deepgramApiKey) sttProvider = 'deepgram'

  return {
    port: Number(env.PORT ?? 8790),
    sttProvider,
    sonioxApiKey,
    sonioxModel: env.SONIOX_MODEL || 'stt-rt-v5',
    deepgramApiKey,
    deepgramModel: env.DEEPGRAM_MODEL || 'nova-3',
    anthropicConfigured: Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN),
    models: {
      copilot: env.COPILOT_MODEL || 'claude-opus-5-5',
      translate: env.TRANSLATE_MODEL || 'claude-opus-5-5',
      summary: env.SUMMARY_MODEL || 'claude-opus-5-5',
    },
    accessToken: env.ACCESS_TOKEN || undefined,
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    production: env.NODE_ENV === 'production',
    allowPrivateNetwork: env.ALLOW_PRIVATE_NETWORK === 'true',
    trustProxy: env.TRUST_PROXY === 'true',
    maxSessions: positiveInt(env.MAX_SESSIONS, 50),
    ...botConfig(env),
  }
}

/**
 * The bot service streams audio to this server over a public wss:// URL, so bot
 * mode needs both an Attendee API key and the server's public https address.
 */
function botConfig(env: NodeJS.ProcessEnv): Pick<ServerConfig, 'bot' | 'botUnavailableReason'> {
  const apiKey = env.ATTENDEE_API_KEY
  if (!apiKey) return { bot: null, botUnavailableReason: '未配置 ATTENDEE_API_KEY' }
  let publicUrl: URL
  try {
    publicUrl = new URL(env.PUBLIC_URL ?? '')
  } catch {
    return { bot: null, botUnavailableReason: '未配置 PUBLIC_URL（本服务的公网 https 地址）' }
  }
  if (publicUrl.protocol !== 'https:' && publicUrl.protocol !== 'wss:') {
    return { bot: null, botUnavailableReason: 'PUBLIC_URL 必须是 https 地址（机器人通过 wss:// 回传音频）' }
  }
  const audioBaseUrl = `wss://${publicUrl.host}${publicUrl.pathname.replace(/\/+$/, '')}`
  return { bot: { apiKey, baseUrl: env.ATTENDEE_BASE_URL || 'https://app.attendee.dev', audioBaseUrl } }
}

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

/** Loads `.env` into process.env when present (Node >= 20.12). */
export function loadDotEnv(path = '.env'): void {
  if (existsSync(path)) process.loadEnvFile(path)
}
