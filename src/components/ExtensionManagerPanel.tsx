import { AlertTriangle, Check, ExternalLink, PackagePlus, Puzzle, Settings2, ShieldCheck, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { AnyExtensionPermission } from '../../packages/extension-sdk/src/index'
import { extensionRuntime } from '../extensions/runtime'
import { safeExternalUrl } from '../lib/urls'
import { ExtensionMarketplace } from './ExtensionMarketplace'
import { extensionUiContributionsV2 } from '../extensions/v2/registry'
import { ExtensionUiFrameV2 } from '../extensions/v2/ExtensionUiFrameV2'
import { flushPendingSaves } from '../lib/storage'

const permissionLabels: Record<string, string> = {
  'study:read': 'Read a scoped study projection',
  'study:signals': 'Return bounded study priority signals',
  'study:prompt-types': 'Create and render declared prompt types',
  'study:queue-policies': 'Score bounded recovery queue candidates',
  'content:read': 'Read declared content projections',
  'content:patch-own': 'Propose validated changes in owned scope',
  'content:migrate': 'Inspect and commit validated workspace migrations',
  'media:create': 'Create content-hashed media through core',
  'files:save': 'Save an export through Neo Anki’s file picker',
  'ui:open-external': 'Open approved HTTPS or email links',
  'secrets:device': 'Use atomic device-local secure credentials',
  'config:sync': 'Store non-secret settings with the encrypted workspace',
  'ui:settings': 'Add an isolated Settings panel',
  'ui:review': 'Add an isolated review panel',
  'ui:page': 'Add an isolated application page',
  'ui:create': 'Add an isolated authoring panel',
  'ui:workspace': 'Add an isolated workspace tool',
  'ui:migration': 'Add an isolated migration panel',
}

const formatBytes = (bytes: number) => bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`

const ManifestSummary = ({ manifest, addedPermissions = [] }: { manifest: { name: string; permissions: readonly string[]; networkDomains?: readonly string[] }; addedPermissions?: readonly AnyExtensionPermission[] }) => (
  <div className="extension-permissions" aria-label={`${manifest.name} permissions`}>
    {manifest.permissions.length ? manifest.permissions.map((permission) => <span className={addedPermissions.includes(permission as AnyExtensionPermission) ? 'permission-chip new' : 'permission-chip'} key={permission}>{permissionLabels[permission] || permission}{addedPermissions.includes(permission as AnyExtensionPermission) && <small>New</small>}</span>) : <span className="permission-chip">No contributed capabilities</span>}
    {manifest.networkDomains?.map((domain) => <span className="permission-chip" key={`network:${domain}`}>HTTPS · {domain}</span>)}
  </div>
)

type ExtensionHubView = 'browse' | 'installed' | 'configure'
const EXTENSION_HUB_STATE_KEY = 'neo-anki:extensions-hub:v1'
const loadHubState = (): { view: ExtensionHubView; configurationId: string; notice?: string } => {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(EXTENSION_HUB_STATE_KEY) || 'null') as { view?: unknown; configurationId?: unknown; notice?: unknown } | null
    return { view: parsed?.view === 'installed' || parsed?.view === 'configure' ? parsed.view : 'browse', configurationId: typeof parsed?.configurationId === 'string' ? parsed.configurationId : '', ...(typeof parsed?.notice === 'string' ? { notice: parsed.notice } : {}) }
  } catch { return { view: 'browse', configurationId: '' } }
}
const saveHubState = (state: { view: ExtensionHubView; configurationId: string; notice?: string }) => {
  try { window.sessionStorage.setItem(EXTENSION_HUB_STATE_KEY, JSON.stringify(state)) } catch { /* Reload still works when session state is unavailable. */ }
}

export const ExtensionManagerPanel = ({ fullPage = false, focusExtensionId = '', openConfigurationId = '' }: { fullPage?: boolean; focusExtensionId?: string; openConfigurationId?: string }) => {
  const bridge = window.neoAnkiDesktop
  const [restoredHubState] = useState(loadHubState)
  const safeMode = new URLSearchParams(window.location.search).get('safe-mode') === '1'
  const [installed, setInstalled] = useState<NeoAnkiInstalledExtension[]>([])
  const [candidate, setCandidate] = useState<NeoAnkiExtensionCandidate | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState(restoredHubState.notice || '')
  const [view, setView] = useState<ExtensionHubView>(openConfigurationId ? 'configure' : fullPage ? restoredHubState.view : 'browse')
  const [configurationId, setConfigurationId] = useState(openConfigurationId || restoredHubState.configurationId)
  const [uninstallTarget, setUninstallTarget] = useState<NeoAnkiInstalledExtension | null>(null)
  const diagnostics = extensionRuntime.getDiagnostics()
  const configurable = useMemo(() => extensionUiContributionsV2().filter((entry) => entry.surface === 'settings' || entry.surface === 'migration'), [])
  const selectedConfiguration = configurable.find((entry) => `${entry.extensionId}:${entry.id}` === configurationId) || configurable[0]

  useEffect(() => { if (fullPage) saveHubState({ view, configurationId }) }, [configurationId, fullPage, view])

  useEffect(() => {
    if (!bridge) return
    let current = true
    void bridge.listExtensions().then((records) => { if (current) setInstalled(records) }).catch((reason) => { if (current) setError(reason instanceof Error ? reason.message : 'Could not read installed extensions.') })
    return () => { current = false }
  }, [bridge])

  useEffect(() => () => { if (candidate && bridge) void bridge.discardExtension(candidate.token) }, [bridge, candidate])

  const choosePackage = async () => {
    if (!bridge) return
    setBusy(true); setError(''); setMessage('')
    try {
      const result = await bridge.chooseExtensionPackage()
      if (result.candidate) setCandidate(result.candidate)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not inspect that extension package.') }
    finally { setBusy(false) }
  }

  const cancelCandidate = async () => {
    if (candidate && bridge) await bridge.discardExtension(candidate.token)
    setCandidate(null)
  }

  const installCandidate = async () => {
    if (!candidate || !bridge) return
    setBusy(true); setError('')
    let installedSuccessfully = false
    try {
      await bridge.installExtension(candidate.token)
      installedSuccessfully = true
      const notice = `${candidate.manifest.name} ${candidate.currentVersion ? 'updated' : 'installed'} and ready.`
      setCandidate(null); saveHubState({ view, configurationId, notice })
      await flushPendingSaves(); await bridge.reloadForExtensions()
    } catch (reason) { setError(reason instanceof Error ? reason.message : installedSuccessfully ? 'The extension was installed, but Neo Anki could not reload.' : 'Could not install that extension.') }
    finally { setBusy(false) }
  }

  const toggle = async (record: NeoAnkiInstalledExtension) => {
    if (!bridge) return
    setBusy(true); setError('')
    let changed = false
    try {
      await bridge.setExtensionEnabled(record.manifest.id, !record.enabled)
      changed = true
      const notice = `${record.manifest.name} is ${record.enabled ? 'disabled' : 'enabled'}.`
      saveHubState({ view, configurationId, notice }); await flushPendingSaves(); await bridge.reloadForExtensions()
    } catch (reason) { setError(reason instanceof Error ? reason.message : changed ? 'The extension state changed, but Neo Anki could not reload.' : 'Could not change extension state.') }
    finally { setBusy(false) }
  }

  const uninstall = async (record: NeoAnkiInstalledExtension, deleteSecrets: boolean) => {
    if (!bridge) return
    const hasSecrets = record.manifest.permissions.includes('secrets:device')
    setBusy(true); setError('')
    let removed = false
    try {
      await bridge.uninstallExtension(record.manifest.id, deleteSecrets)
      removed = true
      const notice = `${record.manifest.name} was uninstalled${hasSecrets ? deleteSecrets ? '; its device-local credentials were deleted' : '; its device-local credentials were retained' : ''}.`
      setUninstallTarget(null)
      saveHubState({ view, configurationId, notice }); await flushPendingSaves(); await bridge.reloadForExtensions()
    } catch (reason) { setError(reason instanceof Error ? reason.message : removed ? 'The extension was removed, but Neo Anki could not reload.' : 'Could not uninstall that extension.') }
    finally { setBusy(false) }
  }

  return <div className={fullPage ? 'extension-manager extension-hub' : 'setting-block extension-manager'}>
    {!fullPage && <div className="extensions-heading"><span><Puzzle size={18} /><strong>Extensions</strong></span><small>{installed.filter((record) => record.enabled).length} active</small></div>}
    {!fullPage && <p>Discover, manage, and configure signed additions to Neo Anki. Extension code runs in isolated workers and interface frames.</p>}

    {fullPage && <div className="extension-hub-tabs" role="tablist" aria-label="Extensions views">
      <button role="tab" aria-selected={view === 'browse'} onClick={() => setView('browse')}>Browse</button>
      <button role="tab" aria-selected={view === 'installed'} onClick={() => setView('installed')}>Installed <span>{installed.length}</span></button>
      <button role="tab" aria-selected={view === 'configure'} onClick={() => setView('configure')}>Configure <span>{configurable.length}</span></button>
    </div>}

    {safeMode && <div className="extension-reload" role="status"><span><ShieldCheck size={17}/><span><strong>Safe mode is active</strong><small>Locally installed extensions were skipped for this launch.</small></span></span><button className="secondary-button compact" onClick={() => { window.location.search = '' }}>Restart normally</button></div>}

    {(!fullPage || view === 'browse') && !bridge && <p className="extension-browser-note">Browse on this device, then <a href="https://github.com/neoanki/neo-anki/releases/latest" target="_blank" rel="noopener noreferrer">get Neo Anki desktop</a> to install packages and run extension workers. The PWA keeps core study available but cannot activate desktop extensions.</p>}
    {(!fullPage || view === 'browse') && <ExtensionMarketplace installed={installed} candidateActive={Boolean(candidate)} focusExtensionId={focusExtensionId}/>}

    {(!fullPage || view === 'browse') && bridge && <button className="secondary-button extension-install-button" disabled={busy || Boolean(candidate)} onClick={choosePackage}><PackagePlus size={18} /> {busy ? 'Reading package…' : 'Install from file…'}</button>}

    {candidate && <section className="extension-review" aria-labelledby="extension-review-title">
      <div className="extension-review-heading"><span><ShieldCheck size={20}/><span><small>{candidate.currentVersion ? candidate.isDowngrade ? 'Review downgrade' : 'Review update' : 'Review installation'}</small><h3 id="extension-review-title">{candidate.manifest.name}</h3></span></span><code>v{candidate.manifest.version}</code></div>
      <p>{candidate.manifest.description || 'This extension did not provide a description.'}</p>
      <dl className="extension-facts"><div><dt>Publisher</dt><dd>{candidate.manifest.publisher}</dd></div><div><dt>Package</dt><dd>{formatBytes(candidate.compressedBytes)}</dd></div><div><dt>Fingerprint</dt><dd><code>{candidate.digest.slice(0, 12)}</code></dd></div><div><dt>Runtime</dt><dd>Signed · isolated SDK 2</dd></div>{candidate.manifest.minimumNeoAnkiVersion && <div><dt>Requires Neo Anki</dt><dd>{candidate.manifest.minimumNeoAnkiVersion}+</dd></div>}<div><dt>Publisher key</dt><dd><code>{candidate.manifest.publisherKey.slice(0, 16)}…</code></dd></div><div><dt>Source commit</dt><dd><code>{candidate.manifest.provenance.sourceCommit.slice(0, 12)}</code></dd></div>{candidate.manifest.provenance.coreCommit && <div><dt>Core SDK commit</dt><dd><code>{candidate.manifest.provenance.coreCommit.slice(0, 12)}</code></dd></div>}{candidate.currentVersion && <div><dt>Installed</dt><dd>v{candidate.currentVersion}</dd></div>}</dl>
      <strong className="permission-title">Requested capabilities</strong>
      <ManifestSummary manifest={candidate.manifest} addedPermissions={candidate.addedPermissions}/>
      <p className="extension-trust-warning"><AlertTriangle size={16}/><span>Worker code and UI run in isolated contexts; core validates every capability call and workspace patch. A valid signature proves package integrity, not publisher identity, so publisher trust still matters.</span></p>
      {candidate.isDowngrade && <p className="extension-error" role="alert">This package is older than the installed version. Downgrading may remove features or make data created by the extension unavailable.</p>}
      <div className="button-row extension-review-actions"><button className="secondary-button" disabled={busy} onClick={() => void cancelCandidate()}>Cancel</button><button className="primary-button" disabled={busy} onClick={() => void installCandidate()}><Check size={17}/> {candidate.currentVersion ? candidate.isDowngrade ? 'Downgrade' : 'Update' : 'Install extension'}</button></div>
    </section>}

    {error && <p className="extension-error" role="alert">{error} Try the package again or verify it with the SDK CLI.</p>}
    {message && <p className="inline-message" role="status">{message}</p>}

    {(!fullPage || view === 'installed') && <div className="extension-list">
      {!installed.length && <div className="marketplace-state empty"><strong>No extensions installed</strong><span>Browse the catalog to add authoring, study, import, and planning tools.</span>{fullPage && <button className="secondary-button" onClick={() => setView('browse')}>Browse extensions</button>}</div>}
      {installed.map((record) => {
        const failure = diagnostics.find((diagnostic) => diagnostic.extensionId === record.manifest.id)
        const homepage = safeExternalUrl(record.manifest.homepage)
        const settings = configurable.find((entry) => entry.extensionId === record.manifest.id)
        return <details className="extension-row" key={record.manifest.id}><summary><span><strong>{record.manifest.name}</strong><small>Signed isolated SDK 2 package · {record.manifest.publisher}</small></span><span className="extension-state"><i className={record.enabled && !failure ? '' : 'inactive'}>{failure ? 'Error' : record.enabled ? 'Active' : 'Disabled'}</i><code>v{record.manifest.version}</code></span></summary><p className="extension-description">{record.manifest.description}</p>{failure && <p className="extension-error" role="status">{failure.message}</p>}<ManifestSummary manifest={record.manifest}/><div className="extension-record-meta"><span>SHA-256 <code>{record.digest.slice(0, 12)}</code></span><span>Key <code>{record.manifest.publisherKey.slice(0, 12)}</code></span><span>Source <code>{record.manifest.provenance.sourceCommit.slice(0, 12)}</code></span>{homepage && <a href={homepage} target="_blank" rel="noopener noreferrer">Homepage <ExternalLink size={13}/></a>}</div><div className="extension-actions">{settings && <button className="secondary-button compact" onClick={() => { setConfigurationId(`${settings.extensionId}:${settings.id}`); setView('configure') }}><Settings2 size={15}/> Configure</button>}<button className="secondary-button compact" disabled={busy} onClick={() => void toggle(record)}>{record.enabled ? 'Disable' : 'Enable'}</button><button className="text-button danger" disabled={busy} onClick={() => setUninstallTarget(record)}><Trash2 size={15}/> Uninstall</button></div></details>
      })}
    </div>}
    {fullPage && view === 'configure' && <div className="extension-configure-layout">
      {configurable.length ? <><nav aria-label="Extension configuration">{configurable.map((entry) => <button key={`${entry.extensionId}:${entry.id}`} className={entry === selectedConfiguration ? 'active' : ''} aria-current={entry === selectedConfiguration ? 'page' : undefined} onClick={() => setConfigurationId(`${entry.extensionId}:${entry.id}`)}><strong>{entry.label}</strong><small>{entry.surface === 'migration' ? 'Import and migration' : 'Settings'}</small></button>)}</nav>{selectedConfiguration && <section className="extension-configure-panel"><header><p className="eyebrow">Extension configuration</p><h2>{selectedConfiguration.label}</h2><p>{selectedConfiguration.manifest.description}</p></header><ExtensionUiFrameV2 contribution={selectedConfiguration} dto={{ theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light', platform: window.neoAnkiDesktop ? 'desktop' : 'web', mode: 'settings', operation: 'additive' }}/></section>}</> : <div className="marketplace-state empty"><strong>No configurable extensions</strong><span>Extensions with settings or import tools will appear here after installation.</span><button className="secondary-button" onClick={() => setView('browse')}>Browse extensions</button></div>}
    </div>}
    {uninstallTarget && <div className="extension-uninstall" role="alertdialog" aria-modal="true" aria-labelledby="extension-uninstall-title"><div><h3 id="extension-uninstall-title">Uninstall {uninstallTarget.manifest.name}?</h3><p>Knowledge remains available, but extension-specific presentation may use a core fallback.</p><div className="button-row"><button className="secondary-button" onClick={() => setUninstallTarget(null)}>Cancel</button><button className="secondary-button danger" disabled={busy} onClick={() => void uninstall(uninstallTarget, false)}>Uninstall and keep credentials</button><button className="primary-button danger-button" disabled={busy} onClick={() => void uninstall(uninstallTarget, true)}>Uninstall and delete credentials</button></div></div></div>}
    {diagnostics.filter((diagnostic) => !installed.some((record) => record.manifest.id === diagnostic.extensionId)).length > 0 && <p className="extension-warning" role="status"><AlertTriangle size={15} /> An extension error was isolated. Your study data remains available.</p>}
  </div>
}
