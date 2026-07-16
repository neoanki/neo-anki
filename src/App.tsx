import { AppShell } from './components/AppShell'
import { Onboarding } from './components/Onboarding'
import { CreatePage } from './pages/CreatePage'
import { LibraryPage } from './pages/LibraryPage'
import { ReviewPage } from './pages/ReviewPage'
import { TodayPage } from './pages/TodayPage'
import { PlansPage } from './pages/PlansPage'
import { useApp } from './state/AppContext'
import { extensionRuntime } from './extensions/runtime'

export const App = () => {
  const { data, route, plan, runExtensionCommand } = useApp()
  const extensionPage = extensionRuntime.page(route)
  const ExtensionPage = extensionPage?.component
  if (!data.settings.onboardingComplete) return <Onboarding />
  return (
    <AppShell>
      {route === 'today' && <TodayPage />}
      {route === 'library' && <LibraryPage />}
      {route === 'create' && <CreatePage />}
      {route === 'plans' && <PlansPage />}
      {ExtensionPage && extensionPage && <ExtensionPage extensionId={extensionPage.route} data={data} plan={plan} runCommand={runExtensionCommand} />}
      {route === 'review' && <ReviewPage />}
    </AppShell>
  )
}
