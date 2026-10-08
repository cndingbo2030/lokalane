/**
 * Pre-meeting check: `npm run preflight` in the meeting-copilot directory.
 *
 * Checks Node, .env, shell variables that would silently override it and a server
 * already running, then makes real, tiny calls with the configured keys: one Claude
 * request per configured model, and a short spoken English sentence (macOS `say`)
 * streamed through the speech-to-text provider. Prints no secrets. Exits 1 when
 * something must be fixed before the meeting.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig, loadDotEnv } from '../server/config.ts'
import { AnthropicLlm } from '../server/llm/anthropic.ts'
import {
  checkClaude,
  checkStt,
  configChecks,
  envFile,
  nodeVersion,
  runningServer,
  shellOverrides,
  summarize,
  type CheckResult,
  type SpeechSample,
} from '../server/preflight.ts'
import { createSttProvider } from '../server/stt/index.ts'
import { decodeWav, toPcmFrames } from './wav.ts'

const SAMPLE_TEXT = 'Hello, this is the meeting copilot preflight check.'
const ICONS = { ok: '✅', warn: '⚠️ ', fail: '❌' } as const

// Captured before .env is loaded: the shell's own values are the ones that win.
const shell = { ...process.env }
const dotenvText = existsSync('.env') ? readFileSync('.env', 'utf8') : null
loadDotEnv()
const config = loadConfig()

const results: CheckResult[] = []
function show(result: CheckResult): void {
  results.push(result)
  console.log(`${ICONS[result.status]} ${result.title}`)
  if (result.detail) console.log(`   ${result.detail}`)
}

const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Singapore', hour12: false })
console.log(`🩺 会前自检 · meeting-copilot ${commit()} · ${now} SGT\n`)
show(nodeVersion())
show(envFile(dotenvText))
shellOverrides(dotenvText, shell).forEach(show)
configChecks(config, process.env).forEach(show)
show(await runningServer(config.port))

if (config.anthropicConfigured) {
  const llm = new AnthropicLlm()
  for (const model of new Set(Object.values(config.models))) {
    console.log(`⏳ 正在测试 Claude ${model}…`)
    show(await checkClaude(llm, model))
  }
}
if (config.sttProvider !== 'mock') {
  const sample = speechSample()
  console.log(`⏳ 正在测试 ${config.sttProvider}${sample ? '：实时播放一句英文测试语音，约 5 秒' : ''}…`)
  show(await checkStt(createSttProvider(config), sample))
}

const { failed, warned } = summarize(results)
console.log(
  failed > 0
    ? `\n❌ 有 ${failed} 项需要处理（见上面的 ❌），处理后再运行一次 npm run preflight`
    : warned > 0
      ? `\n⚠️  可以开会，但有 ${warned} 项值得留意`
      : '\n✅ 全部通过，可以开会',
)
process.exitCode = failed > 0 ? 1 : 0
// Idle keep-alive sockets must not hold the terminal.
setTimeout(() => process.exit(), 1_000).unref()

/** A short English sentence spoken by macOS `say`, as 16 kHz PCM frames; null where `say` is missing. */
function speechSample(): SpeechSample | null {
  const file = join(tmpdir(), `meeting-copilot-preflight-${process.pid}.wav`)
  try {
    execFileSync('say', ['-o', file, '--file-format=WAVE', '--data-format=LEI16@16000', SAMPLE_TEXT], { stdio: 'ignore', timeout: 15_000 })
    return { frames: toPcmFrames(decodeWav(new Uint8Array(readFileSync(file)))), text: SAMPLE_TEXT }
  } catch {
    return null
  } finally {
    rmSync(file, { force: true })
  }
}

function commit(): string {
  try {
    return execFileSync('git', ['log', '-1', '--format=%h'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}
