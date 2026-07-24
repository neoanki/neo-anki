import { lazy, Suspense, useEffect } from 'react'
import { AppShell } from './components/AppShell'
import { Onboarding } from './components/Onboarding'
import { TodayPage } from './pages/TodayPage'
import { useApp } from './state/AppContext'
import { extensionPageV2 } from './extensions/v2/registry'
import { ExtensionUiFrameV2 } from './extensions/v2/ExtensionUiFrameV2'
import { WorkspaceRecovery } from './components/WorkspaceRecovery'
import { StartupScreen } from './components/StartupScreen'

const CreatePage = lazy(() => import('./pages/CreatePage').then((module) => ({ default: module.CreatePage })))
const LibraryPage = lazy(() => import('./pages/LibraryPage').then((module) => ({ default: module.LibraryPage })))
const ReviewPage = lazy(() => import('./pages/ReviewPage').then((module) => ({ default: module.ReviewPage })))
const PlansPage = lazy(() => import('./pages/PlansPage').then((module) => ({ default: module.PlansPage })))
const ExtensionsPage = lazy(() => import('./pages/ExtensionsPage').then((module) => ({ default: module.ExtensionsPage })))

export const App = () => {
  const { data, route, plan, workspaceLoading, workspaceLoadFailure } = useApp()
  useEffect(() => {
    document.documentElement.dataset.neoAnkiWorkspaceReady = workspaceLoading ? 'false' : workspaceLoadFailure ? 'recovery' : 'true'
  }, [workspaceLoadFailure, workspaceLoading])
  const isolatedPage = extensionPageV2(route)
  if (workspaceLoading) return <StartupScreen />
  if (workspaceLoadFailure) return <WorkspaceRecovery />
  if (!data.settings.onboardingComplete) return <Onboarding />
  return (
    <AppShell>
      <Suspense fallback={<div className="route-loading" role="status">Loading view…</div>}>
      {route === 'today' && <TodayPage />}
      {route === 'library' && <LibraryPage />}
      {route === 'create' && <CreatePage />}
      {route === 'plans' && <PlansPage />}
      {(route === 'extensions' || route.startsWith('extensions:')) && <ExtensionsPage />}
      {isolatedPage && <section className="extension-page-v2"><h1>{isolatedPage.label}</h1><ExtensionUiFrameV2 contribution={isolatedPage} dto={{ workspaceRevision: data.updatedAt, summary: { notes: data.items.length, cards: data.cards.length, dueToday: plan.dueTotal } }} /></section>}
      {route === 'review' && <ReviewPage />}
      </Suspense>
    </AppShell>
  )
}
