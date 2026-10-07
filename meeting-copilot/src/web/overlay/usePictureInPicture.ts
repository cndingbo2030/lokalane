import { useCallback, useEffect, useState } from 'react'

interface DocumentPictureInPicture {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>
  readonly window: Window | null
}

function api(): DocumentPictureInPicture | undefined {
  return (window as unknown as { documentPictureInPicture?: DocumentPictureInPicture }).documentPictureInPicture
}

/**
 * Browser version of the floating prompter, via the Document Picture-in-Picture
 * API (Chrome / Edge 116+): an always-on-top mini window that stays visible
 * while the user looks at the meeting tab. Returns the PiP window's body to
 * portal React content into.
 */
export function usePictureInPicture() {
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const supported = Boolean(api())

  const open = useCallback(async () => {
    const pip = api()
    if (!pip) return
    if (pip.window) {
      pip.window.focus()
      return
    }
    const win = await pip.requestWindow({ width: 420, height: 340 })
    // Same styles as the main page (tokens, markdown, overlay classes).
    for (const node of document.head.querySelectorAll('style, link[rel="stylesheet"]')) {
      win.document.head.appendChild(node.cloneNode(true))
    }
    win.document.title = 'Meeting Copilot 提词器'
    win.document.body.className = 'pip-body'
    win.addEventListener('pagehide', () => setContainer(null), { once: true })
    setContainer(win.document.body)
  }, [])

  const close = useCallback(() => {
    api()?.window?.close()
    setContainer(null)
  }, [])

  useEffect(() => close, [close])

  return { supported, container, open, close }
}
