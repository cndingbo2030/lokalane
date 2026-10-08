import type { MeetingOutcomes } from '../../shared/outcomes.ts'
import type { DocumentRef, LanguageCode } from '../../shared/protocol.ts'
import type { LlmClient } from '../llm/types.ts'
import { formatTranscript, type Speakers, type TranscriptStore } from '../transcript.ts'
import { normalizeOutcomes, OUTCOMES_SCHEMA } from './outcomes.ts'
import { analystSystem, outcomesTask, summaryTask, transcriptBlock } from './prompts.ts'

interface AnalysisOptions {
  llm: LlmClient
  model: string
  target: Exclude<LanguageCode, 'auto'>
  transcript: TranscriptStore
  cachedContext?: string
  documents?: DocumentRef[]
  speakers?: Speakers
  signal?: AbortSignal
}

/** Same system, brief, documents and transcript for both calls: only the task differs. */
function shared(options: AnalysisOptions) {
  return {
    model: options.model,
    system: analystSystem(options.target),
    cachedContext: options.cachedContext,
    documents: options.documents,
    cachedPrompt: transcriptBlock(formatTranscript(options.transcript.all(), options.speakers)),
    signal: options.signal,
  }
}

export async function streamSummary(options: AnalysisOptions & { onDelta: (delta: string) => void }): Promise<void> {
  const stream = options.llm.streamText({ ...shared(options), prompt: summaryTask(options.target), maxTokens: 16_000, effort: 'medium' })
  for await (const delta of stream) options.onDelta(delta)
}

/** Runs after the summary, so the transcript prefix is already cached. */
export async function extractOutcomes(options: AnalysisOptions & { meetingDate: string }): Promise<MeetingOutcomes> {
  const raw = await options.llm.completeJson({
    ...shared(options),
    task: 'outcomes',
    prompt: outcomesTask(options.target, options.meetingDate),
    maxTokens: 8_000,
    effort: 'medium',
    schema: OUTCOMES_SCHEMA,
  })
  return normalizeOutcomes(raw)
}
