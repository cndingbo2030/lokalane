import { readFileSync } from 'node:fs'
import { detectReplyLanguage } from '../shared/language.ts'
import type { AudioSource, MeetingBrief, SuggestionKind } from '../shared/protocol.ts'

export interface CopilotCase {
  id: string
  description: string
  kind: SuggestionKind
  brief?: MeetingBrief
  targetLanguage?: 'zh' | 'en'
  transcript: Array<{ who: AudioSource; speaker?: string; text: string; language?: string }>
  /** For `manual` cases: what the user typed into "ask AI". */
  userQuestion?: string
  expect: {
    /** true: the copilot should stay silent (SKIP); false: it must answer. */
    shouldSkip?: boolean
    /** Case-insensitive regexes that must appear in the answer. */
    mustMention?: string[]
    /** Case-insensitive regexes that must not appear (e.g. invented numbers). */
    mustNotMention?: string[]
    /** Language code the suggested reply must be written in. */
    replyLanguage?: string
    /** true: a "↳" translation line is required; false: it must be absent. */
    bilingual?: boolean
  }
}

export function loadCases(path: string): CopilotCase[] {
  const cases = JSON.parse(readFileSync(path, 'utf8')) as CopilotCase[]
  if (!Array.isArray(cases)) throw new Error(`${path} must contain a JSON array of cases`)
  return cases
}

const isSkip = (output: string) => output.trim().startsWith('SKIP') || output.trim() === ''

/** The text after the first bold label line, e.g. "**建议回应**：…". */
export function replyLine(output: string): string | undefined {
  const line = output.split('\n').find((l) => /^\s*\*\*[^*]+\*\*\s*[:：]/.test(l))
  return line?.replace(/^\s*\*\*[^*]+\*\*\s*[:：]\s*/, '').trim() || undefined
}

/** Deterministic checks; an LLM judge scores the softer qualities separately. */
export function checkSuggestion(c: CopilotCase, output: string): { failures: string[] } {
  const failures: string[] = []
  const skipped = isSkip(output)
  if (c.expect.shouldSkip === true && !skipped) return { failures: ['expected SKIP'] }
  if (c.expect.shouldSkip === false && skipped) return { failures: ['unexpected SKIP'] }
  if (skipped) return { failures }

  for (const pattern of c.expect.mustMention ?? []) {
    if (!new RegExp(pattern, 'iu').test(output)) failures.push(`missing: ${pattern}`)
  }
  for (const pattern of c.expect.mustNotMention ?? []) {
    if (new RegExp(pattern, 'iu').test(output)) failures.push(`should not mention: ${pattern}`)
  }
  if (c.expect.replyLanguage) {
    const reply = replyLine(output)
    const language = reply ? detectReplyLanguage({ text: reply }, []) : undefined
    if (language !== c.expect.replyLanguage) failures.push(`reply language: expected ${c.expect.replyLanguage}`)
  }
  const hasTranslation = output.split('\n').some((l) => l.trim().startsWith('↳'))
  if (c.expect.bilingual === true && !hasTranslation) failures.push('missing ↳ translation line')
  if (c.expect.bilingual === false && hasTranslation) failures.push('unexpected ↳ translation line')
  return { failures }
}
