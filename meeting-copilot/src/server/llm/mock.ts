import type { LlmClient, LlmJsonRequest, LlmTextRequest } from './types.ts'

/**
 * Deterministic stand-in used when no Anthropic credentials are configured, so
 * the whole pipeline (and the demo meeting) can be exercised offline.
 */
export class MockLlm implements LlmClient {
  readonly name = 'mock'
  readonly requests: LlmTextRequest[] = []

  constructor(
    private readonly respond: (request: LlmTextRequest) => string = defaultResponse,
    private readonly respondJson: (request: LlmJsonRequest) => unknown = defaultJson,
  ) {}

  async completeJson<T>(request: LlmJsonRequest): Promise<T> {
    this.requests.push(request)
    await new Promise((resolve) => setTimeout(resolve, 0))
    const value = this.respondJson(request)
    request.onUsage?.({ inputTokens: Math.ceil(inputChars(request) / 4), outputTokens: Math.ceil(JSON.stringify(value).length / 4), cacheReadTokens: 0, cacheWriteTokens: 0 })
    return value as T
  }

  async *streamText(request: LlmTextRequest): AsyncIterable<string> {
    this.requests.push(request)
    const text = this.respond(request)
    for (const chunk of text.match(/.{1,12}/gsu) ?? []) {
      if (request.signal?.aborted) return
      await new Promise((resolve) => setTimeout(resolve, 0))
      yield chunk
    }
    // Rough token estimate so metrics work offline (~4 chars per token).
    request.onUsage?.({ inputTokens: Math.ceil(inputChars(request) / 4), outputTokens: Math.ceil(text.length / 4), cacheReadTokens: 0, cacheWriteTokens: 0 })
  }
}

function inputChars(request: LlmTextRequest): number {
  return request.system.length + (request.cachedContext?.length ?? 0) + (request.cachedPrompt?.length ?? 0) + request.prompt.length
}

function defaultJson(request: LlmJsonRequest): unknown {
  switch (request.task) {
    case 'brief':
      return {
        myRole: '',
        goal: '（模拟）确认本次会议要达成的结果',
        context: '（模拟）配置 ANTHROPIC_API_KEY 后，这里会根据日历、历史会议和参考文件生成真实简报。',
        agenda: ['（模拟）回顾上次会议待办', '（模拟）讨论报价与试点范围'],
        anticipatedQuestions: [{ question: '（模拟）你们的价格包含哪些服务？', answer: '（模拟）请参考报价单回答（待确认）' }],
        openItems: [],
        risks: ['（模拟）不要在会上承诺未经批准的折扣'],
      }
    case 'outcomes':
      return {
        decisions: ['（模拟）双方同意推进试点'],
        actionItems: [{ owner: '我', task: '（模拟）发送报价单和试点方案', due: null }],
        followUpEmail: { subject: '（模拟）会议跟进', body: '（模拟）感谢参会，附上会议纪要与下一步安排。' },
      }
    default:
      return {}
  }
}

function defaultResponse(request: LlmTextRequest): string {
  if (request.system.includes('[role:translator]')) {
    const line = request.prompt.match(/<translate>\n([\s\S]*?)\n<\/translate>/)?.[1] ?? ''
    return `〔模拟翻译〕${line}`
  }
  if (request.system.includes('[role:copilot]')) {
    return [
      '**建议回应**：Thanks for raising that — let me give you the concrete numbers and then we can decide together.',
      '↳ 谢谢你提出来——我先给你具体数字，然后我们一起决定。',
      '',
      '**要点**',
      '- （模拟）先确认对方的真实顾虑，再给出数据支撑',
      '- （模拟）配置 ANTHROPIC_API_KEY 后这里会是 Claude 的实时建议',
    ].join('\n')
  }
  return [
    '## 会议摘要（模拟）',
    '配置 ANTHROPIC_API_KEY 后，这里会生成完整的摘要、决定事项、待办和跟进邮件。',
  ].join('\n')
}
