/**
 * Mixed error rate (MER) for code-switched zh/en speech: CJK text is scored per
 * character (like CER), Latin text per word (like WER), in one edit-distance
 * pass. This is the standard way to score Chinese–English mixed transcripts.
 */
export function tokenize(text: string): string[] {
  const normalized = text
    .normalize('NFKC')
    .toLowerCase()
    // Punctuation and symbols do not count as recognition errors.
    .replace(/[\p{P}\p{S}]/gu, ' ')
  const tokens: string[] = []
  for (const match of normalized.matchAll(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}']+/gu)) {
    tokens.push(match[0])
  }
  return tokens
}

export function editDistance(reference: string[], hypothesis: string[]): number {
  let previous = Array.from({ length: hypothesis.length + 1 }, (_, j) => j)
  for (let i = 1; i <= reference.length; i++) {
    const current = [i]
    for (let j = 1; j <= hypothesis.length; j++) {
      const substitution = previous[j - 1] + (reference[i - 1] === hypothesis[j - 1] ? 0 : 1)
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution)
    }
    previous = current
  }
  return previous[hypothesis.length]
}

export interface ErrorRate {
  errors: number
  referenceTokens: number
  rate: number
}

export function mixedErrorRate(reference: string, hypothesis: string): ErrorRate {
  const ref = tokenize(reference)
  const errors = editDistance(ref, tokenize(hypothesis))
  return { errors, referenceTokens: ref.length, rate: ref.length ? errors / ref.length : errors ? 1 : 0 }
}

/** Corpus-level rate: total errors over total reference tokens (not a mean of per-file rates). */
export function aggregate(rates: ErrorRate[]): ErrorRate {
  const errors = rates.reduce((sum, r) => sum + r.errors, 0)
  const referenceTokens = rates.reduce((sum, r) => sum + r.referenceTokens, 0)
  return { errors, referenceTokens, rate: referenceTokens ? errors / referenceTokens : 0 }
}
