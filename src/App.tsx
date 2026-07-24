import { useEffect, useState } from 'react'
import { AppShell } from './components/AppShell'
import { Onboarding } from './components/Onboarding'
import { TodayPage } from './pages/TodayPage'
import { CreatePage } from './pages/CreatePage'
import { LibraryPage } from './pages/LibraryPage'
import { ReviewPage } from './pages/ReviewPage'
import { PlansPage } from './pages/PlansPage'
import { ExtensionsPage } from './pages/ExtensionsPage'
import { useApp } from './state/AppContext'
import { extensionPageV2 } from './extensions/v2/registry'
import { ExtensionUiFrameV2 } from './extensions/v2/ExtensionUiFrameV2'
import { WorkspaceRecovery } from './components/WorkspaceRecovery'
import { StartupScreen } from './components/StartupScreen'

export const App = () => {
  const { data, route, plan, workspaceLoading, workspaceLoadFailure } = useApp()
  const [libraryMounted, setLibraryMounted] = useState(route === 'library')
  useEffect(() => {
    document.documentElement.dataset.neoAnkiWorkspaceReady = workspaceLoading ? 'false' : workspaceLoadFailure ? 'recovery' : 'true'
  }, [workspaceLoadFailure, workspaceLoading])
  useEffect(() => {
    if (route !== 'library' || libraryMounted) return
    queueMicrotask(() => setLibraryMounted(true))
  }, [libraryMounted, route])
  const isolatedPage = extensionPageV2(route)
  if (workspaceLoading) return <StartupScreen />
  if (workspaceLoadFailure) return <WorkspaceRecovery />
  if (!data.settings.onboardingComplete) return <Onboarding />
  return (
    <AppShell>
      {route === 'today' && <TodayPage />}
      {libraryMounted && (route === 'today' || route === 'library') && <div hidden={route !== 'library'}><LibraryPage /></div>}
      {route === 'create' && <CreatePage />}
      {route === 'plans' && <PlansPage />}
      {(route === 'extensions' || route.startsWith('extensions:')) && <ExtensionsPage />}
      {isolatedPage && <section className="extension-page-v2"><h1>{isolatedPage.label}</h1><ExtensionUiFrameV2 contribution={isolatedPage} dto={{ workspaceRevision: data.updatedAt, summary: { notes: data.items.length, cards: data.cards.length, dueToday: plan.dueTotal } }} /></section>}
      {route === 'review' && <ReviewPage />}
    </AppShell>
  )
}
