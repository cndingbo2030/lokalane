import { resolve } from 'node:path'
import { createCopilotServer } from './app.ts'
import { loadConfig, loadDotEnv } from './config.ts'

loadDotEnv()
const config = loadConfig()
const copilot = createCopilotServer({ config, staticDir: config.production ? resolve('dist') : undefined })
const port = await copilot.listen(config.port)

console.log(`meeting-copilot server on http://localhost:${port}`)
console.log(`  STT: ${copilot.stt.name}${copilot.stt.name === 'mock' ? ' (set SONIOX_API_KEY or DEEPGRAM_API_KEY for real transcription)' : ''}`)
console.log(`  LLM: ${copilot.llm.name}${copilot.llm.name === 'mock' ? ' (set ANTHROPIC_API_KEY for real translation and suggestions)' : ` (${config.models.copilot})`}`)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void copilot.close().finally(() => process.exit(0))
  })
}
