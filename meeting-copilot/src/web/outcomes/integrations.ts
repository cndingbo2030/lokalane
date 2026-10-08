import type { DeliveryPayload, IntegrationType } from '../../shared/delivery.ts'
import { INTEGRATION_TYPES } from '../../shared/delivery.ts'
import type { MeetingOutcomes } from '../../shared/outcomes.ts'
import type { LanguageCode } from '../../shared/protocol.ts'
import { summaryTldr } from '../../shared/summary.ts'
import { postJson } from '../net/api.ts'

/** A configured push target. Stored only in this browser: the URL embeds the channel's token. */
export interface Integration {
  id: string
  type: IntegrationType
  name: string
  url: string
  secret?: string
  /** Push automatically as soon as the meeting results are ready. */
  autoSend: boolean
}

export const INTEGRATION_INFO: Record<IntegrationType, { label: string; placeholder: string; secret?: string; help: string }> = {
  slack: {
    label: 'Slack',
    placeholder: 'https://hooks.slack.com/services/…',
    help: 'Slack：api.slack.com/apps → 创建应用 → Incoming Webhooks → Add New Webhook，选择频道后复制 Webhook URL。',
  },
  teams: {
    label: 'Microsoft Teams',
    placeholder: 'https://…logic.azure.com/… 或 …powerplatform.com/…',
    help: 'Teams：频道右侧 ··· → Workflows → 「Post to a channel when a webhook request is received」，完成后复制生成的 URL。',
  },
  feishu: {
    label: '飞书',
    placeholder: 'https://open.feishu.cn/open-apis/bot/v2/hook/…',
    secret: '签名密钥（开启「签名校验」时填写）',
    help: '飞书：群设置 → 群机器人 → 添加机器人 → 自定义机器人，复制 webhook 地址。安全设置建议开启「签名校验」并把密钥填在这里，或将自定义关键词设为「会议」。',
  },
  dingtalk: {
    label: '钉钉',
    placeholder: 'https://oapi.dingtalk.com/robot/send?access_token=…',
    secret: '加签密钥（SEC 开头，选择「加签」时填写）',
    help: '钉钉：群设置 → 机器人 → 添加机器人 → 自定义，安全设置选择「加签」并把密钥填在这里（或将关键词设为「会议」），复制 Webhook 地址。',
  },
  wecom: {
    label: '企业微信',
    placeholder: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…',
    help: '企业微信：群聊右上角 ··· → 消息推送（群机器人）→ 添加机器人，复制 Webhook 地址。',
  },
  json: {
    label: '通用 Webhook（JSON）',
    placeholder: 'https://your-server.example.com/hooks/meeting',
    secret: '签名密钥（可选，用于 HMAC-SHA256 校验）',
    help: '以 JSON POST 完整会议结果（纪要、决定、待办、跟进邮件），适合 Zapier / Make / n8n 或自有系统。填写密钥后会附带 X-Meeting-Copilot-Signature 签名头。',
  },
}

const KEY = 'meeting-copilot:integrations'

export function loadIntegrations(): Integration[] {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    if (!Array.isArray(saved)) return []
    return saved
      .filter((i: Partial<Integration>) => typeof i?.url === 'string' && INTEGRATION_TYPES.includes(i.type as IntegrationType))
      .map((i: Integration) => ({ id: String(i.id), type: i.type, name: String(i.name ?? ''), url: i.url, secret: i.secret || undefined, autoSend: Boolean(i.autoSend) }))
      .slice(0, 10)
  } catch {
    return []
  }
}

export function saveIntegrations(integrations: Integration[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(integrations))
  } catch {
    // storage unavailable
  }
}

export interface DeliverySource {
  title: string
  startedAt: number
  endedAt?: number
  attendees: string[]
  language: Exclude<LanguageCode, 'auto'>
  summary: string
  outcomes: MeetingOutcomes
}

export function buildDeliveryPayload(source: DeliverySource): DeliveryPayload {
  return {
    title: source.title,
    when: new Date(source.startedAt).toLocaleString(source.language === 'zh' ? 'zh-CN' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }),
    startedAt: new Date(source.startedAt).toISOString(),
    endedAt: source.endedAt ? new Date(source.endedAt).toISOString() : undefined,
    attendees: source.attendees,
    language: source.language,
    tldr: summaryTldr(source.summary),
    summary: source.summary || undefined,
    outcomes: source.outcomes,
  }
}

/** What "测试" sends: a realistic sample, so the user sees the real format in their channel. */
export function samplePayload(language: Exclude<LanguageCode, 'auto'>): DeliveryPayload {
  const zh = language === 'zh'
  return {
    ...buildDeliveryPayload({
      title: zh ? '示例会议' : 'Sample meeting',
      startedAt: Date.now(),
      attendees: zh ? ['王磊', 'Alice Tan'] : ['Wang Lei', 'Alice Tan'],
      language,
      summary: zh ? '## 一句话总结\n这是一条测试消息：推送配置成功。' : '## TL;DR\nThis is a test message: the integration works.',
      outcomes: {
        decisions: [zh ? '（示例）下周一启动试点' : '(Sample) Start the pilot next Monday'],
        actionItems: [{ id: 'a1', owner: zh ? '我' : 'Me', task: zh ? '（示例）发送报价单' : '(Sample) Send the quote', due: null }],
        followUpEmail: { subject: '', body: '' },
      },
    }),
    test: true,
  }
}

export function deliver(integration: Integration, payload: DeliveryPayload): Promise<{ ok: true }> {
  return postJson('/api/deliver', { target: { type: integration.type, url: integration.url, secret: integration.secret }, payload })
}
