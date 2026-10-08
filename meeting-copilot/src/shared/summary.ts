/** The line under the summary's "一句话总结 / TL;DR" heading, without list or bold markers. */
export function summaryTldr(summary: string): string | undefined {
  const lines = summary.split('\n').map((l) => l.trim())
  const heading = lines.findIndex((l) => /^#+\s*(一句话总结|TL;?DR)/i.test(l))
  const candidate = (heading >= 0 ? lines.slice(heading + 1) : []).find((l) => l && !l.startsWith('#'))
  return candidate?.replace(/^[-*•]\s*/, '').replace(/\*\*/g, '') || undefined
}
