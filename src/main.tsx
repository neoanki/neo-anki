import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { AppProvider } from './state/AppContext'
import { initializeExternalExtensions } from './extensions/runtime'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import './styles.css'

void initializeExternalExtensions().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AppErrorBoundary><AppProvider><App /></AppProvider></AppErrorBoundary>
    </StrictMode>,
  )
  queueMicrotask(() => window.neoAnkiDesktop?.rendererReady())
})

window.addEventListener('error', (event) => {
  void window.neoAnkiDesktop?.reportDiagnostic({ source: 'renderer', level: 'error', code: 'window-error', message: event.message, stack: event.error instanceof Error ? event.error.stack : undefined })
})
window.addEventListener('unhandledrejection', (event) => {
  const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason))
  void window.neoAnkiDesktop?.reportDiagnostic({ source: 'renderer', level: 'error', code: 'unhandled-rejection', message: error.message, stack: error.stack })
})

if ('serviceWorker' in navigator && import.meta.env.PROD && window.location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'))
}
