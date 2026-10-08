/**
 * Minimal client for Attendee (https://attendee.dev), an open-source meeting-bot
 * API for Zoom, Google Meet and Microsoft Teams. Hosted or self-hosted: only the
 * base URL changes.
 */

export interface AttendeeBot {
  id: string
  state: string
  events?: Array<{ type: string; sub_type?: string | null; created_at?: string }>
  recording_state?: string
}

export interface CreateBotRequest {
  meeting_url: string
  bot_name: string
  websocket_settings: { audio: { url: string; sample_rate: 16_000 } }
  bot_chat_message?: { to: 'everyone'; message: string }
  recording_settings?: { format: 'mp3' | 'mp4' | 'none' }
  automatic_leave_settings?: {
    only_participant_in_meeting_timeout_seconds?: number
    waiting_room_timeout_seconds?: number
    wait_for_host_to_start_meeting_timeout_seconds?: number
    silence_timeout_seconds?: number
    silence_activate_after_seconds?: number
    max_uptime_seconds?: number
  }
  metadata?: Record<string, string>
  deduplication_key?: string
}

export class AttendeeError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
}

export interface AttendeeOptions {
  apiKey: string
  baseUrl: string
  fetch?: typeof fetch
  timeoutMs?: number
}

export class AttendeeClient {
  private readonly baseUrl: string

  constructor(private readonly options: AttendeeOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
  }

  createBot(request: CreateBotRequest): Promise<AttendeeBot> {
    return this.request<AttendeeBot>('POST', '/api/v1/bots', request)
  }

  getBot(id: string): Promise<AttendeeBot> {
    return this.request<AttendeeBot>('GET', `/api/v1/bots/${encodeURIComponent(id)}`)
  }

  async leave(id: string): Promise<void> {
    await this.request('POST', `/api/v1/bots/${encodeURIComponent(id)}/leave`)
  }

  /** Short-lived download URL of the bot's recording, or null when there is none. */
  async recordingUrl(id: string): Promise<string | null> {
    const recording = await this.request<{ url?: unknown }>('GET', `/api/v1/bots/${encodeURIComponent(id)}/recording`)
    return typeof recording?.url === 'string' && /^https:\/\//.test(recording.url) ? recording.url : null
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let response: Response
    try {
      response = await (this.options.fetch ?? fetch)(`${this.baseUrl}${path}`, {
        method,
        headers: { authorization: `Token ${this.options.apiKey}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 15_000),
      })
    } catch (error) {
      throw new AttendeeError(`无法连接会议机器人服务：${error instanceof Error ? error.message : String(error)}`)
    }
    const text = await response.text()
    if (!response.ok) throw new AttendeeError(describeError(response.status, text), response.status)
    if (!text) return undefined as T
    try {
      return JSON.parse(text) as T
    } catch {
      throw new AttendeeError('会议机器人服务返回了无法解析的内容', response.status)
    }
  }
}

/** Attendee answers validation errors as {field: [messages]} or {error: message}. */
function describeError(status: number, text: string): string {
  if (status === 401 || status === 403) return '会议机器人服务拒绝访问：请检查 ATTENDEE_API_KEY'
  if (status === 429) return '会议机器人服务繁忙，请稍后再试'
  let detail: string
  try {
    detail = firstMessage(JSON.parse(text) as unknown)
  } catch {
    detail = text.length < 200 ? text : ''
  }
  return `会议机器人服务返回错误（HTTP ${status}）${detail ? `：${detail}` : ''}`
}

function firstMessage(value: unknown): string {
  if (typeof value === 'string') return value.slice(0, 300)
  if (Array.isArray(value)) return value.length ? firstMessage(value[0]) : ''
  if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      const message = firstMessage(inner)
      if (message) return key === 'error' || key === 'detail' || key === 'non_field_errors' ? message : `${key}: ${message}`
    }
  }
  return ''
}
