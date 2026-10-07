import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientMessage, SessionConfig } from '../../shared/protocol.ts'
import { CopilotConnection, type ConnectionStatus } from './connection.ts'

/** Minimal stand-in for the browser WebSocket. */
class FakeSocket {
  static instances: FakeSocket[] = []
  static readonly OPEN = 1
  readyState = 0
  binaryType = 'blob'
  bufferedAmount = 0
  readonly sent: Array<string | ArrayBuffer> = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null

  constructor(readonly url: string) {
    FakeSocket.instances.push(this)
  }
  send(data: string | ArrayBuffer) {
    this.sent.push(data)
  }
  close() {
    this.readyState = 3
    this.onclose?.()
  }
  // test helpers
  open() {
    this.readyState = 1
    this.onopen?.()
  }
  receive(message: object) {
    this.onmessage?.({ data: JSON.stringify(message) })
  }
  drop() {
    this.readyState = 3
    this.onclose?.()
  }
  json(): ClientMessage[] {
    return this.sent.filter((d): d is string => typeof d === 'string').map((d) => JSON.parse(d) as ClientMessage)
  }
  audio(): number[] {
    return this.sent.filter((d): d is ArrayBuffer => typeof d !== 'string').map((d) => new Uint8Array(d)[0])
  }
}

const config = { platform: 'zoom' } as SessionConfig
const frame = (tag: number) => Uint8Array.from([tag, 0, 0]).buffer

beforeEach(() => {
  vi.useFakeTimers()
  FakeSocket.instances = []
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal('window', globalThis)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function setup() {
  const statuses: ConnectionStatus[] = []
  const messages: string[] = []
  const conn = new CopilotConnection('ws://x/ws', { type: 'start', config }, {
    onStatus: (s) => statuses.push(s),
    onMessage: (m) => messages.push(m.type),
  })
  conn.connect()
  return { conn, statuses, messages, socket: () => FakeSocket.instances.at(-1)! }
}

describe('CopilotConnection', () => {
  it('buffers audio until the session is ready, then replays it in order', () => {
    const { conn, socket, statuses } = setup()
    conn.sendAudio(frame(1))
    socket().open()
    conn.sendAudio(frame(2)) // open but not ready yet
    expect(socket().audio()).toEqual([])
    socket().receive({ type: 'ready', sessionId: 's1', stt: 'x', llm: 'y' })
    expect(statuses.at(-1)).toBe('open')
    expect(socket().audio()).toEqual([1, 2])
    conn.sendAudio(frame(3))
    expect(socket().audio()).toEqual([1, 2, 3])
  })

  it('reconnects after a drop, resumes the session and replays audio captured meanwhile', () => {
    const { conn, socket, statuses } = setup()
    socket().open()
    socket().receive({ type: 'ready', sessionId: 's1', stt: 'x', llm: 'y' })
    socket().drop()
    expect(statuses.at(-1)).toBe('reconnecting')

    for (let i = 10; i < 50; i++) conn.sendAudio(frame(i)) // 40 frames during the outage
    vi.advanceTimersByTime(600)
    const second = socket()
    second.open()
    expect(second.json()[0]).toMatchObject({ type: 'start', resumeSessionId: 's1' })
    second.receive({ type: 'ready', sessionId: 's1', stt: 'x', llm: 'y', resumed: true })
    // Replay is paced (20 frames per tick); live audio queues behind it.
    expect(second.audio()).toHaveLength(20)
    conn.sendAudio(frame(99))
    vi.advanceTimersByTime(250)
    vi.advanceTimersByTime(250)
    expect(second.audio()).toEqual([...Array.from({ length: 40 }, (_, i) => i + 10), 99])
  })

  it('caps the backlog during a long outage', () => {
    const { conn, socket } = setup()
    socket().open()
    socket().receive({ type: 'ready', sessionId: 's1', stt: 'x', llm: 'y' })
    socket().drop()
    for (let i = 0; i < 1_600; i++) conn.sendAudio(frame(i % 250))
    expect(conn.lostFrames).toBe(100)
  })

  it('tells the server to end the meeting on close and stops reconnecting', () => {
    const { conn, socket, statuses } = setup()
    socket().open()
    socket().receive({ type: 'ready', sessionId: 's1', stt: 'x', llm: 'y' })
    const s = socket()
    conn.close()
    expect(s.json().at(-1)).toEqual({ type: 'leave' })
    vi.advanceTimersByTime(20_000)
    expect(FakeSocket.instances).toHaveLength(1)
    expect(statuses.at(-1)).toBe('closed')
  })
})
