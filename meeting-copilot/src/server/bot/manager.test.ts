import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import type { WebSocket } from 'ws'
import type { BotStatus } from '../../shared/protocol.ts'
import type { AttendeeBot, AttendeeClient, CreateBotRequest } from './attendee.ts'
import { BotManager } from './manager.ts'
import type { BotLaunchOptions } from './types.ts'

/** Scripted bot service: each getBot() returns the next state. */
class FakeAttendee {
  readonly created: CreateBotRequest[] = []
  readonly left: string[] = []
  createDelay = 0
  failCreate: Error | null = null
  constructor(private readonly states: Array<Partial<AttendeeBot>>) {}

  async createBot(request: CreateBotRequest): Promise<AttendeeBot> {
    this.created.push(request)
    await new Promise((r) => setTimeout(r, this.createDelay))
    if (this.failCreate) throw this.failCreate
    return { id: 'bot_1', state: 'joining' }
  }
  async getBot(id: string): Promise<AttendeeBot> {
    return { id, state: 'joining', ...(this.states.length > 1 ? this.states.shift() : this.states[0]) }
  }
  async leave(id: string): Promise<void> {
    this.left.push(id)
  }
  async recordingUrl(): Promise<string | null> {
    return 'https://s3.example.com/rec.mp3'
  }
}

async function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 2))
  }
}

function setup(states: Array<Partial<AttendeeBot>>) {
  const attendee = new FakeAttendee(states)
  const manager = new BotManager({
    client: attendee as unknown as AttendeeClient,
    audioUrl: (key) => `wss://copilot.example.com/ws/bot?key=${key}`,
    pollMs: { joining: 2, joined: 2 },
  })
  const statuses: BotStatus[] = []
  const audio: number[] = []
  const options: BotLaunchOptions = {
    sessionId: 'sess-1',
    meetingUrl: 'https://zoom.us/j/123',
    botName: 'Meeting Copilot',
    chatMessage: 'Hi',
    meetingNowMs: () => 1_000,
    onAudio: (_pcm, captureMs) => audio.push(captureMs),
    onStatus: (status) => statuses.push(status),
  }
  return { attendee, manager, statuses, audio, options }
}

describe('BotManager', () => {
  it('sends a bot, reports its states and streams its audio into the meeting', async () => {
    const { attendee, manager, statuses, audio, options } = setup([{ state: 'waiting_room' }, { state: 'joined_recording' }])
    manager.launch(options)
    expect(statuses[0]).toEqual({ state: 'requested' })
    await waitFor(() => statuses.some((s) => s.state === 'joined_recording'))
    expect(statuses.map((s) => s.state)).toEqual(['requested', 'joining', 'waiting_room', 'joined_recording'])

    const request = attendee.created[0]
    expect(request).toMatchObject({
      meeting_url: 'https://zoom.us/j/123',
      bot_name: 'Meeting Copilot',
      bot_chat_message: { to: 'everyone', message: 'Hi' },
      recording_settings: { format: 'mp3' },
      deduplication_key: 'meeting-copilot-sess-1',
    })
    const key = new URL(request.websocket_settings.audio.url).searchParams.get('key')!
    expect(key.length).toBeGreaterThanOrEqual(32)
    expect(manager.botForKey('wrong')).toBeUndefined()

    const socket = new EventEmitter() as unknown as WebSocket
    Object.assign(socket, { close: () => {} })
    manager.botForKey(key)!.attachSocket(socket)
    const chunk = Buffer.from(new Int16Array(1600).fill(9_000).buffer).toString('base64')
    for (let i = 0; i < 3; i++) {
      socket.emit('message', Buffer.from(JSON.stringify({ trigger: 'realtime_audio.mixed', data: { chunk, sample_rate: 16_000, timestamp_ms: 10_000 + i * 100 } })), false)
    }
    socket.emit('message', Buffer.from('not json'), false)
    expect(audio).toEqual([900, 1000, 1100])
  })

  it('leaves on request, then reports the recording once the bot has ended', async () => {
    const { attendee, manager, statuses, options } = setup([
      { state: 'joined_recording' },
      { state: 'leaving' },
      { state: 'post_processing' },
      { state: 'ended', recording_state: 'complete', events: [{ type: 'bot_left_meeting', sub_type: null }] },
    ])
    const bot = manager.launch(options)
    await waitFor(() => statuses.some((s) => s.state === 'joined_recording'))
    await bot.leave()
    await bot.leave()
    expect(attendee.left).toEqual(['bot_1'])
    await waitFor(() => statuses.some((s) => s.recordingUrl))
    expect(statuses.at(-1)).toEqual({ state: 'ended', detail: undefined, recordingUrl: 'https://s3.example.com/rec.mp3' })
    expect(manager.size).toBe(0)
  })

  it('makes a bot that is still being created leave once it exists, silently', async () => {
    const { attendee, manager, statuses, options } = setup([{ state: 'joining' }])
    attendee.createDelay = 20
    const bot = manager.launch(options)
    bot.dispose()
    expect(manager.size).toBe(0)
    await waitFor(() => attendee.left.length > 0)
    expect(statuses).toEqual([{ state: 'requested' }])
  })

  it('reports a failed launch', async () => {
    const { attendee, manager, statuses, options } = setup([])
    attendee.failCreate = new Error('会议机器人服务返回错误（HTTP 400）：meeting_url: Invalid meeting URL')
    manager.launch(options)
    await waitFor(() => statuses.length === 2)
    expect(statuses[1]).toEqual({ state: 'fatal_error', detail: '会议机器人服务返回错误（HTTP 400）：meeting_url: Invalid meeting URL' })
    expect(manager.size).toBe(0)
  })
})
