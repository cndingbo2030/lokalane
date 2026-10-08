import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { DeliveryPayload, DeliveryTarget } from '../shared/delivery.ts'
import { byteLength, DeliveryError, DeliveryService, dingtalkSign, feishuSign, sanitizeDeliveryRequest, truncateBytes } from './delivery.ts'
import type { SafeFetchOptions, SafeResponse } from './net/safeFetch.ts'

const NOW = Date.UTC(2026, 9, 7, 9, 30)

const payload: DeliveryPayload = {
  title: 'Pilot review',
  when: '2026-10-07 17:30',
  startedAt: '2026-10-07T09:30:00.000Z',
  attendees: ['Wang Lei', 'Alice Tan'],
  language: 'zh',
  tldr: '双方同意下周启动试点',
  summary: '## 一句话总结\n双方同意下周启动试点',
  outcomes: {
    decisions: ['下周一启动试点'],
    actionItems: [
      { id: 'a1', owner: '我', task: '发送报价单 <!channel>', due: '2026-10-09', done: false },
      { id: 'a2', owner: 'Wang Lei', task: '确认数据驻留要求', due: null, done: true },
    ],
    followUpEmail: { subject: '会议跟进', body: '感谢参会' },
  },
}

function service(reply: Partial<SafeResponse> & { body?: Buffer } = {}, options: { allowPrivateNetwork?: boolean } = {}) {
  const calls: Array<{ url: string; options: SafeFetchOptions }> = []
  const delivery = new DeliveryService({
    ...options,
    now: () => NOW,
    fetch: async (url, fetchOptions) => {
      calls.push({ url, options: fetchOptions })
      return { status: 200, headers: {}, url, body: Buffer.from('ok'), ...reply }
    },
  })
  const send = (target: DeliveryTarget, extra: Partial<DeliveryPayload> = {}) => delivery.deliver({ target, payload: { ...payload, ...extra } })
  const sent = () => JSON.parse(String(calls[0].options.body)) as Record<string, unknown>
  return { calls, send, sent }
}

const json = (value: unknown) => Buffer.from(JSON.stringify(value))

describe('DeliveryService', () => {
  it('posts Slack Block Kit with escaped text and no redirects', async () => {
    const { calls, send, sent } = service()
    await expect(send({ type: 'slack', url: 'https://hooks.slack.com/services/T1/B2/xyz' })).resolves.toEqual({ ok: true })
    expect(calls[0].url).toBe('https://hooks.slack.com/services/T1/B2/xyz')
    expect(calls[0].options).toMatchObject({ method: 'POST', maxRedirects: 0 })
    const body = JSON.stringify(sent())
    expect(body).toContain('会议纪要｜Pilot review')
    expect(body).toContain('&lt;!channel&gt;') // never pings the channel
    expect(body).not.toContain('<!channel>')
    expect(body).toContain('☑ Wang Lei · 确认数据驻留要求')
    expect(body).toContain('截止 2026-10-09')
  })

  it('rejects a webhook pasted into the wrong platform', async () => {
    const { calls, send } = service()
    await expect(send({ type: 'slack', url: 'https://open.feishu.cn/open-apis/bot/v2/hook/abc' })).rejects.toThrow(/Slack.*hooks\.slack\.com/)
    await expect(send({ type: 'dingtalk', url: 'https://oapi.dingtalk.com/robot/send' })).rejects.toThrow(/access_token/)
    await expect(send({ type: 'wecom', url: 'http://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=k' })).rejects.toBeInstanceOf(DeliveryError)
    expect(calls).toHaveLength(0)
  })

  it('signs Feishu cards and surfaces error codes returned with HTTP 200', async () => {
    const ok = service({ body: json({ code: 0, msg: 'success' }) })
    await ok.send({ type: 'feishu', url: 'https://open.feishu.cn/open-apis/bot/v2/hook/abc-123', secret: 's3cret' })
    const body = ok.sent() as { timestamp: string; sign: string; msg_type: string; card: { header: { title: { content: string } } } }
    const seconds = Math.floor(NOW / 1000)
    expect(body.timestamp).toBe(String(seconds))
    expect(body.sign).toBe(createHmac('sha256', `${seconds}\ns3cret`).update('').digest('base64'))
    expect(body.sign).toBe(feishuSign('s3cret', seconds))
    expect(body.msg_type).toBe('interactive')
    expect(body.card.header.title.content).toBe('会议纪要｜Pilot review')

    const bad = service({ body: json({ code: 19021, msg: 'sign match fail' }) })
    await expect(bad.send({ type: 'feishu', url: 'https://open.feishu.cn/open-apis/bot/v2/hook/abc', secret: 'x' })).rejects.toThrow('签名校验失败')
  })

  it('neutralizes group mentions coming from meeting text', async () => {
    const { send, sent } = service({ body: json({ code: 0 }) })
    await send({ type: 'feishu', url: 'https://open.feishu.cn/open-apis/bot/v2/hook/abc' }, { tldr: '提醒 <at id=all></at> 和 <@all>' })
    const text = JSON.stringify(sent())
    expect(text).not.toMatch(/<at id=all>|<@all>/)
    expect(text).toContain('＜at id=all')
  })

  it('signs DingTalk requests in the query string', async () => {
    const { calls, send, sent } = service({ body: json({ errcode: 0, errmsg: 'ok' }) })
    await send({ type: 'dingtalk', url: 'https://oapi.dingtalk.com/robot/send?access_token=tok', secret: 'SECabc' })
    const url = new URL(calls[0].url)
    expect(url.searchParams.get('access_token')).toBe('tok')
    expect(url.searchParams.get('timestamp')).toBe(String(NOW))
    expect(url.searchParams.get('sign')).toBe(createHmac('sha256', 'SECabc').update(`${NOW}\nSECabc`).digest('base64'))
    expect(url.searchParams.get('sign')).toBe(dingtalkSign('SECabc', NOW))
    expect(sent()).toMatchObject({ msgtype: 'markdown', markdown: { title: '会议纪要｜Pilot review' } })

    const bad = service({ body: json({ errcode: 310000, errmsg: 'keywords not in content' }) })
    await expect(bad.send({ type: 'dingtalk', url: 'https://oapi.dingtalk.com/robot/send?access_token=tok' })).rejects.toThrow(/安全设置.*keywords/)
  })

  it('keeps WeCom markdown under its 4096-byte limit', async () => {
    const { send, sent } = service({ body: json({ errcode: 0, errmsg: 'ok' }) })
    const decisions = Array.from({ length: 20 }, (_, i) => `第 ${i + 1} 项决定：${'很长的内容'.repeat(70)}`)
    await send({ type: 'wecom', url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=k' }, { outcomes: { ...payload.outcomes, decisions } })
    const content = (sent() as { markdown: { content: string } }).markdown.content
    expect(byteLength(content)).toBeLessThanOrEqual(4096)
    expect(content).toContain('### 会议纪要｜Pilot review')
    expect(content).toContain('由 Meeting Copilot 生成')
  })

  it('posts an Adaptive Card to Teams and accepts 202', async () => {
    const { send, sent } = service({ status: 202, body: Buffer.alloc(0) })
    await send({ type: 'teams', url: 'https://prod-01.westus.logic.azure.com/workflows/abc/triggers/manual/paths/invoke?sig=x' }, { language: 'en' })
    const body = sent() as { attachments: Array<{ contentType: string; content: { type: string; body: Array<{ text: string }> } }> }
    expect(body.attachments[0].contentType).toBe('application/vnd.microsoft.card.adaptive')
    expect(body.attachments[0].content.type).toBe('AdaptiveCard')
    expect(body.attachments[0].content.body.map((b) => b.text)).toEqual(expect.arrayContaining(['Meeting notes｜Pilot review', 'Decisions', 'Action items']))
  })

  it('sends the full result to a generic webhook with a verifiable signature', async () => {
    const { calls, send } = service()
    await send({ type: 'json', url: 'https://example.com/hooks/meeting', secret: 'k' })
    const { body, headers } = calls[0].options
    const timestamp = headers?.['x-meeting-copilot-timestamp']
    expect(headers?.['x-meeting-copilot-signature']).toBe(`sha256=${createHmac('sha256', 'k').update(`${timestamp}.${String(body)}`).digest('hex')}`)
    expect(JSON.parse(String(body))).toMatchObject({
      event: 'meeting.outcomes',
      meeting: { title: 'Pilot review', attendees: ['Wang Lei', 'Alice Tan'] },
      summary: payload.summary,
      decisions: ['下周一启动试点'],
      actionItems: [{ id: 'a1', due: '2026-10-09' }, { id: 'a2', done: true }],
    })
  })

  it('explains HTTP and network failures', async () => {
    await expect(service({ status: 404, body: Buffer.from('no_service') }).send({ type: 'slack', url: 'https://hooks.slack.com/services/a/b/c' })).rejects.toThrow('已失效')
    await expect(service({ status: 404, body: Buffer.from('<html>') }).send({ type: 'json', url: 'https://example.com/x' })).rejects.toThrow('不存在')
    await expect(service({ status: 503 }).send({ type: 'json', url: 'https://example.com/x' })).rejects.toThrow('HTTP 503')

    const down = new DeliveryService({
      fetch: async () => {
        throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
      },
    })
    const error = await down.deliver({ target: { type: 'json', url: 'https://example.com/x' }, payload }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(DeliveryError)
    expect(error).toMatchObject({ status: 502, message: '无法连接到 example.com（ECONNREFUSED）' })
  })

  it('passes the private-network policy through to the fetch', async () => {
    const { calls, send } = service({}, { allowPrivateNetwork: true })
    await send({ type: 'json', url: 'http://192.168.1.20:5678/webhook/meeting' })
    expect(calls[0].options.allowPrivateNetwork).toBe(true)
  })
})

describe('sanitizeDeliveryRequest', () => {
  it('validates the target and bounds the payload', () => {
    expect(() => sanitizeDeliveryRequest({ target: { type: 'email', url: 'x' } })).toThrow('不支持')
    expect(() => sanitizeDeliveryRequest({ target: { type: 'slack', url: ' ' } })).toThrow('Webhook')
    const clean = sanitizeDeliveryRequest({
      target: { type: 'json', url: 'https://example.com', secret: '' },
      payload: {
        title: 'x'.repeat(500),
        language: 'constructor',
        attendees: ['a', 3, ''],
        outcomes: { decisions: ['d', ''], actionItems: [{ task: 't', due: '2026-13-45', done: 'yes' }, { task: '' }] },
      },
    })
    expect(clean.target.secret).toBeUndefined()
    expect(clean.payload.title).toHaveLength(200)
    expect(clean.payload.language).toBe('zh')
    expect(clean.payload.attendees).toEqual(['a'])
    expect(clean.payload.outcomes.decisions).toEqual(['d'])
    expect(clean.payload.outcomes.actionItems).toEqual([{ id: 'a1', owner: '待定', task: 't', due: null, done: false }])
  })
})

describe('truncateBytes', () => {
  it('never splits a multi-byte character', () => {
    const out = truncateBytes('会议纪要'.repeat(10), 20)
    expect(byteLength(out)).toBeLessThanOrEqual(20)
    expect(out.endsWith('…')).toBe(true)
    expect(out).not.toContain('�')
    expect(truncateBytes('short', 20)).toBe('short')
  })
})
