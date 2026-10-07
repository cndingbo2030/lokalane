import type { DocumentRef } from '../../shared/protocol.ts'

export type Effort = 'low' | 'medium' | 'high'

export interface LlmUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export interface LlmTextRequest {
  model: string
  /** Stable instructions for this role. */
  system: string
  /**
   * Stable per-session context (meeting brief, glossary). Sent after `system` with a
   * cache breakpoint so repeated calls in one meeting reuse the cached prefix.
   */
  cachedContext?: string
  /**
   * Knowledge documents, sent ahead of the prompt with their own cache breakpoint:
   * for a handful of per-meeting files, long context + caching beats building RAG.
   */
  documents?: DocumentRef[]
  /** The volatile part: recent transcript + the task for this call. */
  prompt: string
  maxTokens: number
  effort: Effort
  signal?: AbortSignal
  /** Called once with token usage when the response completes. */
  onUsage?: (usage: LlmUsage) => void
}

/** Minimal streaming-text interface so the pipeline can run against Claude or a mock. */
export interface LlmClient {
  readonly name: string
  streamText(request: LlmTextRequest): AsyncIterable<string>
}

export class LlmRefusalError extends Error {
  constructor(readonly category: string | null) {
    super(`The model declined this request${category ? ` (${category})` : ''}`)
  }
}

export async function collectText(stream: AsyncIterable<string>): Promise<string> {
  let text = ''
  for await (const delta of stream) text += delta
  return text
}
