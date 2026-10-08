/** Cheap question detection for Chinese and English utterances (used by triggers and analytics). */

const QUESTION_END = /[?？]\s*$/u
const ZH_QUESTION_PARTICLE = /[吗呢么嘛][。．.!！]?\s*$/u
const ZH_INTERROGATIVE = /(什么|怎么|为什么|为啥|如何|多少|多久|哪里|哪个|哪些|几个|是否|能不能|可不可以|会不会|有没有|是不是|要不要|行不行|对吧|你们觉得|你觉得|请问)/u
const EN_QUESTION_START =
  /^(what|why|how|when|where|who|which|can|could|would|will|do|does|did|is|are|should|have|has|may|any thoughts|thoughts on)\b/i
const EN_QUESTION_PHRASE = /\b(can you|could you|would you|do you|what about|how about|tell me|walk me through|your thoughts|any questions)\b/i

export function isQuestion(text: string): boolean {
  const t = text.trim()
  if (t.length < 4) return false
  return QUESTION_END.test(t) || ZH_QUESTION_PARTICLE.test(t) || ZH_INTERROGATIVE.test(t) || EN_QUESTION_START.test(t) || EN_QUESTION_PHRASE.test(t)
}
