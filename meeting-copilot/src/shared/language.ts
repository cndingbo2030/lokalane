import type { LanguageCode } from './protocol.ts'

export const LANGUAGE_NAMES: Record<Exclude<LanguageCode, 'auto'>, { native: string; english: string }> = {
  zh: { native: '中文', english: 'Simplified Chinese' },
  en: { native: 'English', english: 'English' },
  ja: { native: '日本語', english: 'Japanese' },
  ko: { native: '한국어', english: 'Korean' },
  ms: { native: 'Bahasa Melayu', english: 'Malay' },
  es: { native: 'Español', english: 'Spanish' },
  fr: { native: 'Français', english: 'French' },
  de: { native: 'Deutsch', english: 'German' },
}

const HAN = /\p{Script=Han}/u
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u
const HANGUL = /\p{Script=Hangul}/u
const LATIN = /\p{Script=Latin}/u

/**
 * Cheap script-based guess, used only to skip translating text that is already
 * in the target language when the STT engine did not report a language.
 */
export function guessLanguage(text: string): 'zh' | 'ja' | 'ko' | 'latin' | 'unknown' {
  let han = 0
  let kana = 0
  let hangul = 0
  let latin = 0
  for (const char of text) {
    if (KANA.test(char)) kana++
    else if (HAN.test(char)) han++
    else if (HANGUL.test(char)) hangul++
    else if (LATIN.test(char)) latin++
  }
  const total = han + kana + hangul + latin
  if (total === 0) return 'unknown'
  if (kana / total > 0.15) return 'ja'
  if (hangul / total > 0.3) return 'ko'
  // Latin letters are counted per character, CJK per word-ish character; weight CJK up.
  if ((han * 2) / (han * 2 + latin) > 0.5) return 'zh'
  return 'latin'
}

/** True when the text is (most likely) already written in `target`. */
export function isAlreadyInLanguage(text: string, target: Exclude<LanguageCode, 'auto'>, sttLanguage?: string): boolean {
  if (sttLanguage) return sttLanguage.toLowerCase().split(/[-_]/)[0] === target
  const guess = guessLanguage(text)
  if (guess === 'unknown') return true
  if (target === 'zh' || target === 'ja' || target === 'ko') return guess === target
  // For Latin-script targets we cannot tell English from Malay/Spanish by script, so only
  // skip when the target is English and the text is Latin script.
  return target === 'en' && guess === 'latin'
}

/** Normalizes STT language tags ("zh-CN", "EN_us", "cmn") to short codes. */
export function normalizeLanguageTag(tag: string): string {
  const base = tag.toLowerCase().split(/[-_]/)[0]
  return base === 'cmn' || base === 'yue' ? 'zh' : base
}

export function languageName(code: string, style: 'native' | 'english' = 'english'): string {
  const known = LANGUAGE_NAMES[code as keyof typeof LANGUAGE_NAMES]
  return known ? known[style] : code
}

/**
 * The language the user should answer in: the language of the line being
 * answered, else of the other side's most recent line. Uses the STT engine's
 * language tag when present and falls back to the script (Latin → English).
 */
export function detectReplyLanguage(
  focus: { text: string; language?: string } | undefined,
  recentRemote: ReadonlyArray<{ text: string; language?: string }>,
): string | undefined {
  for (const segment of [focus, ...[...recentRemote].reverse()]) {
    if (!segment) continue
    if (segment.language) return normalizeLanguageTag(segment.language)
    const guess = guessLanguage(segment.text)
    if (guess === 'latin') return 'en'
    if (guess !== 'unknown') return guess
  }
  return undefined
}

/** Join two transcript fragments, inserting a space only between non-CJK words. */
export function joinText(left: string, right: string): string {
  if (!left) return right
  if (!right) return left
  const a = left.at(-1) ?? ''
  const b = right[0] ?? ''
  if (/\s/.test(a) || /\s/.test(b)) return left + right
  const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}，。！？、]/u
  if (cjk.test(a) || cjk.test(b)) return left + right
  return `${left} ${right}`
}
