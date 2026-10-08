import { randomBytes } from 'node:crypto'
import type { RawData, WebSocket } from 'ws'
import type { BotStatus } from '../../shared/protocol.ts'
import type { AttendeeBot, AttendeeClient } from './attendee.ts'
import { BotAudioIngest } from './ingest.ts'
import type { BotHandle, BotLauncher, BotLaunchOptions } from './types.ts'

const TERMINAL = new Set(['ended', 'fatal_error', 'data_deleted'])
const MAX_POLL_FAILURES = 20

export interface BotManagerOptions {
  client: AttendeeClient
  /** The public wss:// URL the bot service streams audio to, for a bot's secret key. */
  audioUrl: (key: string) => string
  /** Poll intervals: before the bot is in the meeting, and while it records. */
  pollMs?: { joining: number; joined: number }
  log?: (message: string) => void
}

/**
 * Sends meeting bots (via Attendee) and connects their realtime audio back to
 * the meeting session. Each bot gets a random key: its audio WebSocket is
 * accepted only with that key, so nobody else can inject audio into a meeting.
 */
export class BotManager implements BotLauncher {
  private readonly bots = new Map<string, ManagedBot>()

  constructor(private readonly options: BotManagerOptions) {}

  launch(launch: BotLaunchOptions): BotHandle {
    const key = randomBytes(24).toString('base64url')
    const bot = new ManagedBot(key, launch, this.options, () => this.bots.delete(key))
    this.bots.set(key, bot)
    bot.start()
    return bot
  }

  /** Called for /ws/bot upgrades; undefined (reject) unless the key belongs to a live bot. */
  botForKey(key: string | null): ManagedBot | undefined {
    return key ? this.bots.get(key) : undefined
  }

  get size(): number {
    return this.bots.size
  }

  disposeAll(): void {
    for (const bot of [...this.bots.values()]) bot.dispose()
  }
}

export class ManagedBot implements BotHandle {
  private id: string | null = null
  private state = 'requested'
  private detail: string | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private socket: WebSocket | null = null
  private failures = 0
  private leaveWanted = false
  private leaveSent = false
  private disposed = false
  private finished = false
  private readonly ingest: BotAudioIngest

  constructor(
    readonly key: string,
    private readonly launch: BotLaunchOptions,
    private readonly options: BotManagerOptions,
    private readonly onFinished: () => void,
  ) {
    this.ingest = new BotAudioIngest({
      meetingNowMs: launch.meetingNowMs,
      onFrame: (pcm, captureMs) => {
        if (!this.disposed) launch.onAudio(pcm, captureMs)
      },
    })
  }

  start(): void {
    this.report({ state: 'requested' })
    void this.create()
  }

  /** The bot service connected (or reconnected) its audio stream. */
  attachSocket(ws: WebSocket): void {
    if (this.socket && this.socket !== ws) this.socket.close(1000, 'replaced')
    this.socket = ws
    ws.on('message', (data: RawData, isBinary: boolean) => {
      if (isBinary || this.disposed) return
      try {
        this.ingest.push(JSON.parse(data.toString()))
      } catch {
        // Malformed message: skip it, keep the stream.
      }
    })
    ws.on('close', () => {
      if (this.socket === ws) this.socket = null
    })
    ws.on('error', () => {})
  }

  async leave(): Promise<void> {
    this.leaveWanted = true
    // Still being created: leave() runs again as soon as the bot has an id.
    if (!this.id || this.leaveSent || TERMINAL.has(this.state) || this.state === 'leaving' || this.state === 'post_processing') return
    this.leaveSent = true
    try {
      await this.options.client.leave(this.id)
    } catch (error) {
      this.leaveSent = false
      this.options.log?.(`[bot] leave failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    void this.leave()
    this.finish()
  }

  private async create(): Promise<void> {
    const { client } = this.options
    try {
      const bot = await client.createBot({
        meeting_url: this.launch.meetingUrl,
        bot_name: this.launch.botName,
        websocket_settings: { audio: { url: this.options.audioUrl(this.key), sample_rate: 16_000 } },
        bot_chat_message: { to: 'everyone', message: this.launch.chatMessage },
        // Audio-only recording: what the user downloads after the meeting.
        recording_settings: { format: 'mp3' },
        automatic_leave_settings: { waiting_room_timeout_seconds: 600, max_uptime_seconds: 4 * 3600 },
        metadata: { app: 'meeting-copilot', session: this.launch.sessionId },
        deduplication_key: `meeting-copilot-${this.launch.sessionId}`,
      })
      this.id = bot.id
      if (this.leaveWanted) await this.leave()
      if (this.disposed) return
      this.update(bot)
      this.schedulePoll()
    } catch (error) {
      if (!this.disposed) this.report({ state: 'fatal_error', detail: error instanceof Error ? error.message : String(error) })
      this.finish()
    }
  }

  private schedulePoll(): void {
    if (this.finished) return
    const { joining = 3_000, joined = 10_000 } = this.options.pollMs ?? {}
    const delay = this.state.startsWith('joined_') && !this.leaveWanted ? joined : joining
    this.timer = setTimeout(() => void this.poll(), delay)
  }

  private async poll(): Promise<void> {
    if (this.finished || !this.id) return
    try {
      const bot = await this.options.client.getBot(this.id)
      this.failures = 0
      this.update(bot)
      if (TERMINAL.has(bot.state)) return void (await this.terminal(bot))
    } catch (error) {
      if (++this.failures >= MAX_POLL_FAILURES) {
        this.report({ state: 'fatal_error', detail: `无法获取机器人状态：${error instanceof Error ? error.message : String(error)}` })
        void this.leave()
        return this.finish()
      }
    }
    this.schedulePoll()
  }

  private update(bot: AttendeeBot): void {
    const detail = bot.events?.at(-1)?.sub_type || undefined
    if (bot.state === this.state && detail === this.detail) return
    this.state = bot.state
    this.detail = detail
    this.report({ state: bot.state, detail })
  }

  private async terminal(bot: AttendeeBot): Promise<void> {
    if (bot.state === 'ended' && bot.recording_state === 'complete' && this.id) {
      try {
        const recordingUrl = await this.options.client.recordingUrl(this.id)
        if (recordingUrl) this.report({ state: 'ended', detail: this.detail, recordingUrl })
      } catch (error) {
        this.options.log?.(`[bot] recording unavailable: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    this.finish()
  }

  private report(status: BotStatus): void {
    if (!this.disposed) this.launch.onStatus(status)
  }

  private finish(): void {
    if (this.finished) return
    this.finished = true
    clearTimeout(this.timer)
    this.socket?.close(1000, 'bot finished')
    this.socket = null
    this.onFinished()
  }
}
