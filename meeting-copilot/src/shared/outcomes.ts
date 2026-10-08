/** Structured results of a meeting, extracted after the summary. */
export interface ActionItem {
  id: string
  /** Who does it; "我" / "Me" for the user, a participant's name, or "待定" when unclear. */
  owner: string
  task: string
  /** ISO date (YYYY-MM-DD) when one was stated, else null. */
  due: string | null
  /** Ticked off by the user later (stored in local history). */
  done?: boolean
}

export interface MeetingOutcomes {
  decisions: string[]
  actionItems: ActionItem[]
  followUpEmail: { subject: string; body: string }
}
