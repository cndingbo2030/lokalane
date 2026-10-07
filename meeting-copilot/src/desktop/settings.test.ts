import { describe, expect, it } from 'vitest'
import { applyUpdate, DEFAULT_SETTINGS, needsRestart, parseStored, serverEnv, toPublic, type Cipher } from './settings.ts'

// Reversible stand-in for Electron safeStorage.
const cipher: Cipher = {
  available: true,
  encrypt: (s) => Buffer.from(`enc:${s}`).toString('base64'),
  decrypt: (s) => Buffer.from(s, 'base64').toString().replace(/^enc:/, ''),
}
const noKeychain: Cipher = { ...cipher, available: false }

describe('desktop settings', () => {
  it('falls back to defaults for missing or corrupt files', () => {
    expect(parseStored(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(parseStored('{not json')).toEqual(DEFAULT_SETTINGS)
    expect(parseStored('{"sttProvider":"evil","overlay":false,"secrets":{"anthropic":"x","other":"y"}}')).toEqual({
      ...DEFAULT_SETTINGS,
      overlay: false,
      secrets: { anthropic: 'x' },
    })
  })

  it('encrypts keys, never exposes them publicly, and clears with an empty string', () => {
    let s = applyUpdate(DEFAULT_SETTINGS, { keys: { anthropic: ' sk-ant-123 ' }, hideFromScreenShare: false }, cipher)
    expect(s.secrets.anthropic).not.toContain('sk-ant-123')
    const pub = toPublic(s, { platform: 'darwin', version: '1.0.0', secureStorage: true })
    expect(pub.keys).toEqual({ anthropic: true, soniox: false, deepgram: false })
    expect(JSON.stringify(pub)).not.toContain('sk-ant')
    expect(pub.hideFromScreenShare).toBe(false)

    s = applyUpdate(s, { keys: { anthropic: '' } }, cipher)
    expect(s.secrets.anthropic).toBeUndefined()
  })

  it('refuses to store keys without a keychain or with malformed values', () => {
    expect(() => applyUpdate(DEFAULT_SETTINGS, { keys: { soniox: 'abc' } }, noKeychain)).toThrow('钥匙串')
    expect(() => applyUpdate(DEFAULT_SETTINGS, { keys: { soniox: 'abc def' } }, cipher)).toThrow('格式')
    // Non-key settings still save without a keychain.
    expect(applyUpdate(DEFAULT_SETTINGS, { overlay: false }, noKeychain).overlay).toBe(false)
  })

  it('builds the embedded server environment with saved keys over process env', () => {
    const s = applyUpdate(DEFAULT_SETTINGS, { keys: { anthropic: 'saved' }, sttProvider: 'deepgram' }, cipher)
    expect(serverEnv(s, cipher, { ANTHROPIC_API_KEY: 'from-env', DEEPGRAM_API_KEY: 'dg' })).toMatchObject({
      ANTHROPIC_API_KEY: 'saved',
      DEEPGRAM_API_KEY: 'dg',
      STT_PROVIDER: 'deepgram',
    })
    expect(serverEnv(DEFAULT_SETTINGS, cipher, {}).STT_PROVIDER).toBe('')
  })

  it('restarts the server only for keys and provider changes', () => {
    const keyed = applyUpdate(DEFAULT_SETTINGS, { keys: { soniox: 'k' } }, cipher)
    expect(needsRestart(DEFAULT_SETTINGS, keyed)).toBe(true)
    expect(needsRestart(keyed, applyUpdate(keyed, { sttProvider: 'soniox' }, cipher))).toBe(true)
    expect(needsRestart(keyed, applyUpdate(keyed, { overlay: false, hideFromScreenShare: false }, cipher))).toBe(false)
  })
})
