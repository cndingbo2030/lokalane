export type Effort = 'low' | 'medium' | 'high'

export interface LlmTextRequest {
  model: string
  /** Stable instructions for this role. */
  system: string
  /**
   * Stable per-session context (meeting brief, glossary). Sent after `system` with a
   * cache breakpoint so repeated calls in one meeting reuse the cached prefix.
   */
  cachedContext?: string
  /** The volatile part: recent transcript + the task for this call. */
  prompt: string
  maxTokens: number
  effort: Effort
  signal?: AbortSignal
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
