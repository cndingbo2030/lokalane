import type { LanguageCode } from '../../shared/protocol.ts'
import type { LlmClient } from '../llm/types.ts'
import { formatTranscript, type TranscriptStore } from '../transcript.ts'
import { summaryPrompt, summarySystem } from './prompts.ts'

export async function streamSummary(options: {
  llm: LlmClient
  model: string
  target: Exclude<LanguageCode, 'auto'>
  transcript: TranscriptStore
  cachedContext?: string
  signal?: AbortSignal
  onDelta: (delta: string) => void
}): Promise<void> {
  const stream = options.llm.streamText({
    model: options.model,
    system: summarySystem(options.target),
    cachedContext: options.cachedContext,
    prompt: summaryPrompt(formatTranscript(options.transcript.all())),
    maxTokens: 16_000,
    effort: 'medium',
    signal: options.signal,
  })
  for await (const delta of stream) options.onDelta(delta)
}
