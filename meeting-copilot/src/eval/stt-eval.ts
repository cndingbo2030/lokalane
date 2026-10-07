/**
 * STT eval: streams each evals/stt/*.wav through the configured provider at
 * real-time pace (as in a meeting) and scores the finals against the matching
 * .txt reference with the mixed error rate. Also reports how long after the
 * end of each utterance its final result arrived (finalization lag).
 *
 *   npm run eval:stt -- --languages zh,en
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { parseArgs } from 'node:util'
import { joinText } from '../shared/language.ts'
import type { LanguageCode } from '../shared/protocol.ts'
import { loadConfig, loadDotEnv } from '../server/config.ts'
import { createSttProvider } from '../server/stt/index.ts'
import { aggregate, mixedErrorRate, type ErrorRate } from './errorRate.ts'
import { decodeWav, toPcmFrames } from './wav.ts'

const { values: args } = parseArgs({
  options: {
    dir: { type: 'string', default: 'evals/stt' },
    languages: { type: 'string', default: 'zh,en' },
    speed: { type: 'string', default: '1' },
  },
})

loadDotEnv()
const config = loadConfig()
if (config.sttProvider === 'mock') {
  console.error('No STT provider configured: set SONIOX_API_KEY or DEEPGRAM_API_KEY (and optionally STT_PROVIDER) in .env')
  process.exit(1)
}
const provider = createSttProvider(config)
const languages = args.languages!.split(',').map((l) => l.trim()) as LanguageCode[]
const speed = Math.max(0.5, Number(args.speed) || 1)

const files = readdirSync(args.dir!).filter((f) => f.endsWith('.wav'))
if (files.length === 0) {
  console.error(`No .wav files in ${args.dir}. See evals/stt/README.md.`)
  process.exit(1)
}

interface FileResult extends ErrorRate {
  file: string
  hypothesis: string
  finalizationLagMs: number[]
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function runFile(file: string): Promise<FileResult> {
  const reference = readFileSync(join(args.dir!, file.replace(/\.wav$/, '.txt')), 'utf8')
  const frames = toPcmFrames(decodeWav(new Uint8Array(readFileSync(join(args.dir!, file)))))
  const finals: string[] = []
  const lags: number[] = []
  const started = Date.now()
  const errors: Error[] = []

  const stream = provider.open({
    source: 'remote',
    languages,
    diarize: false,
    onResult: (result) => {
      if (!result.isFinal) return
      finals.push(result.text)
      // Audio for `endMs` was sent at endMs / speed after start; the rest is recognizer lag.
      lags.push(Date.now() - started - result.endMs / speed)
    },
    onError: (error) => errors.push(error),
  })
  for (let i = 0; i < frames.length; i++) {
    stream.write(frames[i])
    const due = started + ((i + 1) * 100) / speed
    await sleep(Math.max(0, due - Date.now()))
  }
  await stream.close()
  if (errors.length) throw errors[0]
  const hypothesis = finals.reduce((text, part) => joinText(text, part), '')
  return { file, hypothesis, finalizationLagMs: lags, ...mixedErrorRate(reference, hypothesis) }
}

console.log(`STT eval: ${provider.name} · languages ${languages.join(',')} · ${files.length} file(s) at ${speed}× real time\n`)
const results: FileResult[] = []
for (const file of files) {
  try {
    const result = await runFile(file)
    results.push(result)
    const lag = [...result.finalizationLagMs].sort((a, b) => a - b)
    const p50 = lag.length ? Math.round(lag[Math.floor(lag.length / 2)]) : null
    console.log(`${basename(file).padEnd(32)} MER ${(result.rate * 100).toFixed(1)}%  (${result.errors}/${result.referenceTokens})  finalization lag P50 ${p50 ?? '—'} ms`)
  } catch (error) {
    console.log(`${basename(file).padEnd(32)} failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const total = aggregate(results)
console.log(`\nCorpus MER ${(total.rate * 100).toFixed(2)}% over ${total.referenceTokens} reference tokens`)
mkdirSync('evals/reports', { recursive: true })
const reportPath = `evals/reports/stt-${provider.name}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
writeFileSync(reportPath, JSON.stringify({ provider: provider.name, languages, speed, total, results }, null, 2))
console.log(`Report: ${reportPath}`)
