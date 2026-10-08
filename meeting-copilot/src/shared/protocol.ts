/**
 * Wire protocol between the browser (capture + UI) and the copilot server.
 *
 * Text frames carry JSON `ClientMessage` / `ServerMessage`.
 * Binary frames (client -> server only) carry audio:
 *   byte 0     : AudioSource code (0 = me / microphone, 1 = remote / meeting audio)
 *   bytes 1..4 : capture time of the first sample, ms since capture start (uint32 LE)
 *   bytes 5..n : PCM signed 16-bit little-endian, mono, AUDIO_SAMPLE_RATE Hz
 *
 * The capture time lets the server place audio on the meeting timeline exactly,
 * even when it arrives late (buffered during a disconnect) or with gaps (VAD).
 *
 * Keeping "me" and "remote" on separate channels is the single most important
 * design decision for a meeting copilot: we always know who spoke without
 * relying on diarization, and the copilot never "answers" the user's own words.
 */

import type { MeetingOutcomes } from './outcomes.ts'

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

/** A knowledge document attached to the meeting (pricing sheet, product manual…). */
export interface DocumentRef {
  /** Anthropic Files API id (or a local id in mock mode). */
  id: string
  name: string
  kind: 'pdf' | 'text'
  sizeBytes: number
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
  /** Documents the copilot and summary may ground answers in (not sent to the translator). */
  documents?: DocumentRef[]
  /** From the calendar event, when the meeting was prepared from one. */
  meeting?: MeetingInfo
  /** The user's IANA time zone, to resolve relative due dates ("next Friday"). */
  timeZone?: string
}

export interface MeetingInfo {
  title?: string
  /** Display names (or emails) of invited participants. */
  attendees?: string[]
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
  /** Language the suggested reply is written in (the other side's language), e.g. "en". */
  replyLanguage?: string
}

export type FeedbackRating = 'up' | 'down'

export type ClientMessage =
  /** `resumeSessionId`: re-attach to a meeting whose socket dropped (within the grace period). */
  | { type: 'start'; config: SessionConfig; resumeSessionId?: string }
  /** The user ended the meeting: close the server session now instead of keeping it resumable. */
  | { type: 'leave' }
  | { type: 'ask'; question?: string }
  /** Display names for diarized speakers, e.g. { S1: '王总' }. */
  | { type: 'speakers'; names: Record<string, string> }
  | { type: 'feedback'; suggestionId: string; rating: FeedbackRating | null }
  | { type: 'summary' }
  | { type: 'demo' }
  | { type: 'stop' }
  | { type: 'ping' }

export type ServerMessage =
  | { type: 'ready'; sessionId: string; stt: string; llm: string; resumed?: boolean }
  | { type: 'transcript'; segment: TranscriptSegment }
  | { type: 'translation'; segmentId: string; text: string; targetLanguage: string }
  | { type: 'suggestion.start'; id: string; trigger: SuggestionTrigger }
  | { type: 'suggestion.delta'; id: string; delta: string }
  | { type: 'suggestion.done'; id: string; error?: string }
  | { type: 'summary.start' }
  | { type: 'summary.delta'; delta: string }
  | { type: 'summary.done'; error?: string }
  | { type: 'outcomes.start' }
  | { type: 'outcomes'; outcomes?: MeetingOutcomes; error?: string }
  | { type: 'metrics'; metrics: MetricsSnapshot }
  | { type: 'error'; message: string; recoverable: boolean }
  | { type: 'pong' }

export interface LatencyStats {
  count: number
  p50: number | null
  p95: number | null
}

export type LlmRole = 'translate' | 'copilot' | 'summary'

export interface RoleMetrics {
  calls: number
  errors: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costUsd: number
  /** Request start → first streamed token. */
  ttftMs: LatencyStats
}

export interface MetricsSnapshot {
  /** Audio actually forwarded to STT (after client-side VAD), per source. */
  audioSentSeconds: Record<AudioSource, number>
  finalSegments: Record<AudioSource, number>
  /** Final segment → translation shown. */
  translationLatencyMs: LatencyStats
  /** Trigger (end of the other side's sentence) → first visible suggestion token. */
  suggestionLatencyMs: LatencyStats
  llm: Record<LlmRole, RoleMetrics>
  suggestions: { triggered: number; shown: number; skipped: number; up: number; down: number }
  errors: number
  /** Estimated Claude spend for this meeting (list prices, excludes STT). */
  costUsd: number
}

const AUDIO_HEADER_BYTES = 5

export function encodeAudioFrame(source: AudioSource, pcm: Int16Array, captureMs: number): ArrayBuffer {
  const out = new Uint8Array(AUDIO_HEADER_BYTES + pcm.byteLength)
  out[0] = AUDIO_SOURCE_CODES[source]
  new DataView(out.buffer).setUint32(1, Math.max(0, Math.min(0xffffffff, Math.round(captureMs))), true)
  out.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), AUDIO_HEADER_BYTES)
  return out.buffer
}

export function decodeAudioFrame(frame: Uint8Array): { source: AudioSource; captureMs: number; pcm: Uint8Array } | null {
  if (frame.byteLength < AUDIO_HEADER_BYTES + 2 || (frame.byteLength - AUDIO_HEADER_BYTES) % 2 !== 0) return null
  const code = frame[0]
  const source: AudioSource | null = code === 0 ? 'me' : code === 1 ? 'remote' : null
  if (!source) return null
  const captureMs = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(1, true)
  // Copy so the PCM starts at byte offset 0: after the 5-byte header it would sit at an
  // odd offset, which cannot back an Int16Array.
  return { source, captureMs, pcm: frame.slice(AUDIO_HEADER_BYTES) }
}
