import { BarChart3, BookOpen, Clock3, Flag, Library, Plus, Settings } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useApp } from '../state/AppContext'
import type { Route } from '../types'
import { Brand } from './Brand'
import { SettingsPanel } from './SettingsPanel'

const links: { route: Route; label: string; icon: typeof Clock3 }[] = [
  { route: 'today', label: 'Today', icon: Clock3 },
  { route: 'library', label: 'Library', icon: Library },
  { route: 'create', label: 'Create', icon: Plus },
  { route: 'plans', label: 'Plans', icon: Flag },
  { route: 'insights', label: 'Insights', icon: BarChart3 },
]

export const AppShell = ({ children }: { children: ReactNode }) => {
  const { route, navigate, plan } = useApp()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const hiddenNav = route === 'review'

  return (
    <div className={hiddenNav ? 'app-shell review-mode' : 'app-shell'}>
      <a className="skip-link" href="#main-content">Skip to content</a>
      {!hiddenNav && (
        <aside className="sidebar">
          <Brand />
          <nav aria-label="Primary navigation">
            {links.map(({ route: target, label, icon: Icon }) => (
              <button key={target} className={route === target ? 'nav-item active' : 'nav-item'} onClick={() => navigate(target)} aria-current={route === target ? 'page' : undefined}>
                <Icon size={19} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
          <div className="sidebar-footer">
            <div className="mini-budget">
              <BookOpen size={17} />
              <div><strong>{plan.queue.length} planned</strong><span>{Math.round(plan.budgetSeconds / 60)} min today</span></div>
            </div>
            <button className="nav-item" onClick={() => setSettingsOpen(true)}><Settings size={19} /><span>Settings</span></button>
          </div>
        </aside>
      )}

      <main id="main-content" className="main-content" tabIndex={-1}>{children}</main>

      {!hiddenNav && (
        <nav className="bottom-nav" aria-label="Primary navigation">
          {links.map(({ route: target, label, icon: Icon }) => (
            <button key={target} className={route === target ? 'bottom-nav-item active' : 'bottom-nav-item'} onClick={() => navigate(target)} aria-current={route === target ? 'page' : undefined}>
              <Icon size={21} /><span>{label}</span>
            </button>
          ))}
        </nav>
      )}
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
