/**
 * Wire protocol between the browser (capture + UI) and the copilot server.
 *
 * Text frames carry JSON `ClientMessage` / `ServerMessage`.
 * Binary frames (client -> server only) carry audio:
 *   byte 0     : AudioSource code (0 = me / microphone, 1 = remote / meeting audio)
 *   bytes 1..n : PCM signed 16-bit little-endian, mono, AUDIO_SAMPLE_RATE Hz
 *
 * Keeping "me" and "remote" on separate channels is the single most important
 * design decision for a meeting copilot: we always know who spoke without
 * relying on diarization, and the copilot never "answers" the user's own words.
 */

export const AUDIO_SAMPLE_RATE = 16_000
export const AUDIO_FRAME_MS = 100

export type AudioSource = 'me' | 'remote'
export const AUDIO_SOURCE_CODES: Record<AudioSource, number> = { me: 0, remote: 1 }

export type MeetingPlatform = 'google-meet' | 'teams' | 'zoom' | 'tencent' | 'unknown'

/** BCP-47-ish short codes. `auto` lets the STT engine detect. */
export type LanguageCode = 'auto' | 'zh' | 'en' | 'ja' | 'ko' | 'ms' | 'es' | 'fr' | 'de'

export interface MeetingBrief {
  /** Who the user is in this meeting, e.g. "Lawgorithm 创始人，负责商务谈判". */
  myRole: string
  /** What the user wants out of this meeting. */
  goal: string
  /** Background facts, pricing, product notes, glossary... used for grounded answers. */
  context: string
}

export interface SessionConfig {
  meetingUrl?: string
  platform: MeetingPlatform
  /** Languages expected to be spoken in the meeting (STT hints). */
  spokenLanguages: LanguageCode[]
  /** Language the user wants translations and copilot explanations in. */
  targetLanguage: Exclude<LanguageCode, 'auto'>
  translate: boolean
  copilot: {
    enabled: boolean
    /** Fire automatically on questions / objections from remote speakers. */
    autoTrigger: boolean
  }
  brief: MeetingBrief
}

export interface TranscriptSegment {
  /** Stable while a segment is partial; partial updates reuse the same id. */
  id: string
  source: AudioSource
  /** Diarized speaker label within a source, e.g. "S1". Undefined when unknown. */
  speaker?: string
  text: string
  isFinal: boolean
  /** Milliseconds since session start. */
  startMs: number
  endMs: number
  language?: string
}

export type SuggestionKind = 'question' | 'objection' | 'manual' | 'action'

export interface SuggestionTrigger {
  kind: SuggestionKind
  segmentId?: string
  text: string
}

export type ClientMessage =
  | { type: 'start'; config: SessionConfig }
  | { type: 'ask'; question?: string }
  | { type: 'summary' }
  | { type: 'demo' }
  | { type: 'stop' }
  | { type: 'ping' }

export type ServerMessage =
  | { type: 'ready'; sessionId: string; stt: string; llm: string }
  | { type: 'transcript'; segment: TranscriptSegment }
  | { type: 'translation'; segmentId: string; text: string; targetLanguage: string }
  | { type: 'suggestion.start'; id: string; trigger: SuggestionTrigger }
  | { type: 'suggestion.delta'; id: string; delta: string }
  | { type: 'suggestion.done'; id: string; error?: string }
  | { type: 'summary.start' }
  | { type: 'summary.delta'; delta: string }
  | { type: 'summary.done'; error?: string }
  | { type: 'error'; message: string; recoverable: boolean }
  | { type: 'pong' }

export function encodeAudioFrame(source: AudioSource, pcm: Int16Array): ArrayBuffer {
  const out = new Uint8Array(1 + pcm.byteLength)
  out[0] = AUDIO_SOURCE_CODES[source]
  out.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), 1)
  return out.buffer
}

export function decodeAudioFrame(frame: Uint8Array): { source: AudioSource; pcm: Uint8Array } | null {
  if (frame.byteLength < 3 || (frame.byteLength - 1) % 2 !== 0) return null
  const code = frame[0]
  const source: AudioSource | null = code === 0 ? 'me' : code === 1 ? 'remote' : null
  if (!source) return null
  // Copy so the PCM starts at byte offset 0: after the 1-byte header it would sit at an
  // odd offset, which cannot back an Int16Array.
  return { source, pcm: frame.slice(1) }
}
