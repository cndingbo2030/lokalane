import { createHmac } from 'node:crypto'
import { INTEGRATION_TYPES, type DeliveryPayload, type DeliveryRequest, type DeliveryTarget, type IntegrationType } from '../shared/delivery.ts'
import { LANGUAGE_NAMES } from '../shared/language.ts'
import type { ActionItem, MeetingOutcomes } from '../shared/outcomes.ts'
import { ClientError } from './errors.ts'
import { normalizeUrl, safeFetch, type SafeFetchOptions, type SafeResponse } from './net/safeFetch.ts'

/**
 * Pushes meeting results (TL;DR, decisions, action items) to team chat or any
 * webhook. Runs on the server because none of these webhooks allow browser
 * (CORS) requests; every call goes through the SSRF-safe fetch.
 */

export class DeliveryError extends ClientError {}

interface Labels {
  heading: string
  test: string
  tldr: string
  decisions: string
  actionItems: string
  due: string
  none: string
  attendees: (n: number) => string
  footer: string
}

const LABELS: Record<'zh' | 'en', Labels> = {
  zh: {
    heading: '会议纪要',
    test: '测试',
    tldr: '一句话总结',
    decisions: '已达成的决定',
    actionItems: '待办事项',
    due: '截止',
    none: '无',
    attendees: (n) => `${n} 位参会人`,
    footer: '由 Meeting Copilot 生成',
  },
  en: {
    heading: 'Meeting notes',
    test: 'Test',
    tldr: 'TL;DR',
    decisions: 'Decisions',
    actionItems: 'Action items',
    due: 'due',
    none: 'None',
    attendees: (n) => `${n} attendees`,
    footer: 'Sent from Meeting Copilot',
  },
}

/** Platform-neutral content; each renderer turns it into that platform's format. */
interface Digest {
  title: string
  subtitle: string
  sections: Array<{ heading: string; items: string[]; list: 'ordered' | 'bullet' | 'none' }>
  footer: string
}

export function buildDigest(payload: DeliveryPayload): Digest {
  const labels = LABELS[payload.language === 'zh' ? 'zh' : 'en']
  const { decisions, actionItems } = payload.outcomes
  const sections: Digest['sections'] = []
  if (payload.tldr) sections.push({ heading: labels.tldr, items: [payload.tldr], list: 'none' })
  sections.push({ heading: labels.decisions, items: decisions.length ? decisions : [labels.none], list: decisions.length ? 'ordered' : 'none' })
  sections.push({
    heading: labels.actionItems,
    items: actionItems.length ? actionItems.map((item) => actionLine(item, labels)) : [labels.none],
    list: actionItems.length ? 'bullet' : 'none',
  })
  return {
    // Starts with "会议纪要" so DingTalk / Feishu keyword security can match on it.
    title: `${labels.heading}｜${payload.test ? `[${labels.test}] ` : ''}${payload.title}`,
    subtitle: [payload.when, payload.attendees.length ? labels.attendees(payload.attendees.length) : ''].filter(Boolean).join(' · '),
    sections,
    footer: labels.footer,
  }
}

function actionLine(item: ActionItem, labels: Labels): string {
  return `${item.done ? '☑' : '☐'} ${item.owner} · ${item.task}${item.due ? ` · ${labels.due} ${item.due}` : ''}`
}

function listLines(section: Digest['sections'][number], escape: (s: string) => string, bullet = '-', newline = '\n'): string {
  return section.items
    .map((item, i) => `${section.list === 'ordered' ? `${i + 1}. ` : section.list === 'bullet' ? `${bullet} ` : ''}${escape(item)}`)
    .join(newline)
}

const slackEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
/** Feishu `<at id=all>` and WeCom `<@all>` would notify the whole group; transcript text must never do that. */
const neutralizeMentions = (s: string) => s.replace(/<(?=\s*(at\b|@))/gi, '＜')

interface FormattedRequest {
  url: string
  headers: Record<string, string>
  body: string
}

export function formatDelivery(target: DeliveryTarget, url: URL, payload: DeliveryPayload, now: number): FormattedRequest {
  const headers = { 'content-type': 'application/json; charset=utf-8' }
  const d = buildDigest(payload)
  switch (target.type) {
    case 'slack': {
      const blocks = [
        { type: 'header', text: { type: 'plain_text', text: truncateChars(d.title, 150), emoji: true } },
        ...(d.subtitle ? [{ type: 'context', elements: [{ type: 'mrkdwn', text: slackEscape(d.subtitle) }] }] : []),
        ...d.sections.map((s) => ({
          type: 'section',
          text: { type: 'mrkdwn', text: truncateChars(`*${slackEscape(s.heading)}*\n${listLines(s, slackEscape, '•')}`, 3000) },
        })),
        { type: 'context', elements: [{ type: 'mrkdwn', text: slackEscape(d.footer) }] },
      ]
      const text = truncateChars([d.title, payload.tldr].filter(Boolean).join('\n'), 3000)
      return { url: url.toString(), headers, body: JSON.stringify({ text: slackEscape(text), blocks }) }
    }
    case 'teams': {
      const block = (text: string, extra: Record<string, unknown> = {}) => ({ type: 'TextBlock', text, wrap: true, ...extra })
      const body = [
        block(d.title, { size: 'Large', weight: 'Bolder' }),
        ...(d.subtitle ? [block(d.subtitle, { isSubtle: true, spacing: 'None' })] : []),
        ...d.sections.flatMap((s) => [block(s.heading, { weight: 'Bolder', spacing: 'Medium' }), block(truncateBytes(listLines(s, (x) => x, '-', '\r'), 8_000))]),
        block(d.footer, { isSubtle: true, size: 'Small', spacing: 'Medium' }),
      ]
      // Teams "Workflows" webhooks (the replacement for Office 365 connectors) take an Adaptive Card.
      const message = {
        type: 'message',
        attachments: [
          {
            contentType: 'application/vnd.microsoft.card.adaptive',
            contentUrl: null,
            content: { $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4', body },
          },
        ],
      }
      return { url: url.toString(), headers, body: JSON.stringify(message) }
    }
    case 'feishu': {
      const content = [d.subtitle, ...d.sections.map((s) => `**${neutralizeMentions(s.heading)}**\n${listLines(s, neutralizeMentions)}`)].filter(Boolean).join('\n\n')
      const card = {
        config: { wide_screen_mode: true },
        header: { template: 'blue', title: { tag: 'plain_text', content: truncateChars(d.title, 100) } },
        elements: [
          { tag: 'markdown', content: truncateBytes(content, 15_000) },
          { tag: 'note', elements: [{ tag: 'plain_text', content: d.footer }] },
        ],
      }
      const seconds = Math.floor(now / 1000)
      const signature = target.secret ? { timestamp: String(seconds), sign: feishuSign(target.secret, seconds) } : {}
      return { url: url.toString(), headers, body: JSON.stringify({ ...signature, msg_type: 'interactive', card }) }
    }
    case 'dingtalk': {
      const sections = d.sections.map((s) => `**${s.heading}**\n\n${listLines(s, (x) => x)}`).join('\n\n')
      const text = [`### ${d.title}`, d.subtitle, truncateBytes(sections, 15_000), `> ${d.footer}`].filter(Boolean).join('\n\n')
      const signed = new URL(url)
      if (target.secret) {
        signed.searchParams.set('timestamp', String(now))
        signed.searchParams.set('sign', dingtalkSign(target.secret, now))
      }
      return { url: signed.toString(), headers, body: JSON.stringify({ msgtype: 'markdown', markdown: { title: truncateChars(d.title, 60), text } }) }
    }
    case 'wecom': {
      const head = `### ${neutralizeMentions(d.title)}${d.subtitle ? `\n<font color="comment">${neutralizeMentions(d.subtitle)}</font>` : ''}`
      const footer = `<font color="comment">${d.footer}</font>`
      const sections = d.sections.map((s) => `**${neutralizeMentions(s.heading)}**\n${listLines(s, neutralizeMentions)}`).join('\n\n')
      // WeCom rejects markdown content over 4096 bytes.
      const room = 4_000 - byteLength(head) - byteLength(footer) - 4
      return { url: url.toString(), headers, body: JSON.stringify({ msgtype: 'markdown', markdown: { content: `${head}\n\n${truncateBytes(sections, room)}\n\n${footer}` } }) }
    }
    case 'json': {
      const body = JSON.stringify({
        event: 'meeting.outcomes',
        test: payload.test ?? false,
        sentAt: new Date(now).toISOString(),
        meeting: { title: payload.title, startedAt: payload.startedAt, endedAt: payload.endedAt ?? null, attendees: payload.attendees },
        language: payload.language,
        tldr: payload.tldr ?? null,
        summary: payload.summary ?? null,
        ...payload.outcomes,
      })
      const seconds = Math.floor(now / 1000)
      const signature: Record<string, string> = target.secret
        ? { 'x-meeting-copilot-timestamp': String(seconds), 'x-meeting-copilot-signature': jsonSignature(target.secret, seconds, body) }
        : {}
      return { url: url.toString(), headers: { ...headers, ...signature }, body }
    }
  }
}

/** Feishu custom bot "签名校验": HMAC-SHA256 keyed by "timestamp\nsecret" over an empty message. */
export function feishuSign(secret: string, timestampSeconds: number): string {
  return createHmac('sha256', `${timestampSeconds}\n${secret}`).update('').digest('base64')
}

/** DingTalk custom robot "加签": HMAC-SHA256 keyed by the secret over "timestamp\nsecret". */
export function dingtalkSign(secret: string, timestampMs: number): string {
  return createHmac('sha256', secret).update(`${timestampMs}\n${secret}`).digest('base64')
}

/** Generic webhook: verify with HMAC-SHA256(secret, `${timestamp}.${rawBody}`) and reject stale timestamps. */
export function jsonSignature(secret: string, timestampSeconds: number, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestampSeconds}.${body}`).digest('hex')}`
}

const KNOWN_HOSTS: Partial<Record<IntegrationType, { hosts: string[]; path: RegExp; query?: string; example: string }>> = {
  slack: { hosts: ['hooks.slack.com', 'hooks.slack-gov.com'], path: /^\/services\/.+/, example: 'https://hooks.slack.com/services/…' },
  feishu: {
    hosts: ['open.feishu.cn', 'open.larksuite.com'],
    path: /^\/open-apis\/bot\/v2\/hook\/[\w-]+$/,
    example: 'https://open.feishu.cn/open-apis/bot/v2/hook/…',
  },
  dingtalk: { hosts: ['oapi.dingtalk.com'], path: /^\/robot\/send$/, query: 'access_token', example: 'https://oapi.dingtalk.com/robot/send?access_token=…' },
  wecom: { hosts: ['qyapi.weixin.qq.com'], path: /^\/cgi-bin\/webhook\/send$/, query: 'key', example: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…' },
}

const TYPE_NAMES: Record<IntegrationType, string> = {
  slack: 'Slack',
  teams: 'Teams',
  feishu: '飞书',
  dingtalk: '钉钉',
  wecom: '企业微信',
  json: 'Webhook',
}

/** Catches the common mistake of pasting one platform's webhook into another's slot. */
export function validateTargetUrl(target: DeliveryTarget): URL {
  const url = normalizeUrl(target.url)
  const known = KNOWN_HOSTS[target.type]
  if (!known) return url
  const ok = url.protocol === 'https:' && known.hosts.includes(url.hostname) && known.path.test(url.pathname) && (!known.query || url.searchParams.get(known.query))
  if (!ok) throw new DeliveryError(`这不是有效的${TYPE_NAMES[target.type]}机器人 Webhook 地址，应形如 ${known.example}`)
  return url
}

const str = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
const list = (value: unknown) => (Array.isArray(value) ? value : [])
const validDate = (value: unknown) => {
  const date = str(value, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) ? date : null
}
const isoOrUndefined = (value: unknown) => {
  const ms = Date.parse(str(value, 40))
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString()
}

function sanitizeOutcomes(input: unknown): MeetingOutcomes {
  const value = (input ?? {}) as Partial<Record<keyof MeetingOutcomes, unknown>>
  const email = (value.followUpEmail ?? {}) as { subject?: unknown; body?: unknown }
  return {
    decisions: list(value.decisions).map((d) => str(d, 400)).filter(Boolean).slice(0, 20),
    actionItems: list(value.actionItems)
      .map((raw, index) => {
        const item = (raw ?? {}) as Partial<Record<keyof ActionItem, unknown>>
        return { id: str(item.id, 16) || `a${index + 1}`, owner: str(item.owner, 80) || '待定', task: str(item.task, 400), due: validDate(item.due), done: item.done === true }
      })
      .filter((item) => item.task)
      .slice(0, 30),
    followUpEmail: { subject: str(email.subject, 200), body: str(email.body, 6_000) },
  }
}

export function sanitizeDeliveryRequest(input: unknown): DeliveryRequest {
  const value = (input ?? {}) as { target?: Record<string, unknown>; payload?: Record<string, unknown> }
  const type = value.target?.type as IntegrationType
  if (!INTEGRATION_TYPES.includes(type)) throw new DeliveryError('不支持的推送类型')
  const url = str(value.target?.url, 2_048)
  if (!url) throw new DeliveryError('请填写 Webhook 地址')
  const p = value.payload ?? {}
  const language = typeof p.language === 'string' && Object.hasOwn(LANGUAGE_NAMES, p.language) ? (p.language as DeliveryPayload['language']) : 'zh'
  const startedAt = isoOrUndefined(p.startedAt) ?? new Date().toISOString()
  return {
    target: { type, url, secret: str(value.target?.secret, 256) || undefined },
    payload: {
      title: str(p.title, 200) || (language === 'zh' ? '会议' : 'Meeting'),
      when: str(p.when, 100) || startedAt.slice(0, 10),
      startedAt,
      endedAt: isoOrUndefined(p.endedAt),
      attendees: list(p.attendees).map((a) => str(a, 120)).filter(Boolean).slice(0, 50),
      language,
      tldr: str(p.tldr, 500) || undefined,
      summary: str(p.summary, 30_000) || undefined,
      outcomes: sanitizeOutcomes(p.outcomes),
      test: p.test === true,
    },
  }
}

export class DeliveryService {
  constructor(
    private readonly options: {
      allowPrivateNetwork?: boolean
      fetch?: (url: string, options: SafeFetchOptions) => Promise<SafeResponse>
      now?: () => number
    } = {},
  ) {}

  async deliver(input: unknown): Promise<{ ok: true }> {
    const { target, payload } = sanitizeDeliveryRequest(input)
    const url = validateTargetUrl(target)
    const request = formatDelivery(target, url, payload, (this.options.now ?? Date.now)())
    let response: SafeResponse
    try {
      response = await (this.options.fetch ?? safeFetch)(request.url, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
        timeoutMs: 10_000,
        maxBytes: 64 * 1024,
        // A webhook that redirects is misconfigured; following it would drop the POST body.
        maxRedirects: 0,
        allowPrivateNetwork: this.options.allowPrivateNetwork,
      })
    } catch (error) {
      if (error instanceof ClientError) throw error
      const code = (error as NodeJS.ErrnoException).code
      throw new DeliveryError(`无法连接到 ${url.hostname}${code ? `（${code}）` : ''}`, 502)
    }
    checkResponse(target.type, response)
    return { ok: true }
  }
}

/** Several platforms answer HTTP 200 with an error code in the body. */
export function checkResponse(type: IntegrationType, response: SafeResponse): void {
  const text = response.body.toString('utf8').slice(0, 2_000)
  let json: Record<string, unknown> | undefined
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed && typeof parsed === 'object') json = parsed as Record<string, unknown>
  } catch {
    // Slack answers "ok" / "no_service" as plain text.
  }

  if (response.status < 200 || response.status >= 300) {
    throw new DeliveryError(httpError(type, response.status, text.trim()), 502)
  }
  if (type === 'feishu' && json && typeof json.code === 'number' && json.code !== 0) {
    throw new DeliveryError(feishuError(json.code, String(json.msg ?? '')), 502)
  }
  if ((type === 'dingtalk' || type === 'wecom') && json && typeof json.errcode === 'number' && json.errcode !== 0) {
    throw new DeliveryError(chatError(type, json.errcode, String(json.errmsg ?? '')), 502)
  }
}

function httpError(type: IntegrationType, status: number, text: string): string {
  const detail = /^[\w.-]{1,60}$/.test(text) ? `（${text}）` : ''
  if (type === 'slack' && text === 'no_service') return 'Slack Webhook 已失效（应用已移除或 Webhook 已删除），请重新生成'
  if (type === 'slack' && status === 410) return 'Slack 频道已归档'
  if (status === 404) return `Webhook 地址不存在，可能已被删除${detail}`
  if (status === 401 || status === 403) return `Webhook 拒绝了请求，请检查权限或签名${detail}`
  if (status === 429) return '发送过于频繁，请稍后再试'
  if (status >= 500) return `${TYPE_NAMES[type]} 暂时不可用（HTTP ${status}）`
  return `${TYPE_NAMES[type]} 拒绝了消息（HTTP ${status}）${detail}`
}

function feishuError(code: number, msg: string): string {
  if (code === 19021) return '飞书签名校验失败：请检查签名密钥是否正确，并确认服务器时间准确'
  if (code === 19022) return '服务器 IP 不在飞书机器人的 IP 白名单中'
  if (code === 19024) return '消息未包含飞书机器人设置的自定义关键词（可将关键词设为「会议」）'
  return `飞书返回错误 ${code}：${msg}`
}

function chatError(type: 'dingtalk' | 'wecom', code: number, msg: string): string {
  if (type === 'dingtalk' && code === 310000) return `钉钉安全设置校验失败（关键词 / 加签 / IP 白名单）：${msg}`
  if ((type === 'dingtalk' && code === 300001) || (type === 'wecom' && code === 93000)) return 'Webhook 地址无效或机器人已被移除'
  if ((type === 'dingtalk' && code === 130101) || (type === 'wecom' && code === 45009)) return '发送过于频繁，请稍后再试'
  return `${TYPE_NAMES[type]}返回错误 ${code}：${msg}`
}

export function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

/** Cuts to at most `maxBytes` of UTF-8 without splitting a character. */
export function truncateBytes(text: string, maxBytes: number): string {
  if (byteLength(text) <= maxBytes) return text
  const budget = maxBytes - byteLength('…')
  let used = 0
  let out = ''
  for (const char of text) {
    used += byteLength(char)
    if (used > budget) break
    out += char
  }
  return `${out}…`
}

function truncateChars(text: string, max: number): string {
  const chars = Array.from(text)
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`
}
