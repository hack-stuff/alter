import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AppUpdate } from './components/AppUpdate'
import { installVoiceAudioUnlock } from './live/voiceAudio'
import { applySavedTheme } from './theme'

applySavedTheme()

if (import.meta.env.VITE_MOCK !== '1' || import.meta.env.VITE_LIVE_TOKEN_BASE?.trim()) installVoiceAudioUnlock()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppUpdate />
    <App />
  </StrictMode>,
)
