import { Download, ExternalLink, RefreshCw, Search, ShieldCheck, Store } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { MARKETPLACE_CATALOG_URL, MARKETPLACE_REPOSITORY_URL, MAX_MARKETPLACE_CATALOG_BYTES, compareMarketplaceVersions, filterMarketplaceExtensions, marketplaceCategories, parseMarketplaceCatalog, type MarketplaceCategory, type MarketplaceExtension } from '@neo-anki/extension-marketplace'
import { safeExternalUrl } from '../lib/urls'

const categoryLabels: Record<MarketplaceCategory, string> = { study: 'Study', authoring: 'Authoring', 'import-export': 'Import & export', planning: 'Planning', analytics: 'Analytics', accessibility: 'Accessibility', integration: 'Integrations', appearance: 'Appearance' }

const loadBrowserCatalog = async () => {
  const response = await fetch(MARKETPLACE_CATALOG_URL, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`Marketplace returned ${response.status}.`)
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > MAX_MARKETPLACE_CATALOG_BYTES) throw new Error('Marketplace catalog is larger than allowed.')
  const text = await response.text()
  if (new TextEncoder().encode(text).byteLength > MAX_MARKETPLACE_CATALOG_BYTES) throw new Error('Marketplace catalog is larger than allowed.')
  try { return parseMarketplaceCatalog(JSON.parse(text)).extensions }
  catch (reason) { throw new Error(reason instanceof Error ? reason.message : 'Marketplace catalog is invalid.') }
}

export const ExtensionMarketplace = ({ installed, candidateActive, onCandidate }: { installed: readonly NeoAnkiInstalledExtension[]; candidateActive: boolean; onCandidate: (candidate: NeoAnkiExtensionCandidate) => void }) => {
  const bridge = window.neoAnkiDesktop
  const [extensions, setExtensions] = useState<MarketplaceExtension[]>([])
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<MarketplaceCategory | 'all'>('all')
  const [loading, setLoading] = useState(true)
  const [stagingId, setStagingId] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setExtensions(bridge ? await bridge.listMarketplaceExtensions() : await loadBrowserCatalog()) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load the extension marketplace.') }
    finally { setLoading(false) }
  }, [bridge])

  useEffect(() => { const timer = window.setTimeout(() => { void load() }, 0); return () => window.clearTimeout(timer) }, [load])
  const visible = useMemo(() => filterMarketplaceExtensions(extensions, query, category), [extensions, query, category])
  const installedVersions = useMemo(() => new Map(installed.map(record => [record.manifest.id, record.manifest.version])), [installed])

  const stage = async (extension: MarketplaceExtension) => {
    if (!bridge) return
    setStagingId(extension.id); setError('')
    try { onCandidate(await bridge.stageMarketplaceExtension(extension.id, extension.release.version)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not download that marketplace extension.') }
    finally { setStagingId('') }
  }

  return <section className="marketplace" aria-labelledby="marketplace-title">
    <div className="marketplace-heading"><span><Store size={18}/><span><strong id="marketplace-title">Marketplace</strong><small>Community extensions approved through public review</small></span></span><a href={MARKETPLACE_REPOSITORY_URL} target="_blank" rel="noopener noreferrer">Catalog <ExternalLink size={13}/></a></div>
    <p className="marketplace-trust"><ShieldCheck size={16}/><span>Listings have verified release metadata and publisher-key continuity. Package signatures prove integrity, not safety or learning effectiveness; review capabilities before installing.</span></p>
    <div className="marketplace-filters">
      <label className="marketplace-search"><span className="sr-only">Search marketplace</span><Search size={16}/><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search extensions" /></label>
      <label><span className="sr-only">Marketplace category</span><select value={category} onChange={event => setCategory(event.target.value as MarketplaceCategory | 'all')}><option value="all">All categories</option>{marketplaceCategories.map(value => <option value={value} key={value}>{categoryLabels[value]}</option>)}</select></label>
    </div>
    {loading && <p className="marketplace-state" role="status"><RefreshCw className="spin" size={16}/> Loading approved extensions…</p>}
    {error && <div className="marketplace-state error" role="status" aria-live="polite"><span>{error}</span><button className="text-button" onClick={() => void load()}>Retry</button></div>}
    {!loading && !error && !extensions.length && <div className="marketplace-state empty"><strong>No production extensions are approved yet.</strong><span>The catalog is ready for its first publisher submission.</span><a href={`${MARKETPLACE_REPOSITORY_URL}/pulls`} target="_blank" rel="noopener noreferrer">Submit through GitHub <ExternalLink size={13}/></a></div>}
    {!loading && !error && extensions.length > 0 && !visible.length && <p className="marketplace-state empty" role="status">No extensions match that search and category.</p>}
    <div className="marketplace-grid">
      {visible.map(extension => {
        const installedVersion = installedVersions.get(extension.id)
        const update = installedVersion && compareMarketplaceVersions(extension.release.version, installedVersion) > 0
        const source = safeExternalUrl(extension.repository)
        return <article className="marketplace-card" key={extension.id}>
          <div className="marketplace-card-heading"><span><strong>{extension.name}</strong><small>by {extension.publisher.name}</small></span><code>v{extension.release.version}</code></div>
          <p>{extension.summary}</p>
          <div className="marketplace-tags">{extension.categories.map(value => <span key={value}>{categoryLabels[value]}</span>)}</div>
          <div className="marketplace-card-meta"><span>{extension.release.permissions.length} {extension.release.permissions.length === 1 ? 'capability' : 'capabilities'}</span><span>{extension.license}</span>{source && <a href={source} target="_blank" rel="noopener noreferrer">Source <ExternalLink size={12}/></a>}</div>
          {bridge ? <button className="secondary-button" disabled={candidateActive || Boolean(stagingId) || (installedVersion !== undefined && !update)} onClick={() => void stage(extension)}><Download size={16}/>{stagingId === extension.id ? 'Downloading…' : update ? `Update from v${installedVersion}` : installedVersion ? 'Installed' : 'Review & install'}</button> : <small className="marketplace-desktop-note">Installation is available in NeoAnki desktop.</small>}
        </article>
      })}
    </div>
  </section>
}
