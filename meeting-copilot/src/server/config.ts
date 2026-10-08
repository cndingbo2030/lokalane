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
  }
}

/** Loads `.env` into process.env when present (Node >= 20.12). */
export function loadDotEnv(path = '.env'): void {
  if (existsSync(path)) process.loadEnvFile(path)
}
