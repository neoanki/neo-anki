import { AppShell } from './components/AppShell'
import { Onboarding } from './components/Onboarding'
import { CreatePage } from './pages/CreatePage'
import { InsightsPage } from './pages/InsightsPage'
import { LibraryPage } from './pages/LibraryPage'
import { ReviewPage } from './pages/ReviewPage'
import { TodayPage } from './pages/TodayPage'
import { PlansPage } from './pages/PlansPage'
import { useApp } from './state/AppContext'

export const App = () => {
  const { data, route } = useApp()
  if (!data.settings.onboardingComplete) return <Onboarding />
  return (
    <AppShell>
      {route === 'today' && <TodayPage />}
      {route === 'library' && <LibraryPage />}
      {route === 'create' && <CreatePage />}
      {route === 'plans' && <PlansPage />}
      {route === 'insights' && <InsightsPage />}
      {route === 'review' && <ReviewPage />}
    </AppShell>
  )
}
