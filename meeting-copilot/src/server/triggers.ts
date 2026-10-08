import type { SuggestionKind, TranscriptSegment } from '../shared/protocol.ts'
import { isQuestion } from '../shared/questions.ts'

/*
 * Cheap, deterministic first-stage trigger. It runs on every final segment in
 * microseconds and decides whether the (expensive) copilot model should run.
 * The model itself can still answer "SKIP" when the trigger was a false positive.
 */

const ZH_OBJECTION = /(太贵|贵了|价格太|预算(不够|有限|紧)|超出预算|担心|顾虑|风险|不确定|没把握|竞争对手|别家|再考虑|再想想|不太(行|合适|满意)|没必要|做不到|不同意|不能接受|有问题)/u
const EN_OBJECTION =
  /\b(too expensive|expensive|over budget|budget is|concern(ed|s)?|worr(y|ied)|not sure|risk(y|s)?|competitor|cheaper|hesitant|push back|can't commit|cannot commit|not convinced|doesn't work for us|deal ?breaker)\b/i

export function classifySegment(text: string): SuggestionKind | null {
  const t = text.trim()
  if (t.length < 4) return null
  if (ZH_OBJECTION.test(t) || EN_OBJECTION.test(t)) return 'objection'
  return isQuestion(t) ? 'question' : null
}

export interface TriggerDecision {
  kind: SuggestionKind
  segment: TranscriptSegment
}

/** Applies source filtering, classification and a cooldown. */
export class TriggerDetector {
  private lastFiredAt = Number.NEGATIVE_INFINITY

  constructor(
    private readonly cooldownMs = 6_000,
    private readonly now: () => number = Date.now,
  ) {}

  evaluate(segment: TranscriptSegment): TriggerDecision | null {
    if (!segment.isFinal || segment.source !== 'remote') return null
    const kind = classifySegment(segment.text)
    if (!kind) return null
    const t = this.now()
    // Objections bypass (and do not consume) the cooldown: they are rarer and more valuable.
    if (kind === 'objection') return { kind, segment }
    if (t - this.lastFiredAt < this.cooldownMs) return null
    this.lastFiredAt = t
    return { kind, segment }
  }
}
