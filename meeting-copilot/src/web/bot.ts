import type { BotStatus } from '../shared/protocol.ts'
import { apiUrl } from './net/api.ts'

const LABELS: Record<string, string> = {
  requested: '正在派出机器人…',
  ready: '机器人准备中…',
  scheduled: '机器人已预约',
  staged: '机器人准备中…',
  joining: '机器人正在加入会议…',
  waiting_room: '机器人在等候室',
  joined_not_recording: '机器人已入会，等待录制许可',
  joined_recording: '机器人记录中',
  joined_recording_paused: '机器人已暂停录制',
  joined_recording_permission_denied: '录制未获许可',
  joining_breakout_room: '机器人正在进入分组讨论室…',
  leaving_breakout_room: '机器人正在离开分组讨论室…',
  leaving: '机器人正在离开…',
  post_processing: '机器人会后处理中…',
  ended: '机器人已离开会议',
  fatal_error: '机器人入会失败',
  data_deleted: '机器人数据已删除',
}

export function botLabel(state: string): string {
  return LABELS[state] ?? `机器人：${state}`
}

/** States after which the bot will never hear the meeting again. */
export function isBotFinished(state: string | undefined): boolean {
  return state === 'ended' || state === 'fatal_error' || state === 'data_deleted'
}

/** What the user (or the host) needs to do, when anything. */
export function botHint(status: BotStatus, botName: string): { tone: 'info' | 'warn' | 'error'; text: string } | null {
  const detail = status.detail ? status.detail.replace(/_/g, ' ') : ''
  switch (status.state) {
    case 'waiting_room':
      return { tone: 'warn', text: `「${botName}」在等候室：请会议主持人准入。` }
    case 'joined_not_recording':
      return { tone: 'warn', text: `「${botName}」已入会。Zoom 需要主持人允许录制：请主持人在参会者列表中允许它录制。` }
    case 'joined_recording_permission_denied':
      return { tone: 'error', text: '主持人拒绝了录制请求，机器人无法获取会议音频。可改用「线上会议」模式在本机采集。' }
    case 'fatal_error':
      return { tone: 'error', text: `机器人未能加入会议${detail ? `：${detail}` : ''}。请检查会议链接是否正确、会议是否已开始。` }
    case 'ended':
      return detail && !/left meeting|leave requested/i.test(detail) ? { tone: 'info', text: `机器人已离开会议（${detail}）。` } : null
    default:
      return null
  }
}

export interface ServerInfo {
  bot: { enabled: boolean; reason?: string }
}

export async function fetchServerInfo(): Promise<ServerInfo | null> {
  try {
    const response = await fetch(apiUrl('/health'))
    if (!response.ok) return null
    const body = (await response.json()) as Partial<ServerInfo>
    return { bot: { enabled: body.bot?.enabled === true, reason: body.bot?.reason } }
  } catch {
    return null
  }
}
