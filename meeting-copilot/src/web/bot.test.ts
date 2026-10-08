import { describe, expect, it } from 'vitest'
import { botHint, botLabel, isBotFinished } from './bot.ts'

describe('bot status helpers', () => {
  it('labels known and unknown states', () => {
    expect(botLabel('waiting_room')).toBe('机器人在等候室')
    expect(botLabel('something_new')).toBe('机器人：something_new')
  })

  it('knows when the bot is gone for good', () => {
    expect(['ended', 'fatal_error', 'data_deleted'].every(isBotFinished)).toBe(true)
    expect(isBotFinished('leaving')).toBe(false)
    expect(isBotFinished(undefined)).toBe(false)
  })

  it('tells the user what to do', () => {
    expect(botHint({ state: 'waiting_room' }, '小助手')).toMatchObject({ tone: 'warn', text: expect.stringContaining('「小助手」在等候室') })
    expect(botHint({ state: 'fatal_error', detail: 'meeting_not_found' }, 'x')?.text).toContain('meeting not found')
    expect(botHint({ state: 'joined_recording' }, 'x')).toBeNull()
    expect(botHint({ state: 'ended', detail: 'auto_leave_only_participant_in_meeting' }, 'x')?.text).toContain('auto leave only participant')
    expect(botHint({ state: 'ended', detail: 'bot_left_meeting' }, 'x')).toBeNull()
  })
})
