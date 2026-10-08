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
  /**
   * A large user-message prefix several calls share (e.g. the full transcript for
   * the summary and the outcome extraction), cached after `documents`.
   */
  cachedPrompt?: string
  /** The volatile part: recent transcript + the task for this call. */
  prompt: string
  maxTokens: number
  effort: Effort
  signal?: AbortSignal
  /** Called once with token usage when the response completes. */
  onUsage?: (usage: LlmUsage) => void
}

export interface LlmJsonRequest extends LlmTextRequest {
  /** JSON Schema the response must match (structured outputs). */
  schema: Record<string, unknown>
  /** Short task name, e.g. "brief" or "outcomes" (logs and the offline mock). */
  task: string
}

/** Minimal interface so the pipeline can run against Claude or a mock. */
export interface LlmClient {
  readonly name: string
  streamText(request: LlmTextRequest): AsyncIterable<string>
  /** One structured response, validated against `schema` by the API. */
  completeJson<T>(request: LlmJsonRequest): Promise<T>
}

export class LlmOutputError extends Error {}

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
