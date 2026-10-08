import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildDeliveryPayload, loadIntegrations, samplePayload, saveIntegrations, type Integration } from './integrations.ts'

function fakeStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('integrations storage', () => {
  it('round-trips valid integrations and drops malformed ones', () => {
    vi.stubGlobal('localStorage', fakeStorage())
    const good: Integration = { id: '1', type: 'feishu', name: '销售群', url: 'https://open.feishu.cn/open-apis/bot/v2/hook/x', secret: 's', autoSend: true }
    saveIntegrations([good])
    expect(loadIntegrations()).toEqual([good])
    localStorage.setItem('meeting-copilot:integrations', JSON.stringify([{ type: 'email', url: 'x' }, { type: 'slack' }, good]))
    expect(loadIntegrations()).toEqual([good])
    localStorage.setItem('meeting-copilot:integrations', '{not json')
    expect(loadIntegrations()).toEqual([])
  })
})

describe('buildDeliveryPayload', () => {
  it('carries the TL;DR, timestamps and outcomes', () => {
    const payload = buildDeliveryPayload({
      title: 'Pilot',
      startedAt: Date.UTC(2026, 9, 7, 9, 30),
      endedAt: Date.UTC(2026, 9, 7, 10, 0),
      attendees: ['Wang Lei'],
      language: 'zh',
      summary: '## 一句话总结\n- **双方同意试点**\n\n## 关键讨论点',
      outcomes: { decisions: ['试点'], actionItems: [], followUpEmail: { subject: '', body: '' } },
    })
    expect(payload).toMatchObject({
      title: 'Pilot',
      startedAt: '2026-10-07T09:30:00.000Z',
      endedAt: '2026-10-07T10:00:00.000Z',
      tldr: '双方同意试点',
      attendees: ['Wang Lei'],
      outcomes: { decisions: ['试点'] },
    })
    expect(payload.when).toMatch(/2026/)
  })

  it('marks the sample as a test in the user’s language', () => {
    expect(samplePayload('en')).toMatchObject({ test: true, title: 'Sample meeting', language: 'en' })
    expect(samplePayload('zh').outcomes.actionItems[0].owner).toBe('我')
  })
})
