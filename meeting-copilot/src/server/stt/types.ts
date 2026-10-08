import type { AudioSource, LanguageCode } from '../../shared/protocol.ts'

/**
 * Normalized recognition result. Every provider adapter maps its native events to
 * "utterance" semantics: `partial` results carry the full text of the utterance
 * in progress and replace each other; a `final` result closes the utterance.
 */
export interface SttResult {
  text: string
  isFinal: boolean
  speaker?: string
  language?: string
  startMs: number
  endMs: number
}

export interface SttStreamOptions {
  source: AudioSource
  languages: LanguageCode[]
  diarize: boolean
  onResult: (result: SttResult) => void
  onError: (error: Error) => void
  /**
   * The provider ended the stream on its own (network drop, server error, duration
   * limit), so the caller can open a new one. Not called after `close()`.
   */
  onClose?: (info: SttCloseInfo) => void
}

export interface SttCloseInfo {
  /** Shown to the user. */
  detail: string
  /** Retrying cannot help: a bad key, no credit left, a rejected request. */
  fatal: boolean
}

export interface SttStream {
  /** PCM s16le mono 16 kHz. */
  write(pcm: Uint8Array): void
  close(): Promise<void>
}

export interface SttProvider {
  readonly name: string
  open(options: SttStreamOptions): SttStream
}
