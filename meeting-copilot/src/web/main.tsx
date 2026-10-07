import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { OverlayApp } from './overlay/OverlayApp.tsx'
import './styles.css'

// The desktop app's floating prompter window loads the same bundle with ?view=overlay.
const overlay = new URLSearchParams(location.search).get('view') === 'overlay'

createRoot(document.getElementById('root')!).render(<StrictMode>{overlay ? <OverlayApp /> : <App />}</StrictMode>)
