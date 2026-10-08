import { resolve } from 'node:path'
import { createCopilotServer } from './app.ts'
import { loadConfig, loadDotEnv } from './config.ts'

loadDotEnv()
const config = loadConfig()
const copilot = createCopilotServer({ config, staticDir: config.production ? resolve('dist') : undefined })
const port = await copilot.listen(config.port)

console.log(`meeting-copilot server on http://localhost:${port}`)
const sttNote =
  copilot.stt.name === 'mock'
    ? ' (set SONIOX_API_KEY or DEEPGRAM_API_KEY for real transcription)'
    : copilot.stt.name === 'soniox' && config.sonioxMaxEndpointDelayMs
      ? ` (max endpoint delay ${config.sonioxMaxEndpointDelayMs} ms)`
      : ''
console.log(`  STT: ${copilot.stt.name}${sttNote}`)
if (process.env.SONIOX_MAX_ENDPOINT_DELAY_MS && !config.sonioxMaxEndpointDelayMs) {
  console.warn('  SONIOX_MAX_ENDPOINT_DELAY_MS ignored: use a whole number from 500 to 3000')
}
console.log(`  LLM: ${copilot.llm.name}${copilot.llm.name === 'mock' ? ' (set ANTHROPIC_API_KEY for real translation and suggestions)' : ` (${config.models.copilot})`}`)

// Docker and process managers send SIGTERM: end meetings cleanly (bots leave, sockets close),
// but never hang a deploy on a stuck connection.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    console.log(`${signal}: shutting down`)
    setTimeout(() => process.exit(1), 10_000).unref()
    void copilot.close().finally(() => process.exit(0))
  })
}
