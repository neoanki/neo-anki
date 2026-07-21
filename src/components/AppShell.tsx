import { BookOpen, Clock3, Flag, Library, MoreHorizontal, Plus, Puzzle, Settings } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useApp } from '../state/AppContext'
import type { Route } from '../types'
import { formatDuration } from '../lib/date'
import { Brand } from './Brand'
import { SettingsPanel } from './SettingsPanel'
import { extensionUiContributionsV2 } from '../extensions/v2/registry'

const primaryCoreLinks: { route: Route; label: string; icon: typeof Clock3 }[] = [
  { route: 'today', label: 'Today', icon: Clock3 },
  { route: 'library', label: 'Library', icon: Library },
  { route: 'extensions', label: 'Extensions', icon: Puzzle },
]
export const AppShell = ({ children }: { children: ReactNode }) => {
  const { route, navigate, plan, persistenceError, persistenceState, retryPersistence } = useApp()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const moreRef = useRef<HTMLDetailsElement>(null)
  const previousRouteRef = useRef(route)
  const previousSettingsOpenRef = useRef(false)
  const hiddenNav = route === 'review'
  const extensionLinks = useMemo(() => extensionUiContributionsV2('page').map((page) => ({ route: page.route, label: page.label, icon: Puzzle })), [])
  const hasWorkspaceTools = useMemo(() => extensionUiContributionsV2('workspace').length > 0, [])
  const links = useMemo(() => [...primaryCoreLinks, ...(hasWorkspaceTools ? [{ route: 'plans', label: 'Plans', icon: Flag }] : []), ...extensionLinks], [extensionLinks, hasWorkspaceTools])
  const bottomLinks = primaryCoreLinks
  const overflowLinks = links.filter((link) => !bottomLinks.some((bottom) => bottom.route === link.route))
  const routeTitle = route.startsWith('extensions:') ? 'Extensions' : ({ today: 'Today', library: 'Library', create: 'New knowledge', plans: 'Plans & sharing', extensions: 'Extensions', ...Object.fromEntries(extensionLinks.map((link) => [link.route, link.label])) } as Partial<Record<Route, string>>)[route]
  const isCurrent = (target: Route) => target === 'extensions' ? route === 'extensions' || route.startsWith('extensions:') : route === target
  const shortcutModifier = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'

  useEffect(() => {
    if (!['today', 'library', 'create', 'extensions', 'review'].includes(route) && !route.startsWith('extensions:') && !(route === 'plans' && hasWorkspaceTools) && !extensionLinks.some((link) => link.route === route)) navigate('today')
  }, [extensionLinks, hasWorkspaceTools, navigate, route])

  useEffect(() => window.neoAnkiDesktop?.onNavigate((destination) => {
    if (destination === 'settings') setSettingsOpen(true)
    else if (destination === 'create' || links.some((link) => link.route === destination)) navigate(destination)
  }), [links, navigate])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && settingsOpen) {
        event.preventDefault()
        setSettingsOpen(false)
        return
      }
      if (!(event.metaKey || event.ctrlKey)) return
      const shortcuts: Record<string, Route> = { '1': 'today', '2': 'library', '3': 'extensions', n: 'create' }
      if (hasWorkspaceTools) shortcuts['4'] = 'plans'
      else if (extensionLinks[0]) shortcuts['4'] = extensionLinks[0].route
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
  }, [extensionLinks, hasWorkspaceTools, navigate, settingsOpen])

  useEffect(() => {
    const routeChanged = previousRouteRef.current !== route
    const settingsClosed = previousSettingsOpenRef.current && !settingsOpen
    previousRouteRef.current = route
    previousSettingsOpenRef.current = settingsOpen
    if (routeChanged || settingsClosed) document.getElementById('main-content')?.focus()
  }, [route, settingsOpen])

  return (
    <div className={hiddenNav ? 'app-shell review-mode' : 'app-shell'}>
      <a className="skip-link" href="#main-content">Skip to content</a>
      {persistenceState !== 'saved' && <div className={`persistence-status ${persistenceState}`} role={persistenceState === 'failed' ? 'alert' : 'status'} aria-live="polite">
        {persistenceState === 'saving' && <span>Saving changes…</span>}
        {persistenceState === 'failed' && <><span><strong>Changes are not saved.</strong> {persistenceError}</span><button type="button" onClick={() => void retryPersistence()}>Retry save</button></>}
      </div>}
      {!hiddenNav && (
        <aside className="sidebar">
          <Brand />
          <nav aria-label="Primary navigation">
            <span className="sidebar-section-label">Workspace</span>
            {links.map(({ route: target, label, icon: Icon }, index) => (
              <button key={target} className={isCurrent(target) ? 'nav-item active' : 'nav-item'} onClick={() => navigate(target)} aria-current={isCurrent(target) ? 'page' : undefined}>
                <Icon size={19} />
                <span>{label}</span>
                {index < 4 && <kbd>{shortcutModifier}{index + 1}</kbd>}
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
          <strong>{routeTitle}</strong>
          <div className="desktop-toolbar-actions">
            <button className="toolbar-button" onClick={() => navigate('create')} aria-current={route === 'create' ? 'page' : undefined}><Plus size={16} /> New item <kbd>{shortcutModifier}N</kbd></button>
            <button className="toolbar-icon-button" onClick={() => setSettingsOpen(true)} aria-label="Open settings"><Settings size={17} /></button>
          </div>
        </header>
      )}

      <main id="main-content" className="main-content" tabIndex={-1}>{children}</main>

      {!hiddenNav && (
        <nav className="bottom-nav" aria-label="Primary navigation">
          {bottomLinks.map(({ route: target, label, icon: Icon }) => (
            <button key={target} className={isCurrent(target) ? 'bottom-nav-item active' : 'bottom-nav-item'} onClick={() => navigate(target)} aria-current={isCurrent(target) ? 'page' : undefined}>
              <Icon size={21} /><span>{label}</span>
            </button>
          ))}
          <details ref={moreRef} className="bottom-more"><summary className={overflowLinks.some((link) => link.route === route) || settingsOpen ? 'bottom-nav-item active' : 'bottom-nav-item'}><MoreHorizontal size={21}/><span>More</span></summary><div className="bottom-overflow-menu"><button onClick={() => { navigate('create'); moreRef.current?.removeAttribute('open') }} aria-current={route === 'create' ? 'page' : undefined}><Plus size={18}/><span>Add knowledge</span></button>{overflowLinks.map(({ route: target, label, icon: Icon }) => <button key={target} onClick={() => { navigate(target); moreRef.current?.removeAttribute('open') }} aria-current={route === target ? 'page' : undefined}><Icon size={18}/><span>{label}</span></button>)}<button onClick={() => { setSettingsOpen(true); moreRef.current?.removeAttribute('open') }}><Settings size={18}/><span>Settings</span></button></div></details>
        </nav>
      )}
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
