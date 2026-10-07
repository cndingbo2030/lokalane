import type { LlmClient, LlmTextRequest } from './types.ts'

/**
 * Deterministic stand-in used when no Anthropic credentials are configured, so
 * the whole pipeline (and the demo meeting) can be exercised offline.
 */
export class MockLlm implements LlmClient {
  readonly name = 'mock'
  readonly requests: LlmTextRequest[] = []

  constructor(private readonly respond: (request: LlmTextRequest) => string = defaultResponse) {}

  async *streamText(request: LlmTextRequest): AsyncIterable<string> {
    this.requests.push(request)
    const text = this.respond(request)
    for (const chunk of text.match(/.{1,12}/gsu) ?? []) {
      if (request.signal?.aborted) return
      await new Promise((resolve) => setTimeout(resolve, 0))
      yield chunk
    }
    // Rough token estimate so metrics work offline (~4 chars per token).
    const input = request.system.length + (request.cachedContext?.length ?? 0) + request.prompt.length
    request.onUsage?.({ inputTokens: Math.ceil(input / 4), outputTokens: Math.ceil(text.length / 4), cacheReadTokens: 0, cacheWriteTokens: 0 })
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
