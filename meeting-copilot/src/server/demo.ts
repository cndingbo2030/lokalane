import type { AudioSource } from '../shared/protocol.ts'
import type { SttResult } from './stt/types.ts'

export interface DemoLine {
  source: AudioSource
  speaker?: string
  language: string
  text: string
  /** Pause before this line starts, ms. */
  gapMs: number
}

/** A short cross-border sales call (zh/en code-switching) used for demos and smoke tests. */
export const DEMO_SCRIPT: DemoLine[] = [
  { source: 'remote', speaker: 'S1', language: 'en', gapMs: 600, text: "Hi, thanks for making the time. We looked at your legal AI platform last week." },
  { source: 'me', language: 'zh', gapMs: 900, text: '谢谢，今天想先了解一下你们团队目前的合同审核流程。' },
  { source: 'remote', speaker: 'S1', language: 'en', gapMs: 900, text: 'Sure. We review about two hundred vendor contracts a month, mostly manually.' },
  { source: 'remote', speaker: 'S2', language: 'zh', gapMs: 900, text: '我比较关心的是，你们的数据是存在新加坡本地的吗？' },
  { source: 'me', language: 'zh', gapMs: 1200, text: '是的，我们可以部署在新加坡区域。' },
  { source: 'remote', speaker: 'S1', language: 'en', gapMs: 900, text: "Honestly, the quote you sent is a bit too expensive for our budget this year." },
  { source: 'remote', speaker: 'S1', language: 'en', gapMs: 1500, text: 'Could you walk me through what is included in the enterprise plan?' },
]

/**
 * Plays the script as STT results: words appear progressively as partials and
 * each line ends with a final, exactly like a live recognizer.
 */
export function playDemo(
  emit: (source: AudioSource, result: SttResult) => void,
  options: { script?: DemoLine[]; msPerToken?: number; signal?: AbortSignal } = {},
): Promise<void> {
  const script = options.script ?? DEMO_SCRIPT
  const msPerToken = options.msPerToken ?? 110
  let clock = 0

  return (async () => {
    for (const line of script) {
      if (options.signal?.aborted) return
      await sleep(line.gapMs, options.signal)
      clock += line.gapMs
      const tokens = tokenize(line.text)
      const startMs = clock
      for (let i = 1; i <= tokens.length; i++) {
        if (options.signal?.aborted) return
        await sleep(msPerToken, options.signal)
        clock += msPerToken
        const isFinal = i === tokens.length
        emit(line.source, {
          text: tokens.slice(0, i).join(''),
          isFinal,
          speaker: line.speaker,
          language: line.language,
          startMs,
          endMs: clock,
        })
      }
    }
  })()
}

function tokenize(text: string): string[] {
  // Latin words keep their trailing space; CJK splits into 2-character chunks.
  return text.match(/[A-Za-z0-9'’.,?!-]+\s*|[^A-Za-z0-9\s]{1,2}\s*|\s+/g) ?? [text]
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0 || signal?.aborted) return resolve()
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
  })
}
