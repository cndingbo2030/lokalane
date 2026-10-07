import type { DesktopBridge } from '../shared/desktop.ts'

/** The Electron preload bridge, or undefined in a normal browser. */
export const desktop: DesktopBridge | undefined = (window as unknown as { desktop?: DesktopBridge }).desktop
