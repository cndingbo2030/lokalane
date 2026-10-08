/**
 * Copilot eval: runs each case in evals/copilot-cases.json through the real
 * Copilot pipeline (same prompts, model and parameters as production), applies
 * deterministic checks, and optionally asks a Claude judge to grade quality.
 *
 *   npm run eval:copilot                 # real model + judge (spends API credits)
 *   npm run eval:copilot -- --mock       # offline dry run of the harness
 *   npm run eval:copilot -- --no-judge --only price-en
 */
import Anthropic from '@anthropic-ai/sdk'
import { mkdirSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import type { SuggestionTrigger, TranscriptSegment } from '../shared/protocol.ts'
import { Copilot } from '../server/ai/copilot.ts'
import { briefBlock } from '../server/ai/prompts.ts'
import { loadConfig, loadDotEnv } from '../server/config.ts'
import { AnthropicLlm } from '../server/llm/anthropic.ts'
import { MockLlm } from '../server/llm/mock.ts'
import { SessionMetrics } from '../server/metrics.ts'
import { formatTranscript, TranscriptStore } from '../server/transcript.ts'
import { checkSuggestion, loadCases, type CopilotCase } from './copilotCases.ts'

const { values: args } = parseArgs({
  options: {
    cases: { type: 'string', default: 'evals/copilot-cases.json' },
    only: { type: 'string' },
    mock: { type: 'boolean', default: false },
    'no-judge': { type: 'boolean', default: false },
    'judge-model': { type: 'string', default: 'claude-opus-5-5' },
  },
})

loadDotEnv()
const config = loadConfig()
if (!args.mock && !config.anthropicConfigured) {
  console.error('ANTHROPIC_API_KEY is not set. Use --mock for an offline dry run.')
  process.exit(1)
}

const cases = loadCases(args.cases!).filter((c) => !args.only || c.id === args.only)
const useJudge = !args.mock && !args['no-judge']
const anthropic = args.mock ? null : new Anthropic()

interface CaseResult {
  id: string
  output: string
  failures: string[]
  latencyMs: number | null
  judge?: JudgeVerdict
}

interface JudgeVerdict {
  grounded: number
  helpful: number
  concise: number
  pass: boolean
  reason: string
}

async function runCase(c: CopilotCase, metrics: SessionMetrics): Promise<Omit<CaseResult, 'judge'>> {
  const transcript = new TranscriptStore()
  const segments: TranscriptSegment[] = c.transcript.map((line, i) => ({
    id: `${c.id}-${i}`,
    source: line.who,
    speaker: line.speaker,
    text: line.text,
    isFinal: true,
    startMs: i * 5_000,
    endMs: i * 5_000 + 4_000,
    language: line.language,
  }))
  segments.forEach((s) => transcript.addFinal(s))

  let output = ''
  let latencyMs: number | null = null
  const copilot = new Copilot({
    llm: metrics.meter(args.mock ? new MockLlm() : new AnthropicLlm(), 'copilot'),
    model: config.models.copilot,
    target: c.targetLanguage ?? 'zh',
    transcript,
    cachedContext: c.brief ? briefBlock(c.brief) : undefined,
    idPrefix: c.id,
    events: {
      start: (_id, _trigger, waitedMs) => (latencyMs = waitedMs),
      delta: (_id, delta) => (output += delta),
      done: (_id, error) => {
        if (error) output += `\n[error: ${error}]`
      },
    },
  })
  const focus = [...segments].reverse().find((s) => s.source === 'remote')
  const trigger: SuggestionTrigger = { kind: c.kind, segmentId: focus?.id, text: c.userQuestion ?? focus?.text ?? '' }
  copilot.trigger(trigger, c.userQuestion)
  await copilot.idle()

  const final = output.trim() || 'SKIP'
  return { id: c.id, output: final, failures: checkSuggestion(c, final).failures, latencyMs }
}

const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    grounded: { type: 'integer', description: '1-5: every fact is supported by the brief/transcript; nothing invented' },
    helpful: { type: 'integer', description: '1-5: the reply moves the conversation toward the user’s goal and can be said aloud as-is' },
    concise: { type: 'integer', description: '1-5: readable at a glance during a live call' },
    pass: { type: 'boolean', description: 'Would an expert meeting coach be comfortable showing this to the user?' },
    reason: { type: 'string', description: 'One sentence explaining the main weakness, or why it is good' },
  },
  required: ['grounded', 'helpful', 'concise', 'pass', 'reason'],
  additionalProperties: false,
}

async function judge(c: CopilotCase, output: string): Promise<JudgeVerdict> {
  const response = await anthropic!.messages.create({
    model: args['judge-model']!,
    max_tokens: 4_000,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: JUDGE_SCHEMA } },
    system:
      'You grade a real-time meeting copilot. It shows the user a reply they can say aloud in the other side’s language (with a ↳ translation when that differs from the user’s language), plus short supporting bullets. Be strict about invented facts and commitments.',
    messages: [
      {
        role: 'user',
        content: [
          `<case>${c.description}</case>`,
          c.brief ? `<brief>\n${briefBlock(c.brief)}\n</brief>` : '<brief>(none)</brief>',
          `<transcript>\n${formatTranscript(c.transcript.map((l, i) => ({ id: String(i), source: l.who, speaker: l.speaker, text: l.text, isFinal: true, startMs: i * 5_000, endMs: 0 })))}\n</transcript>`,
          c.userQuestion ? `<user_question>${c.userQuestion}</user_question>` : '',
          `<copilot_output>\n${output}\n</copilot_output>`,
        ]
          .filter(Boolean)
          .join('\n\n'),
      },
    ],
  })
  const text = response.content.find((b) => b.type === 'text')
  if (response.stop_reason === 'refusal' || !text || text.type !== 'text') throw new Error(`judge returned no verdict (${response.stop_reason})`)
  return JSON.parse(text.text) as JudgeVerdict
}

const metrics = new SessionMetrics()
const results: CaseResult[] = []
console.log(`Running ${cases.length} copilot case(s) on ${args.mock ? 'mock LLM' : config.models.copilot}${useJudge ? ` with judge ${args['judge-model']}` : ''}…\n`)

for (const c of cases) {
  const result: CaseResult = await runCase(c, metrics)
  if (useJudge && result.output !== 'SKIP') {
    try {
      result.judge = await judge(c, result.output)
    } catch (error) {
      result.failures.push(`judge error: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  results.push(result)
  const ok = result.failures.length === 0 && (result.judge?.pass ?? true)
  const scores = result.judge ? ` grounded ${result.judge.grounded} · helpful ${result.judge.helpful} · concise ${result.judge.concise}` : ''
  console.log(`${ok ? '✅' : '❌'} ${c.id.padEnd(32)} ${result.latencyMs !== null ? `${(result.latencyMs / 1000).toFixed(1)}s` : '  — '}${scores}`)
  for (const failure of result.failures) console.log(`     · ${failure}`)
  if (result.judge && !result.judge.pass) console.log(`     · judge: ${result.judge.reason}`)
}

const passed = results.filter((r) => r.failures.length === 0 && (r.judge?.pass ?? true)).length
const snapshot = metrics.snapshot()
console.log(`\n${passed}/${results.length} passed · first-token P50 ${snapshot.llm.copilot.ttftMs.p50 ?? '—'} ms · copilot cost $${snapshot.llm.copilot.costUsd.toFixed(4)} (judge not included)`)

mkdirSync('evals/reports', { recursive: true })
const reportPath = `evals/reports/copilot-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
writeFileSync(reportPath, JSON.stringify({ model: config.models.copilot, mock: args.mock, passed, total: results.length, metrics: snapshot, results }, null, 2))
console.log(`Report: ${reportPath}`)
process.exitCode = passed === results.length ? 0 : 1
