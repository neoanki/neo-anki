import { ExtensionManagerPanel } from '../components/ExtensionManagerPanel'
import { useApp } from '../state/AppContext'

export const ExtensionsPage = () => {
  const { route } = useApp()
  const focusExtensionId = route.startsWith('extensions:') ? route.slice('extensions:'.length) : ''
  return <div className="page extensions-page">
  <header className="page-header">
    <div>
      <p className="eyebrow">Extend your workspace</p>
      <h1>Extensions</h1>
      <p className="page-intro">Add focused tools for authoring, review, import, planning, and accessibility—then configure them without leaving this screen.</p>
    </div>
  </header>
  <ExtensionManagerPanel key={focusExtensionId || 'browse'} fullPage focusExtensionId={focusExtensionId} />
</div>
}
