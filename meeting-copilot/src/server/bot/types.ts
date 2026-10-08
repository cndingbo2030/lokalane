import type { BotStatus, LanguageCode } from '../../shared/protocol.ts'

export interface BotLaunchOptions {
  sessionId: string
  meetingUrl: string
  botName: string
  /** Posted in the meeting chat when the bot joins (consent notice). */
  chatMessage: string
  /** Milliseconds since the session started, for timestamping the bot's audio. */
  meetingNowMs: () => number
  onAudio: (pcm: Int16Array, captureMs: number) => void
  onStatus: (status: BotStatus) => void
}

export interface BotHandle {
  /** Ask the bot to leave the meeting; status updates continue until it has left. */
  leave(): Promise<void>
  /** The session is gone: make the bot leave, stop polling and drop its audio socket. */
  dispose(): void
}

export interface BotLauncher {
  launch(options: BotLaunchOptions): BotHandle
}

export const DEFAULT_BOT_NAME = 'Meeting Copilot'

export function sanitizeBotName(name: unknown): string {
  const clean = typeof name === 'string' ? name.replace(/[\p{Cc}<>]/gu, '').trim().slice(0, 60) : ''
  return clean || DEFAULT_BOT_NAME
}

/**
 * Consent notice for the meeting chat. Plain text without emoji (not supported
 * by the bot service) on one line (Enter would send early in some chat boxes).
 */
export function botChatMessage(botName: string, spokenLanguages: LanguageCode[]): string {
  const zh = `您好，我是 ${botName}，正在为参会人记录本次会议（录音、转写、翻译和 AI 纪要）。如不同意，请告知主持人将我移出会议。`
  const en = `Hi, I'm ${botName}. I'm recording and transcribing this meeting to produce notes for a participant. If you'd rather not be recorded, please ask the host to remove me.`
  const hasChinese = spokenLanguages.includes('zh')
  const hasOther = spokenLanguages.some((l) => l !== 'zh')
  if (hasChinese && !hasOther) return zh
  if (!hasChinese) return en
  return `${zh} / ${en}`
}
