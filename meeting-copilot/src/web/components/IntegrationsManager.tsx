import { useState } from 'react'
import type { IntegrationType } from '../../shared/delivery.ts'
import type { LanguageCode } from '../../shared/protocol.ts'
import { INTEGRATION_INFO, samplePayload, type Integration } from '../outcomes/integrations.ts'
import { newId, useDeliveries } from '../outcomes/useIntegrations.ts'

const ORDER: IntegrationType[] = ['feishu', 'dingtalk', 'wecom', 'slack', 'teams', 'json']

interface Props {
  integrations: Integration[]
  onChange: (integrations: Integration[]) => void
  language: Exclude<LanguageCode, 'auto'>
}

/** Add, test and remove push targets (team chat webhooks). */
export function IntegrationsManager({ integrations, onChange, language }: Props) {
  const [type, setType] = useState<IntegrationType>('feishu')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [secret, setSecret] = useState('')
  const [autoSend, setAutoSend] = useState(true)
  const tests = useDeliveries()
  const info = INTEGRATION_INFO[type]

  const add = () => {
    const integration: Integration = { id: newId(), type, name: name.trim() || info.label, url: url.trim(), secret: secret.trim() || undefined, autoSend }
    onChange([...integrations, integration].slice(0, 10))
    setName('')
    setUrl('')
    setSecret('')
    // Send the sample right away: a typo in the URL shows up now, not after the meeting.
    void tests.send(integration, samplePayload(language))
  }

  const update = (id: string, patch: Partial<Integration>) => onChange(integrations.map((i) => (i.id === id ? { ...i, ...patch } : i)))

  return (
    <div className="integrations">
      {integrations.length > 0 && (
        <ul className="integration-list">
          {integrations.map((integration) => {
            const test = tests.statuses[integration.id]
            return (
              <li key={integration.id}>
                <div className="integration-row">
                  <span className="doc-kind">{INTEGRATION_INFO[integration.type].label}</span>
                  <span className="doc-name">{integration.name}</span>
                  <label className="inline-check">
                    <input type="checkbox" checked={integration.autoSend} onChange={(e) => update(integration.id, { autoSend: e.target.checked })} />
                    自动推送
                  </label>
                  <button
                    type="button"
                    className="link-button"
                    disabled={test?.status === 'sending'}
                    onClick={() => void tests.send(integration, samplePayload(language))}
                  >
                    {test?.status === 'sending' ? '发送中…' : '测试'}
                  </button>
                  <button type="button" className="link-button" onClick={() => onChange(integrations.filter((i) => i.id !== integration.id))}>
                    移除
                  </button>
                </div>
                {test?.status === 'sent' && <p className="ok-text small">已发送测试消息，请到群里查看</p>}
                {test?.status === 'error' && <p className="error-text small">{test.message}</p>}
              </li>
            )
          })}
        </ul>
      )}

      <div className="integration-form">
        <select value={type} aria-label="推送平台" onChange={(e) => setType(e.target.value as IntegrationType)}>
          {ORDER.map((t) => (
            <option key={t} value={t}>
              {INTEGRATION_INFO[t].label}
            </option>
          ))}
        </select>
        <input value={name} placeholder="名称（可选），如：销售群" aria-label="推送目标名称" onChange={(e) => setName(e.target.value)} />
        <input className="grow" value={url} placeholder={info.placeholder} aria-label="Webhook 地址" onChange={(e) => setUrl(e.target.value)} />
        {info.secret && (
          <input type="password" autoComplete="off" value={secret} placeholder={info.secret} aria-label="签名密钥" onChange={(e) => setSecret(e.target.value)} />
        )}
        <label className="inline-check">
          <input type="checkbox" checked={autoSend} onChange={(e) => setAutoSend(e.target.checked)} />
          会议结果生成后自动推送
        </label>
        <button type="button" className="button primary" disabled={!url.trim() || integrations.length >= 10} onClick={add}>
          添加并测试
        </button>
      </div>
      <p className="muted small">{info.help}</p>
      <p className="muted small">Webhook 地址和密钥只保存在本机浏览器，推送时经本服务转发；请勿分享给他人。</p>
    </div>
  )
}

/** Setup-screen card: where meeting results go after the meeting. */
export function IntegrationsPanel({ integrations, onChange, language }: Props) {
  const names = integrations.map((i) => i.name).join('、')
  return (
    <section className="card wide">
      <details className="feeds">
        <summary>
          {integrations.length === 0
            ? '会后推送：把纪要、决定和待办自动发到飞书 / 钉钉 / 企业微信 / Slack / Teams'
            : `会后推送（${integrations.length}）：${names}`}
        </summary>
        <IntegrationsManager integrations={integrations} onChange={onChange} language={language} />
      </details>
    </section>
  )
}
