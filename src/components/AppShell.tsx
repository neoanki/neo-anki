import { BookOpen, Clock3, Flag, Library, Plus, Puzzle, Settings } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useApp } from '../state/AppContext'
import type { Route } from '../types'
import { formatDuration } from '../lib/date'
import { Brand } from './Brand'
import { SettingsPanel } from './SettingsPanel'
import { extensionRuntime } from '../extensions/runtime'

const coreLinks: { route: Route; label: string; icon: typeof Clock3 }[] = [
  { route: 'today', label: 'Today', icon: Clock3 },
  { route: 'library', label: 'Library', icon: Library },
  { route: 'plans', label: 'Plans', icon: Flag },
]
const extensionLinks = extensionRuntime.pages().map((page) => ({ route: page.route, label: page.label, icon: Puzzle }))
const links = [...coreLinks, ...extensionLinks]

const routeTitles: Partial<Record<Route, string>> = {
  today: 'Today',
  library: 'Library',
  create: 'New knowledge',
  plans: 'Plans & sharing',
  ...Object.fromEntries(extensionLinks.map((link) => [link.route, link.label])),
}

export const AppShell = ({ children }: { children: ReactNode }) => {
  const { route, navigate, plan } = useApp()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const hiddenNav = route === 'review'

  useEffect(() => window.neoAnkiDesktop?.onNavigate((destination) => {
    if (destination === 'settings') setSettingsOpen(true)
    else if (destination === 'create' || links.some((link) => link.route === destination)) navigate(destination)
  }), [navigate])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && settingsOpen) {
        event.preventDefault()
        setSettingsOpen(false)
        return
      }
      if (!(event.metaKey || event.ctrlKey)) return
      const shortcuts: Record<string, Route> = { '1': 'today', '2': 'library', '3': 'plans', n: 'create' }
      if (extensionLinks[0]) shortcuts['4'] = extensionLinks[0].route
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
            {links.map(({ route: target, label, icon: Icon }, index) => (
              <button key={target} className={route === target ? 'nav-item active' : 'nav-item'} onClick={() => navigate(target)} aria-current={route === target ? 'page' : undefined}>
                <Icon size={19} />
                <span>{label}</span>
                {index < 4 && <kbd>⌘{index + 1}</kbd>}
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
