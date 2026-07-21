import { ArrowLeft } from 'lucide-react'
import { ExtensionManagerPanel } from '../components/ExtensionManagerPanel'
import { extensionUiContributionsV2 } from '../extensions/v2/registry'
import { useApp } from '../state/AppContext'

const extensionReturnKey = 'neoanki:extensions:return:v1'
const shouldReturnToCreate = () => {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(extensionReturnKey) || 'null') as { route?: unknown; createdAt?: unknown } | null
    return value?.route === 'create' && typeof value.createdAt === 'number' && Date.now() - value.createdAt < 30 * 60 * 1000
  } catch { return false }
}

export const ExtensionsPage = () => {
  const { route, navigate } = useApp()
  const returnToCreate = shouldReturnToCreate()
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
    {returnToCreate && <button className="secondary-button" onClick={() => { window.sessionStorage.removeItem(extensionReturnKey); navigate('create') }}><ArrowLeft size={18}/> Back to new knowledge</button>}
  </header>
  <ExtensionManagerPanel key={configurationId || focusExtensionId || 'browse'} fullPage focusExtensionId={configuration ? '' : focusExtensionId} openConfigurationId={configurationId} />
</div>
}
