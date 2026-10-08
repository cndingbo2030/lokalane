import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { OverlayApp } from './overlay/OverlayApp.tsx'
import { WatchApp } from './watch/WatchApp.tsx'
import './styles.css'

// Same bundle, three entry points: the desktop app's floating prompter (?view=overlay),
// a read-only live link (?view=watch&share=…), and the main app.
const view = new URLSearchParams(location.search).get('view')

createRoot(document.getElementById('root')!).render(
  <StrictMode>{view === 'overlay' ? <OverlayApp /> : view === 'watch' ? <WatchApp /> : <App />}</StrictMode>,
)
