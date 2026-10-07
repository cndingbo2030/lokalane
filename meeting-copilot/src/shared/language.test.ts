import { describe, expect, it } from 'vitest'
import { detectReplyLanguage, guessLanguage, isAlreadyInLanguage, joinText, languageName, normalizeLanguageTag } from './language.ts'

describe('language helpers', () => {
  it('guesses scripts', () => {
    expect(guessLanguage('我们下周开始试点')).toBe('zh')
    expect(guessLanguage('こんにちは、よろしくお願いします')).toBe('ja')
    expect(guessLanguage('안녕하세요')).toBe('ko')
    expect(guessLanguage('Let us start the pilot')).toBe('latin')
    expect(guessLanguage('123 ...')).toBe('unknown')
  })

  it('skips translation only when text is already in the target language', () => {
    expect(isAlreadyInLanguage('你好', 'zh')).toBe(true)
    expect(isAlreadyInLanguage('Hello', 'zh')).toBe(false)
    expect(isAlreadyInLanguage('Hello', 'en')).toBe(true)
    expect(isAlreadyInLanguage('Hello', 'zh', 'zh-CN')).toBe(true)
  })

  it('joins CJK without spaces and Latin with spaces', () => {
    expect(joinText('价格', '是多少')).toBe('价格是多少')
    expect(joinText('what is', 'the price')).toBe('what is the price')
  })

  it('normalizes tags and names languages', () => {
    expect(normalizeLanguageTag('zh-CN')).toBe('zh')
    expect(normalizeLanguageTag('EN_us')).toBe('en')
    expect(normalizeLanguageTag('cmn')).toBe('zh')
    expect(languageName('en')).toBe('English')
    expect(languageName('ja', 'native')).toBe('日本語')
    expect(languageName('it')).toBe('it')
  })
})

describe('detectReplyLanguage', () => {
  it('answers in the language of the line being answered', () => {
    expect(detectReplyLanguage({ text: 'What is the price?' }, [{ text: '你好' }])).toBe('en')
    expect(detectReplyLanguage({ text: '价格是多少？' }, [])).toBe('zh')
  })

  it('prefers the STT language tag over the script guess', () => {
    expect(detectReplyLanguage({ text: 'Berapa harganya?', language: 'ms' }, [])).toBe('ms')
  })

  it('falls back to the most recent remote line, then undefined', () => {
    expect(detectReplyLanguage(undefined, [{ text: 'Hello' }, { text: 'データはどこに保存されますか' }])).toBe('ja')
    expect(detectReplyLanguage(undefined, [])).toBeUndefined()
  })
})
