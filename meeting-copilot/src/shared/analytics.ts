import type { TranscriptSegment } from './protocol.ts'
import { isQuestion } from './questions.ts'

export interface SpeakerStats {
  /** "me", a diarized label such as "S1", or "remote" when the speaker is unknown. */
  key: string
  label: string
  isMe: boolean
  /** When they first spoke: a stable order for colors, unlike talk time. */
  firstMs: number
  talkMs: number
  /** Share of all talk time, 0..1. */
  share: number
  /** Uninterrupted runs of speech (segments less than 2 s apart merge into one turn). */
  turns: number
  longestTurnMs: number
  questions: number
  /** Characters per minute for mostly-CJK speech, words per minute otherwise; only with enough speech to be meaningful. */
  pace?: { value: number; unit: 'cpm' | 'wpm' }
}

export interface ConversationStats {
  /** From the first word to the last. */
  spanMs: number
  talkMs: number
  /** Most talk first. */
  speakers: SpeakerStats[]
  /** The user's share of talk time; null when none of the speech is known to be theirs. */
  myShare: number | null
  longestTurn?: { label: string; ms: number; startMs: number }
}

const TURN_GAP_MS = 2_000
const MIN_PACE_MS = 20_000
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu
const LATIN_WORD = /[\p{Script=Latin}\d]+(?:['’-][\p{Script=Latin}\d]+)*/gu

/**
 * Who talked how much, in how long a stretch, and how many questions they
 * asked — from the final transcript only, entirely on the client.
 */
export function conversationStats(segments: readonly TranscriptSegment[], names: Record<string, string> = {}, meSpeaker?: string): ConversationStats {
  const finals = segments.filter((s) => s.isFinal && s.text.trim() && s.endMs > s.startMs).sort((a, b) => a.startMs - b.startMs)
  const bySpeaker = new Map<string, SpeakerStats & { cjk: number; words: number }>()
  let longestTurn: ConversationStats['longestTurn']
  let turn: { key: string; startMs: number; endMs: number } | null = null

  const closeTurn = () => {
    if (!turn) return
    const stats = bySpeaker.get(turn.key)!
    const ms = turn.endMs - turn.startMs
    stats.turns++
    stats.longestTurnMs = Math.max(stats.longestTurnMs, ms)
    if (!longestTurn || ms > longestTurn.ms) longestTurn = { label: stats.label, ms, startMs: turn.startMs }
  }

  for (const segment of finals) {
    const isMe = segment.source === 'me' || (segment.speaker !== undefined && segment.speaker === meSpeaker)
    const key = isMe ? 'me' : (segment.speaker ?? 'remote')
    let stats = bySpeaker.get(key)
    if (!stats) {
      const label = isMe ? '我' : segment.speaker ? (names[segment.speaker] ?? `对方 ${segment.speaker}`) : '对方'
      stats = { key, label, isMe, firstMs: segment.startMs, talkMs: 0, share: 0, turns: 0, longestTurnMs: 0, questions: 0, cjk: 0, words: 0 }
      bySpeaker.set(key, stats)
    }
    stats.talkMs += segment.endMs - segment.startMs
    if (isQuestion(segment.text)) stats.questions++
    stats.cjk += segment.text.match(CJK)?.length ?? 0
    stats.words += segment.text.match(LATIN_WORD)?.length ?? 0

    if (turn && turn.key === key && segment.startMs - turn.endMs < TURN_GAP_MS) {
      turn.endMs = Math.max(turn.endMs, segment.endMs)
    } else {
      closeTurn()
      turn = { key, startMs: segment.startMs, endMs: segment.endMs }
    }
  }
  closeTurn()

  const talkMs = [...bySpeaker.values()].reduce((sum, s) => sum + s.talkMs, 0)
  const speakers: SpeakerStats[] = [...bySpeaker.values()]
    .map(({ cjk, words, ...stats }) => {
      const minutes = stats.talkMs / 60_000
      const cjkDominant = cjk >= words
      return {
        ...stats,
        share: talkMs > 0 ? stats.talkMs / talkMs : 0,
        pace: stats.talkMs >= MIN_PACE_MS ? { value: Math.round((cjkDominant ? cjk : words) / minutes), unit: cjkDominant ? ('cpm' as const) : ('wpm' as const) } : undefined,
      }
    })
    .sort((a, b) => b.talkMs - a.talkMs)

  const me = speakers.find((s) => s.isMe)
  return {
    spanMs: finals.length ? Math.max(...finals.map((s) => s.endMs)) - finals[0].startMs : 0,
    talkMs,
    speakers,
    myShare: me ? me.share : null,
    longestTurn,
  }
}

/** A few plain observations worth a glance after the meeting (none when there is too little to say). */
export function conversationInsights(stats: ConversationStats): string[] {
  const insights: string[] = []
  if (stats.talkMs < 3 * 60_000) return insights
  const me = stats.speakers.find((s) => s.isMe)
  if (me && me.share > 0.6) {
    insights.push(`你的发言占全部发言的 ${Math.round(me.share * 100)}%。在销售、谈判和访谈类会议中，多提问、多倾听通常更利于了解对方的真实需求。`)
  }
  if (stats.longestTurn && stats.longestTurn.ms >= 90_000) {
    insights.push(`最长的一段连续发言来自「${stats.longestTurn.label}」，约 ${formatMinutes(stats.longestTurn.ms)}。`)
  }
  const others = stats.speakers.filter((s) => !s.isMe)
  const otherQuestions = others.reduce((sum, s) => sum + s.questions, 0)
  if (me && me.questions === 0 && otherQuestions > 0) {
    insights.push(`对方提了 ${otherQuestions} 个问题，你没有提问。适当反问能帮助确认对方的需求和顾虑。`)
  }
  return insights
}

export function formatMinutes(ms: number): string {
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`
}
