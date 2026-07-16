import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { AppProvider } from './state/AppContext'
import { initializeExternalExtensions } from './extensions/runtime'
import './styles.css'

void initializeExternalExtensions().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AppProvider><App /></AppProvider>
    </StrictMode>,
  )
})

if ('serviceWorker' in navigator && import.meta.env.PROD && window.location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'))
}
