import { lazy, Suspense } from 'react'
import { AppShell } from './components/AppShell'
import { Onboarding } from './components/Onboarding'
import { TodayPage } from './pages/TodayPage'
import { useApp } from './state/AppContext'
import { extensionRuntime } from './extensions/runtime'
import { extensionPageV2 } from './extensions/v2/registry'
import { ExtensionUiFrameV2 } from './extensions/v2/ExtensionUiFrameV2'

const CreatePage = lazy(() => import('./pages/CreatePage').then((module) => ({ default: module.CreatePage })))
const LibraryPage = lazy(() => import('./pages/LibraryPage').then((module) => ({ default: module.LibraryPage })))
const ReviewPage = lazy(() => import('./pages/ReviewPage').then((module) => ({ default: module.ReviewPage })))
const PlansPage = lazy(() => import('./pages/PlansPage').then((module) => ({ default: module.PlansPage })))

export const App = () => {
  const { data, route, plan, runExtensionCommand } = useApp()
  const extensionPage = extensionRuntime.page(route)
  const ExtensionPage = extensionPage?.component
  const isolatedPage = extensionPageV2(route)
  if (!data.settings.onboardingComplete) return <Onboarding />
  return (
    <AppShell>
      <Suspense fallback={<div className="route-loading" role="status">Loading view…</div>}>
      {route === 'today' && <TodayPage />}
      {route === 'library' && <LibraryPage />}
      {route === 'create' && <CreatePage />}
      {route === 'plans' && <PlansPage />}
      {ExtensionPage && extensionPage && <ExtensionPage moduleId={extensionPage.extensionId} data={data} plan={plan} runCommand={runExtensionCommand} />}
      {isolatedPage && <section className="extension-page-v2"><h1>{isolatedPage.label}</h1><ExtensionUiFrameV2 contribution={isolatedPage} dto={{ workspaceRevision: data.updatedAt, summary: { notes: data.items.length, cards: data.cards.length, dueToday: plan.dueTotal } }} /></section>}
      {route === 'review' && <ReviewPage />}
      </Suspense>
    </AppShell>
  )
}
