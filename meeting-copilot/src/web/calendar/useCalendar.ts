import { useCallback, useEffect, useRef, useState } from 'react'
import type { CalendarEvent } from '../../shared/calendar.ts'
import { dueReminders, fetchUpcoming, formatEventTime, loadFeeds, saveFeeds, type CalendarFeed } from './feeds.ts'

const REFRESH_MS = 5 * 60_000
const REMINDER_CHECK_MS = 20_000

type Permission = NotificationPermission | 'unsupported'
type FeedError = { feed: number; message: string }

// Stable empties: a fresh [] per render would re-run the reminder effect every render.
const NO_EVENTS: CalendarEvent[] = []
const NO_ERRORS: FeedError[] = []

/**
 * Calendar subscriptions → upcoming meetings, refreshed every few minutes, with
 * a reminder (in-app banner + system notification) shortly before each one.
 */
export function useCalendar(onReminderClick: (event: CalendarEvent) => void) {
  const [feeds, setFeedsState] = useState<CalendarFeed[]>(loadFeeds)
  const [result, setResult] = useState<{ key: string; events: CalendarEvent[]; errors: FeedError[] }>({ key: '', events: NO_EVENTS, errors: NO_ERRORS })
  const [loading, setLoading] = useState(false)
  const [reminder, setReminder] = useState<CalendarEvent | null>(null)
  const [permission, setPermission] = useState<Permission>(() => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission))
  const announced = useRef(new Set<string>())
  const onClick = useRef(onReminderClick)
  const feedsKey = feeds.map((f) => f.url).join('\n')

  useEffect(() => {
    onClick.current = onReminderClick
  }, [onReminderClick])

  const refresh = useCallback(async () => {
    if (feeds.length === 0) return
    setLoading(true)
    try {
      const response = await fetchUpcoming(feeds)
      setResult({ key: feedsKey, events: response.events, errors: response.errors })
    } catch (error) {
      setResult({ key: feedsKey, events: NO_EVENTS, errors: [{ feed: -1, message: error instanceof Error ? error.message : String(error) }] })
    } finally {
      setLoading(false)
    }
  }, [feeds, feedsKey])

  useEffect(() => {
    const first = window.setTimeout(() => void refresh(), 0)
    const timer = window.setInterval(() => void refresh(), REFRESH_MS)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(timer)
    }
  }, [refresh])

  // Results from a previous set of feeds are never shown (e.g. right after removing a feed).
  const fresh = result.key === feedsKey && feeds.length > 0
  const current = { events: fresh ? result.events : NO_EVENTS, errors: fresh ? result.errors : NO_ERRORS }

  useEffect(() => {
    const check = () => {
      for (const event of dueReminders(current.events, Date.now(), announced.current)) {
        announced.current.add(event.id)
        setReminder(event)
        if (permission === 'granted') {
          const notification = new Notification(`「${event.title}」即将开始`, {
            body: `${formatEventTime(event)}${event.meeting ? ' · 点击准备并加入' : ''}`,
            tag: event.id,
          })
          notification.onclick = () => {
            window.focus()
            setReminder(null)
            onClick.current(event)
            notification.close()
          }
        }
      }
    }
    const first = window.setTimeout(check, 500)
    const timer = window.setInterval(check, REMINDER_CHECK_MS)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(timer)
    }
  }, [current.events, permission])

  const setFeeds = useCallback((next: CalendarFeed[]) => {
    saveFeeds(next)
    setFeedsState(next)
  }, [])

  const enableNotifications = useCallback(async () => {
    if (typeof Notification === 'undefined') return
    setPermission(await Notification.requestPermission())
  }, [])

  return {
    feeds,
    setFeeds,
    events: current.events,
    errors: current.errors,
    loading,
    refresh,
    reminder,
    dismissReminder: () => setReminder(null),
    permission,
    enableNotifications,
  }
}
