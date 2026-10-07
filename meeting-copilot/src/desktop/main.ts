/**
 * Desktop shell (Electron main process).
 *
 * - Runs the copilot server in-process on 127.0.0.1 with a random per-launch
 *   access token, and loads the web app from it.
 * - Grants getDisplayMedia with system audio loopback, so meetings in native
 *   Zoom / Teams / Tencent Meeting clients can be captured (no tab picking).
 * - Shows an always-on-top floating prompter, hidden from screen sharing.
 * - Registers global hotkeys and stores API keys encrypted with the OS keychain.
 */
import { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, Menu, safeStorage, session, shell, systemPreferences, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCopilotServer, type CopilotServer } from '../server/app.ts'
import { loadConfig } from '../server/config.ts'
import { DESKTOP_CHANNELS, type DesktopAction, type DesktopSettingsUpdate, type OverlayAction, type OverlayState } from '../shared/desktop.ts'
import { applyUpdate, needsRestart, parseStored, serverEnv, toPublic, type Cipher, type StoredSettings } from './settings.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.join(here, '..')
const preload = path.join(here, 'preload.cjs')
const HOTKEY_ASK = 'CommandOrControl+Shift+Space'
const HOTKEY_OVERLAY = 'CommandOrControl+Shift+O'

const cipher: Cipher = {
  get available() {
    return safeStorage.isEncryptionAvailable()
  },
  encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
  decrypt: (encrypted) => safeStorage.decryptString(Buffer.from(encrypted, 'base64')),
}

let settings: StoredSettings
let copilot: CopilotServer | null = null
let origin = ''
let token = ''
let mainWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
let overlayWanted = false
let overlayHiddenByUser = false
let lastOverlayState: OverlayState = { phase: 'idle' }

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json')

async function loadSettings(): Promise<StoredSettings> {
  try {
    return parseStored(await readFile(settingsPath(), 'utf8'))
  } catch {
    return parseStored(undefined)
  }
}

async function saveSettingsFile(next: StoredSettings): Promise<void> {
  await mkdir(path.dirname(settingsPath()), { recursive: true })
  await writeFile(settingsPath(), JSON.stringify(next, null, 2), { mode: 0o600 })
}

async function startServer(): Promise<void> {
  token = randomBytes(24).toString('base64url')
  const env = serverEnv(settings, cipher, process.env)
  const config = { ...loadConfig(env), accessToken: token, production: true, allowedOrigins: [] }
  copilot = createCopilotServer({ config, staticDir: path.join(appRoot, 'dist') })
  const port = await copilot.listen(0, '127.0.0.1')
  origin = `http://127.0.0.1:${port}`
}

const pageUrl = (view?: string) => `${origin}/?token=${encodeURIComponent(token)}${view ? `&view=${view}` : ''}`
const isOurs = (url: string | undefined) => Boolean(url && origin && (url === origin || url.startsWith(`${origin}/`)))

/** IPC is only accepted from our own pages, never from navigated-away content. */
function trusted(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return isOurs(event.senderFrame?.url)
}

function hardenWebContents(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    // Meeting links open in the default browser or the native meeting app.
    if (/^https?:\/\//i.test(url) && !isOurs(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (isOurs(url)) return
    event.preventDefault()
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })
}

function applyContentProtection(): void {
  mainWindow?.setContentProtection(settings.hideFromScreenShare)
  overlayWindow?.setContentProtection(settings.hideFromScreenShare)
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 420,
    minHeight: 600,
    title: 'Meeting Copilot',
    show: false,
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  hardenWebContents(mainWindow)
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
    overlayWindow?.close()
  })
  applyContentProtection()
  void mainWindow.loadURL(pageUrl())
}

function ensureOverlayWindow(): BrowserWindow {
  if (overlayWindow) return overlayWindow
  overlayWindow = new BrowserWindow({
    width: 420,
    height: 340,
    minWidth: 300,
    minHeight: 200,
    title: 'Meeting Copilot 提词器',
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    resizable: true,
    fullscreenable: false,
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  // Float above full-screen meeting windows and follow the user across spaces.
  overlayWindow.setAlwaysOnTop(true, 'screen-saver')
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  hardenWebContents(overlayWindow)
  // Keep a distinct window title (the page's <title> would otherwise replace it).
  overlayWindow.on('page-title-updated', (event) => event.preventDefault())
  overlayWindow.webContents.on('did-finish-load', () => overlayWindow?.webContents.send(DESKTOP_CHANNELS.overlayState, lastOverlayState))
  overlayWindow.on('closed', () => (overlayWindow = null))
  applyContentProtection()
  void overlayWindow.loadURL(pageUrl('overlay'))
  return overlayWindow
}

function updateOverlayVisibility(): void {
  const show = settings.overlay && overlayWanted && !overlayHiddenByUser
  if (show) {
    const win = ensureOverlayWindow()
    if (!win.isVisible()) win.showInactive()
  } else {
    overlayWindow?.hide()
  }
}

function sendAction(action: DesktopAction): void {
  mainWindow?.webContents.send(DESKTOP_CHANNELS.action, action)
}

function toggleOverlay(): void {
  overlayHiddenByUser = Boolean(overlayWindow?.isVisible())
  if (!overlayHiddenByUser) overlayWanted = true
  updateOverlayVisibility()
}

async function restartServer(): Promise<void> {
  await copilot?.close()
  await startServer()
  void mainWindow?.loadURL(pageUrl())
  void overlayWindow?.loadURL(pageUrl('overlay'))
}

function registerIpc(): void {
  const meta = () => ({ platform: process.platform, version: app.getVersion(), secureStorage: cipher.available })

  ipcMain.handle(DESKTOP_CHANNELS.getSettings, (event) => {
    if (!trusted(event)) throw new Error('untrusted sender')
    return toPublic(settings, meta())
  })

  ipcMain.handle(DESKTOP_CHANNELS.saveSettings, async (event, update: DesktopSettingsUpdate) => {
    if (!trusted(event)) throw new Error('untrusted sender')
    const next = applyUpdate(settings, update ?? {}, cipher)
    const restart = needsRestart(settings, next)
    settings = next
    await saveSettingsFile(next)
    applyContentProtection()
    updateOverlayVisibility()
    // Reply first; the page reloads once the server is back with the new keys.
    if (restart) setTimeout(() => void restartServer(), 100)
    return toPublic(settings, meta())
  })

  ipcMain.on(DESKTOP_CHANNELS.publishOverlay, (event, state: OverlayState) => {
    if (!trusted(event) || event.sender !== mainWindow?.webContents) return
    lastOverlayState = state
    overlayWindow?.webContents.send(DESKTOP_CHANNELS.overlayState, state)
  })

  ipcMain.on(DESKTOP_CHANNELS.setOverlayVisible, (event, visible: boolean) => {
    if (!trusted(event) || event.sender !== mainWindow?.webContents) return
    overlayWanted = Boolean(visible)
    if (!overlayWanted) overlayHiddenByUser = false // next meeting shows it again
    updateOverlayVisibility()
  })

  ipcMain.on(DESKTOP_CHANNELS.overlayAction, (event, action: OverlayAction) => {
    if (!trusted(event) || event.sender !== overlayWindow?.webContents) return
    if (action?.type === 'ask') sendAction({ type: 'ask' })
    if (action?.type === 'hide') {
      overlayHiddenByUser = true
      updateOverlayVisibility()
    }
  })
}

function configureSession(): void {
  const ses = session.defaultSession
  // Microphone and screen/system-audio capture, for our own pages only.
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    callback((permission === 'media' || permission === 'display-capture' || permission === 'clipboard-sanitized-write') && isOurs(details.requestingUrl))
  })
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => (permission === 'media' || permission === 'clipboard-sanitized-write') && isOurs(requestingOrigin))

  // getDisplayMedia() from the page → the primary screen plus system audio loopback.
  ses.setDisplayMediaRequestHandler((request, callback) => {
    if (!isOurs(request.frame?.url)) return callback({})
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then((sources) => callback(sources[0] ? { video: sources[0], audio: 'loopback' } : {}))
      .catch(() => callback({}))
  })
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin'
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(isMac ? [{ role: 'appMenu' as const }] : []),
      { role: 'editMenu' },
      {
        label: '会议',
        submenu: [
          { id: 'ask', label: '立即建议', accelerator: HOTKEY_ASK, click: () => sendAction({ type: 'ask' }) },
          { id: 'toggle-overlay', label: '显示/隐藏提词器', accelerator: HOTKEY_OVERLAY, click: toggleOverlay },
        ],
      },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]),
  )
}

function registerHotkeys(): void {
  // Global: they work while the meeting app has focus.
  globalShortcut.register(HOTKEY_ASK, () => sendAction({ type: 'ask' }))
  globalShortcut.register(HOTKEY_OVERLAY, toggleOverlay)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore()
    mainWindow?.focus()
  })

  app.whenReady().then(async () => {
    settings = await loadSettings()
    if (process.platform === 'darwin') await systemPreferences.askForMediaAccess('microphone').catch(() => false)
    await startServer()
    configureSession()
    registerIpc()
    buildMenu()
    registerHotkeys()
    createMainWindow()
    app.on('activate', () => {
      if (!mainWindow) createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    void copilot?.close()
  })
}
