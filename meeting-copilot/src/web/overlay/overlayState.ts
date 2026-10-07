import type { OverlayState } from '../../shared/desktop.ts'
import type { SuggestionKind } from '../../shared/protocol.ts'
import { speakerDisplay, type AppState } from '../state/reducer.ts'

const KIND_LABEL: Record<SuggestionKind, string> = {
  question: '对方提问',
  objection: '对方顾虑',
  action: '待办请求',
  manual: '我问 AI',
}

/** The few things worth a glance during a call: what they just said, and what to say back. */
export function deriveOverlayState(state: AppState): OverlayState {
  const phase = state.phase === 'setup' ? 'idle' : state.phase
  const lastRemote = [...state.segments].reverse().find((s) => s.source === 'remote' && s.isFinal)
  const latest = state.suggestions[0]
  return {
    phase,
    lastRemote: lastRemote
      ? { speaker: speakerDisplay(lastRemote, state.speakerNames), text: lastRemote.text, translation: state.translations[lastRemote.id] }
      : undefined,
    suggestion: latest
      ? {
          id: latest.id,
          kind: KIND_LABEL[latest.trigger.kind],
          quote: latest.trigger.text,
          text: latest.text,
          done: latest.done,
          replyLanguage: latest.trigger.replyLanguage,
        }
      : undefined,
  }
}
