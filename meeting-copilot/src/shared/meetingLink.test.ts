import { describe, expect, it } from 'vitest'
import { extractMeetingLink, parseMeetingLink } from './meetingLink.ts'

describe('extractMeetingLink', () => {
  it('skips help and download links and prefers links with a meeting id', () => {
    const google = 'Join with Google Meet: https://meet.google.com/abc-defg-hij\nLearn more: https://support.google.com/a/users/answer/9282720'
    expect(extractMeetingLink('https://support.google.com/x', google)?.meetingId).toBe('abc-defg-hij')

    const tencent = '下载客户端 https://meeting.tencent.com/download\n点击入会 https://meeting.tencent.com/dm/Qw3rTy9'
    expect(extractMeetingLink(tencent)?.meetingId).toBe('Qw3rTy9')

    const teams = 'Need help? https://aka.ms/JoinTeamsMeeting\nJoin: <https://teams.microsoft.com/l/meetup-join/19%3ameeting_X%40thread.v2/0?context=%7b%7d>.'
    expect(extractMeetingLink(teams)?.platform).toBe('teams')
  })

  it('searches fields in priority order and returns null without a meeting link', () => {
    expect(extractMeetingLink(undefined, 'https://zoom.us/j/81234567890?pwd=x', 'https://meet.google.com/abc-defg-hij')?.platform).toBe('zoom')
    expect(extractMeetingLink('Room 3A', 'https://example.com/agenda')).toBeNull()
  })
})

describe('parseMeetingLink', () => {
  it('detects Google Meet codes', () => {
    const parsed = parseMeetingLink('https://meet.google.com/abc-defg-hij?authuser=0')
    expect(parsed?.platform).toBe('google-meet')
    expect(parsed?.meetingId).toBe('abc-defg-hij')
  })

  it('accepts bare links without a scheme', () => {
    expect(parseMeetingLink('meet.google.com/abc-defg-hij')?.platform).toBe('google-meet')
  })

  it('extracts the link from a pasted invitation', () => {
    const invite = '邀请您参加会议：\n点击链接入会 https://meeting.tencent.com/dm/AbC123xyz ，会议号：123 456 789'
    const parsed = parseMeetingLink(invite)
    expect(parsed?.platform).toBe('tencent')
    expect(parsed?.meetingId).toBe('AbC123xyz')
  })

  it('rewrites Zoom invite links to the web client and keeps the passcode', () => {
    const parsed = parseMeetingLink('https://us02web.zoom.us/j/81234567890?pwd=SeCrEt.1')
    expect(parsed?.platform).toBe('zoom')
    expect(parsed?.meetingId).toBe('81234567890')
    expect(parsed?.passcode).toBe('SeCrEt.1')
    expect(parsed?.url).toBe('https://us02web.zoom.us/wc/join/81234567890?pwd=SeCrEt.1')
  })

  it('handles Zoom personal rooms', () => {
    const parsed = parseMeetingLink('https://zoom.us/my/jane.doe')
    expect(parsed?.platform).toBe('zoom')
    expect(parsed?.meetingId).toBe('jane.doe')
  })

  it('detects Teams meetup-join and short meet links', () => {
    const long = parseMeetingLink(
      'https://teams.microsoft.com/l/meetup-join/19%3ameeting_ZmE1%40thread.v2/0?context=%7b%7d',
    )
    expect(long?.platform).toBe('teams')
    expect(long?.meetingId).toBe('19:meeting_ZmE1@thread.v2')

    const short = parseMeetingLink('https://teams.microsoft.com/meet/2851234567890?p=AbCdEf')
    expect(short?.meetingId).toBe('2851234567890')
    expect(short?.passcode).toBe('AbCdEf')

    expect(parseMeetingLink('https://teams.live.com/meet/9876543210?p=x')?.platform).toBe('teams')
  })

  it('detects VooV (international Tencent Meeting)', () => {
    expect(parseMeetingLink('https://voovmeeting.com/dm/xyz789')?.platform).toBe('tencent')
  })

  it('returns unknown for other https links and null for garbage', () => {
    expect(parseMeetingLink('https://example.com/room/1')?.platform).toBe('unknown')
    expect(parseMeetingLink('not a link')).toBeNull()
    expect(parseMeetingLink('javascript:alert(1)')).toBeNull()
  })
})
