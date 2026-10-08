/**
 * Contract between the desktop shell (Electron main + preload) and the web app.
 * The preload script exposes a `DesktopBridge` as `window.desktop`; in a normal
 * browser it is undefined and the web app falls back to browser features.
 */

/** What the floating prompter shows: the latest exchange and the latest suggestion. */
export interface OverlayState {
  phase: 'idle' | 'connecting' | 'live' | 'ended'
  lastRemote?: { speaker: string; text: string; translation?: string }
  suggestion?: {
    id: string
    kind: string
    quote: string
    text: string
    done: boolean
    replyLanguage?: string
  }
}

export type OverlayAction = { type: 'ask' } | { type: 'hide' }

/** Actions the shell sends to the main window (global hotkeys, menu, overlay buttons). */
export type DesktopAction = { type: 'ask' } | { type: 'toggle-overlay' }

export type SttChoice = 'auto' | 'soniox' | 'deepgram'

/** Settings as the web UI sees them: which keys exist, never their values. */
export interface PublicDesktopSettings {
  keys: { anthropic: boolean; soniox: boolean; deepgram: boolean }
  sttProvider: SttChoice
  hideFromScreenShare: boolean
  overlay: boolean
  /** False when the OS keychain is unavailable (keys then cannot be saved). */
  secureStorage: boolean
  platform: string
  version: string
}

export interface DesktopSettingsUpdate {
  /** A string sets the key, '' removes it, undefined leaves it unchanged. */
  keys?: { anthropic?: string; soniox?: string; deepgram?: string }
  sttProvider?: SttChoice
  hideFromScreenShare?: boolean
  overlay?: boolean
}

export interface DesktopBridge {
  readonly platform: string
  getSettings(): Promise<PublicDesktopSettings>
  /** Saves settings; restarts the embedded server when keys or provider change (the page reloads). */
  saveSettings(update: DesktopSettingsUpdate): Promise<PublicDesktopSettings>
  publishOverlay(state: OverlayState): void
  setOverlayVisible(visible: boolean): void
  /** Overlay window: receive state from the main window. Returns an unsubscribe function. */
  onOverlayState(listener: (state: OverlayState) => void): () => void
  /** Overlay window: send a button press to the main window. */
  overlayAction(action: OverlayAction): void
  /** Main window: hotkeys, menu items and overlay buttons. Returns an unsubscribe function. */
  onAction(listener: (action: DesktopAction) => void): () => void
}

export const DESKTOP_CHANNELS = {
  getSettings: 'desktop:get-settings',
  saveSettings: 'desktop:save-settings',
  publishOverlay: 'desktop:publish-overlay',
  overlayState: 'desktop:overlay-state',
  setOverlayVisible: 'desktop:set-overlay-visible',
  overlayAction: 'desktop:overlay-action',
  action: 'desktop:action',
} as const
