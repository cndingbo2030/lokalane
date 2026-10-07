import { useEffect, useState } from 'react'
import type { OverlayState } from '../../shared/desktop.ts'
import { desktop } from '../desktop.ts'
import { OverlayView } from './OverlayView.tsx'

/** Rendered in the desktop app's always-on-top overlay window (`?view=overlay`). */
export function OverlayApp() {
  const [state, setState] = useState<OverlayState>({ phase: 'idle' })

  useEffect(() => desktop?.onOverlayState(setState), [])

  if (!desktop) return <p className="muted">提词器窗口只在桌面版中使用。</p>
  return <OverlayView state={state} onAsk={() => desktop?.overlayAction({ type: 'ask' })} onHide={() => desktop?.overlayAction({ type: 'hide' })} />
}
