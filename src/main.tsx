import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { AppProvider } from './state/AppContext'
import { initializeExternalExtensions } from './extensions/runtime'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { browserSync } from './lib/browser-sync'
import { loadData, saveData } from './lib/storage'
import { appDataToWorkspaceDocumentV4, workspaceDocumentV4ToAppData } from './lib/workspace-v4'
import './styles.css'

const resumeInterruptedBrowserSync = async () => {
  if (window.neoAnkiDesktop || !(await browserSync.status()).pendingCommit) return
  const root = document.getElementById('root')!
  root.innerHTML = '<main class="onboarding-shell"><section class="onboarding-card" role="status" aria-live="polite"><p class="eyebrow">Encrypted sync recovery</p><h1>Finishing an interrupted local commit…</h1><p>Your verified sync result is safely journaled. Neo Anki is committing it before the workspace becomes editable.</p></section></main>'
  const current = loadData()
  await browserSync.synchronize(appDataToWorkspaceDocumentV4(current), current.assets, [], async ({ document, media }) => {
    const projected = workspaceDocumentV4ToAppData(document); projected.assets = media
    await saveData(projected)
  })
}

const RendererReady = () => {
  useEffect(() => {
    document.documentElement.dataset.neoAnkiRendererReady = 'true'
    window.neoAnkiDesktop?.rendererReady()
  }, [])
  return null
}

void resumeInterruptedBrowserSync().catch(() => undefined).finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <RendererReady />
      <AppErrorBoundary><AppProvider><App /></AppProvider></AppErrorBoundary>
    </StrictMode>,
  )
  void initializeExternalExtensions().finally(() => window.dispatchEvent(new Event('neo-anki:extensions-ready')))
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
