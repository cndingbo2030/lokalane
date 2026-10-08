import type { DesktopSettingsUpdate, PublicDesktopSettings, SttChoice } from '../shared/desktop.ts'

export type KeyId = keyof PublicDesktopSettings['keys']
const KEY_IDS: KeyId[] = ['anthropic', 'soniox', 'deepgram']
const ENV_NAMES: Record<KeyId, string> = { anthropic: 'ANTHROPIC_API_KEY', soniox: 'SONIOX_API_KEY', deepgram: 'DEEPGRAM_API_KEY' }

/** On-disk shape (settings.json in the app's userData folder). Secrets are OS-encrypted, base64. */
export interface StoredSettings {
  version: 1
  sttProvider: SttChoice
  hideFromScreenShare: boolean
  overlay: boolean
  secrets: Partial<Record<KeyId, string>>
}

/** Electron's safeStorage, abstracted so the logic is testable without Electron. */
export interface Cipher {
  readonly available: boolean
  encrypt(plain: string): string
  decrypt(encrypted: string): string
}

export const DEFAULT_SETTINGS: StoredSettings = {
  version: 1,
  sttProvider: 'auto',
  hideFromScreenShare: true,
  overlay: true,
  secrets: {},
}

export function parseStored(raw: string | undefined): StoredSettings {
  if (!raw) return { ...DEFAULT_SETTINGS, secrets: {} }
  try {
    const data = JSON.parse(raw) as Partial<StoredSettings>
    const secrets: StoredSettings['secrets'] = {}
    for (const id of KEY_IDS) if (typeof data.secrets?.[id] === 'string') secrets[id] = data.secrets[id]
    return {
      version: 1,
      sttProvider: data.sttProvider === 'soniox' || data.sttProvider === 'deepgram' ? data.sttProvider : 'auto',
      hideFromScreenShare: data.hideFromScreenShare ?? DEFAULT_SETTINGS.hideFromScreenShare,
      overlay: data.overlay ?? DEFAULT_SETTINGS.overlay,
      secrets,
    }
  } catch {
    // A corrupt file must not brick the app; the user re-enters keys.
    return { ...DEFAULT_SETTINGS, secrets: {} }
  }
}

export function applyUpdate(stored: StoredSettings, update: DesktopSettingsUpdate, cipher: Cipher): StoredSettings {
  const next: StoredSettings = { ...stored, secrets: { ...stored.secrets } }
  if (update.sttProvider === 'auto' || update.sttProvider === 'soniox' || update.sttProvider === 'deepgram') next.sttProvider = update.sttProvider
  if (typeof update.hideFromScreenShare === 'boolean') next.hideFromScreenShare = update.hideFromScreenShare
  if (typeof update.overlay === 'boolean') next.overlay = update.overlay
  for (const id of KEY_IDS) {
    const value = update.keys?.[id]
    if (value === undefined) continue
    const trimmed = value.trim()
    if (!trimmed) {
      delete next.secrets[id]
      continue
    }
    if (!cipher.available) throw new Error('系统钥匙串不可用，无法安全保存密钥')
    if (trimmed.length > 512 || /\s/.test(trimmed)) throw new Error(`${ENV_NAMES[id]} 格式不正确`)
    next.secrets[id] = cipher.encrypt(trimmed)
  }
  return next
}

export function toPublic(stored: StoredSettings, meta: { platform: string; version: string; secureStorage: boolean }): PublicDesktopSettings {
  return {
    keys: { anthropic: Boolean(stored.secrets.anthropic), soniox: Boolean(stored.secrets.soniox), deepgram: Boolean(stored.secrets.deepgram) },
    sttProvider: stored.sttProvider,
    hideFromScreenShare: stored.hideFromScreenShare,
    overlay: stored.overlay,
    ...meta,
  }
}

/**
 * Environment for the embedded server: saved keys win, keys from the process
 * environment are the fallback (useful on Linux without a keychain).
 */
export function serverEnv(stored: StoredSettings, cipher: Cipher, base: Record<string, string | undefined>): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...base }
  for (const id of KEY_IDS) {
    const encrypted = stored.secrets[id]
    if (!encrypted || !cipher.available) continue
    try {
      env[ENV_NAMES[id]] = cipher.decrypt(encrypted)
    } catch {
      // Keychain changed (e.g. a new OS user): treat the key as missing.
    }
  }
  env.STT_PROVIDER = stored.sttProvider === 'auto' ? '' : stored.sttProvider
  return env
}

/** Keys and the STT provider are read at server start; window options apply live. */
export function needsRestart(before: StoredSettings, after: StoredSettings): boolean {
  return before.sttProvider !== after.sttProvider || KEY_IDS.some((id) => before.secrets[id] !== after.secrets[id])
}
