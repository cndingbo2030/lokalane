import type { MeetingOutcomes } from './outcomes.ts'
import type { LanguageCode } from './protocol.ts'

/** Where meeting results can be pushed after the meeting. */
export const INTEGRATION_TYPES = ['slack', 'teams', 'feishu', 'dingtalk', 'wecom', 'json'] as const
export type IntegrationType = (typeof INTEGRATION_TYPES)[number]

export interface DeliveryTarget {
  type: IntegrationType
  /** The incoming-webhook URL (it embeds the channel's token, so treat it as a secret). */
  url: string
  /** Signing secret: Feishu "签名校验", DingTalk "加签", or HMAC for the generic JSON webhook. */
  secret?: string
}

export interface DeliveryPayload {
  title: string
  /** Display date/time, already formatted in the user's time zone. */
  when: string
  startedAt: string
  endedAt?: string
  attendees: string[]
  /** The user's language: labels and headings follow it. */
  language: Exclude<LanguageCode, 'auto'>
  /** The summary's one-line TL;DR. */
  tldr?: string
  /** Full meeting notes (Markdown); only the generic JSON webhook carries them. */
  summary?: string
  outcomes: MeetingOutcomes
  /** A "test connection" message. */
  test?: boolean
}

export interface DeliveryRequest {
  target: DeliveryTarget
  payload: DeliveryPayload
}
