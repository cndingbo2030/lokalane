import type { CalendarPerson } from './calendar.ts'
import type { DocumentRef, LanguageCode } from './protocol.ts'

export interface BriefRequest {
  event?: {
    title: string
    start?: string
    end?: string
    description?: string
    location?: string
    organizer?: CalendarPerson
    attendees?: CalendarPerson[]
  }
  meetingUrl?: string
  /** What the user already wrote; the brief builds on it instead of replacing it. */
  notes?: { myRole?: string; goal?: string; context?: string }
  /** Earlier meetings in the same series or with the same people (from local history). */
  pastMeetings?: Array<{ title: string; date: string; summary: string; openActionItems?: string[] }>
  documents?: DocumentRef[]
  targetLanguage: Exclude<LanguageCode, 'auto'>
}

export interface MeetingBriefDraft {
  myRole: string
  goal: string
  context: string
  agenda: string[]
  /** What the other side is likely to ask, with grounded suggested answers. */
  anticipatedQuestions: Array<{ question: string; answer: string }>
  /** Follow-ups carried over from earlier meetings. */
  openItems: string[]
  risks: string[]
}
