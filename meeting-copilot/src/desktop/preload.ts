/**
 * Preload (sandboxed, CommonJS bundle): exposes a narrow, typed bridge as
 * `window.desktop`. No Node or Electron objects reach the page.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { DESKTOP_CHANNELS, type DesktopAction, type DesktopBridge, type OverlayState } from '../shared/desktop.ts'

function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, value: T) => listener(value)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const bridge: DesktopBridge = {
  platform: process.platform,
  getSettings: () => ipcRenderer.invoke(DESKTOP_CHANNELS.getSettings),
  saveSettings: (update) => ipcRenderer.invoke(DESKTOP_CHANNELS.saveSettings, update),
  publishOverlay: (state) => ipcRenderer.send(DESKTOP_CHANNELS.publishOverlay, state),
  setOverlayVisible: (visible) => ipcRenderer.send(DESKTOP_CHANNELS.setOverlayVisible, visible),
  onOverlayState: (listener) => subscribe<OverlayState>(DESKTOP_CHANNELS.overlayState, listener),
  overlayAction: (action) => ipcRenderer.send(DESKTOP_CHANNELS.overlayAction, action),
  onAction: (listener) => subscribe<DesktopAction>(DESKTOP_CHANNELS.action, listener),
}

contextBridge.exposeInMainWorld('desktop', bridge)
