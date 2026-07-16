import { BarChart3, BookOpen, Clock3, Flag, Library, Plus, Settings } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useApp } from '../state/AppContext'
import type { Route } from '../types'
import { formatDuration } from '../lib/date'
import { Brand } from './Brand'
import { SettingsPanel } from './SettingsPanel'

const links: { route: Route; label: string; icon: typeof Clock3 }[] = [
  { route: 'today', label: 'Today', icon: Clock3 },
  { route: 'library', label: 'Library', icon: Library },
  { route: 'plans', label: 'Plans', icon: Flag },
  { route: 'insights', label: 'Insights', icon: BarChart3 },
]

const routeTitles: Partial<Record<Route, string>> = {
  today: 'Today',
  library: 'Library',
  create: 'New knowledge',
  plans: 'Plans & sharing',
  insights: 'Insights',
}

export const AppShell = ({ children }: { children: ReactNode }) => {
  const { route, navigate, plan } = useApp()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const hiddenNav = route === 'review'

  useEffect(() => window.neoAnkiDesktop?.onNavigate((destination) => {
    if (destination === 'settings') setSettingsOpen(true)
    else if (['today', 'library', 'create', 'plans', 'insights'].includes(destination)) navigate(destination as Route)
  }), [navigate])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && settingsOpen) {
        event.preventDefault()
        setSettingsOpen(false)
        return
      }
      if (!(event.metaKey || event.ctrlKey)) return
      const shortcuts: Record<string, Route> = { '1': 'today', '2': 'library', '3': 'plans', '4': 'insights', n: 'create' }
      const destination = shortcuts[event.key.toLowerCase()]
      if (destination) {
        event.preventDefault()
        navigate(destination)
      }
      if (event.key === ',') {
        event.preventDefault()
        setSettingsOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navigate, settingsOpen])

  useEffect(() => {
    if (!settingsOpen) document.getElementById('main-content')?.focus()
  }, [route, settingsOpen])

  return (
    <div className={hiddenNav ? 'app-shell review-mode' : 'app-shell'}>
      <a className="skip-link" href="#main-content">Skip to content</a>
      {!hiddenNav && (
        <aside className="sidebar">
          <Brand />
          <nav aria-label="Primary navigation">
            <span className="sidebar-section-label">Workspace</span>
            {links.map(({ route: target, label, icon: Icon }) => (
              <button key={target} className={route === target ? 'nav-item active' : 'nav-item'} onClick={() => navigate(target)} aria-current={route === target ? 'page' : undefined}>
                <Icon size={19} />
                <span>{label}</span>
                <kbd>{target === 'today' ? '⌘1' : target === 'library' ? '⌘2' : target === 'plans' ? '⌘3' : '⌘4'}</kbd>
              </button>
            ))}
          </nav>
          <div className="sidebar-footer">
            <div className="mini-budget">
              <BookOpen size={17} />
              <div><strong>{plan.queue.length} available</strong><span>{formatDuration(plan.remainingSeconds)} left today</span></div>
            </div>
            <button className="nav-item" onClick={() => setSettingsOpen(true)}><Settings size={19} /><span>Settings</span></button>
          </div>
        </aside>
      )}

      {!hiddenNav && (
        <header className="desktop-toolbar">
          <strong>{routeTitles[route]}</strong>
          <div className="desktop-toolbar-actions">
            <button className="toolbar-button" onClick={() => navigate('create')} aria-current={route === 'create' ? 'page' : undefined}><Plus size={16} /> New item <kbd>⌘N</kbd></button>
            <button className="toolbar-icon-button" onClick={() => setSettingsOpen(true)} aria-label="Open settings"><Settings size={17} /></button>
          </div>
        </header>
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
