import { ExtensionManagerPanel } from '../components/ExtensionManagerPanel'
import { extensionUiContributionsV2 } from '../extensions/v2/registry'
import { useApp } from '../state/AppContext'

export const ExtensionsPage = () => {
  const { route } = useApp()
  const focusExtensionId = route.startsWith('extensions:') ? route.slice('extensions:'.length) : ''
  const contributions = focusExtensionId ? extensionUiContributionsV2().filter((entry) => entry.extensionId === focusExtensionId && (entry.surface === 'migration' || entry.surface === 'settings')) : []
  const configuration = contributions.find((entry) => entry.surface === 'migration') || contributions[0]
  const configurationId = configuration ? `${configuration.extensionId}:${configuration.id}` : ''
  return <div className="page extensions-page">
  <header className="page-header">
    <div>
      <p className="eyebrow">Extend your workspace</p>
      <h1>Extensions</h1>
      <p className="page-intro">Add focused tools for authoring, review, import, planning, and accessibility—then configure them without leaving this screen.</p>
    </div>
  </header>
  <ExtensionManagerPanel key={configurationId || focusExtensionId || 'browse'} fullPage focusExtensionId={configuration ? '' : focusExtensionId} openConfigurationId={configurationId} />
</div>
}
