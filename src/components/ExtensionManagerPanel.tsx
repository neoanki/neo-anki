import { AlertTriangle, Check, ExternalLink, PackagePlus, Puzzle, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ExtensionManifest, ExtensionPermission } from '../extensions/sdk'
import { bundledExtensionIds, extensionRuntime } from '../extensions/runtime'

const permissionLabels: Record<ExtensionPermission, string> = {
  'prompts:contribute': 'Add practice prompt types',
  'imports:files': 'Read files you choose for import',
  'exports:files': 'Create export files',
  'planning:signals': 'Influence item priority',
  'planning:policies': 'Add recovery queue policies',
  'sync:transport': 'Provide a sync transport',
  'ui:pages': 'Add application pages',
  'ui:workspace-panels': 'Add workspace panels',
  'ui:create-panels': 'Add authoring controls',
  'ui:library-presets': 'Add Library filter presets',
  'content:transactions': 'Propose content changes',
}

const formatBytes = (bytes: number) => bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`

const ManifestSummary = ({ manifest, addedPermissions = [] }: { manifest: ExtensionManifest; addedPermissions?: ExtensionPermission[] }) => (
  <div className="extension-permissions" aria-label={`${manifest.name} permissions`}>
    {manifest.permissions.length ? manifest.permissions.map((permission) => <span className={addedPermissions.includes(permission) ? 'permission-chip new' : 'permission-chip'} key={permission}>{permissionLabels[permission]}{addedPermissions.includes(permission) && <small>New</small>}</span>) : <span className="permission-chip">No contributed capabilities</span>}
  </div>
)

export const ExtensionManagerPanel = () => {
  const bridge = window.neoAnkiDesktop
  const [installed, setInstalled] = useState<NeoAnkiInstalledExtension[]>([])
  const [candidate, setCandidate] = useState<NeoAnkiExtensionCandidate | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [reloadRequired, setReloadRequired] = useState(false)
  const diagnostics = extensionRuntime.getDiagnostics()
  const bundled = useMemo(() => extensionRuntime.list().filter((manifest) => bundledExtensionIds.has(manifest.id)), [])

  const refresh = async () => {
    if (!bridge) return
    setInstalled(await bridge.listExtensions())
  }

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
    try {
      await bridge.installExtension(candidate.token)
      setMessage(`${candidate.manifest.name} ${candidate.currentVersion ? 'updated' : 'installed'}. Reload to activate it.`)
      setCandidate(null); setReloadRequired(true); await refresh()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not install that extension.') }
    finally { setBusy(false) }
  }

  const toggle = async (record: NeoAnkiInstalledExtension) => {
    if (!bridge) return
    setBusy(true); setError('')
    try {
      await bridge.setExtensionEnabled(record.manifest.id, !record.enabled)
      setMessage(`${record.manifest.name} will be ${record.enabled ? 'disabled' : 'enabled'} after reload.`)
      setReloadRequired(true); await refresh()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not change extension state.') }
    finally { setBusy(false) }
  }

  const uninstall = async (record: NeoAnkiInstalledExtension) => {
    if (!bridge || !window.confirm(`Uninstall ${record.manifest.name}? Its cards and content will remain, but extension-specific presentation may fall back to basic review.`)) return
    setBusy(true); setError('')
    try {
      await bridge.uninstallExtension(record.manifest.id)
      setMessage(`${record.manifest.name} was uninstalled. Reload to finish.`)
      setReloadRequired(true); await refresh()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not uninstall that extension.') }
    finally { setBusy(false) }
  }

  return <div className="setting-block extension-manager">
    <div className="extensions-heading"><span><Puzzle size={18} /><strong>Extensions</strong></span><small>{bundled.length + installed.filter((record) => record.enabled).length} active</small></div>
    <p>Bundled and locally installed extensions use the same SDK, registry, permissions, and failure isolation.</p>

    {bridge ? <button className="secondary-button extension-install-button" disabled={busy || Boolean(candidate)} onClick={choosePackage}><PackagePlus size={18} /> {busy ? 'Reading package…' : 'Install from file…'}</button> : <p className="extension-browser-note">Local extension installation is available in the desktop app.</p>}

    {candidate && <section className="extension-review" aria-labelledby="extension-review-title">
      <div className="extension-review-heading"><span><ShieldCheck size={20}/><span><small>{candidate.currentVersion ? candidate.isDowngrade ? 'Review downgrade' : 'Review update' : 'Review installation'}</small><h3 id="extension-review-title">{candidate.manifest.name}</h3></span></span><code>v{candidate.manifest.version}</code></div>
      <p>{candidate.manifest.description || 'This extension did not provide a description.'}</p>
      <dl className="extension-facts"><div><dt>Publisher</dt><dd>{candidate.manifest.publisher}</dd></div><div><dt>Package</dt><dd>{formatBytes(candidate.compressedBytes)}</dd></div><div><dt>Fingerprint</dt><dd><code>{candidate.digest.slice(0, 12)}</code></dd></div>{candidate.currentVersion && <div><dt>Installed</dt><dd>v{candidate.currentVersion}</dd></div>}</dl>
      <strong className="permission-title">Requested capabilities</strong>
      <ManifestSummary manifest={candidate.manifest} addedPermissions={candidate.addedPermissions}/>
      <p className="extension-trust-warning"><AlertTriangle size={16}/><span>Local extensions run inside Neo Anki. Permissions describe intended contributions; they are not a security sandbox. Install only packages you trust.</span></p>
      {candidate.isDowngrade && <p className="extension-error" role="alert">This package is older than the installed version. Downgrading may remove capabilities or break extension-owned data.</p>}
      <div className="button-row extension-review-actions"><button className="secondary-button" disabled={busy} onClick={() => void cancelCandidate()}>Cancel</button><button className="primary-button" disabled={busy} onClick={() => void installCandidate()}><Check size={17}/> {candidate.currentVersion ? candidate.isDowngrade ? 'Downgrade' : 'Update' : 'Install extension'}</button></div>
    </section>}

    {reloadRequired && <div className="extension-reload" role="status"><span><RefreshCw size={17}/><span><strong>Reload required</strong><small>Finish applying extension changes.</small></span></span><button className="secondary-button compact" onClick={() => void bridge?.reloadForExtensions()}>Reload now</button></div>}
    {error && <p className="extension-error" role="alert">{error} Try the package again or verify it with the SDK CLI.</p>}
    {message && <p className="inline-message" role="status">{message}</p>}

    <div className="extension-list">
      {installed.map((record) => {
        const failure = diagnostics.find((diagnostic) => diagnostic.extensionId === record.manifest.id)
        return <details className="extension-row" key={record.manifest.id}><summary><span><strong>{record.manifest.name}</strong><small>Local package · {record.manifest.publisher}</small></span><span className="extension-state"><i className={record.enabled && !failure ? '' : 'inactive'}>{failure ? 'Error' : record.enabled ? 'Active' : 'Disabled'}</i><code>v{record.manifest.version}</code></span></summary><p className="extension-description">{record.manifest.description}</p>{failure && <p className="extension-error" role="status">{failure.message}</p>}<ManifestSummary manifest={record.manifest}/><div className="extension-record-meta"><span>SHA-256 <code>{record.digest.slice(0, 12)}</code></span>{record.manifest.homepage && <a href={record.manifest.homepage} target="_blank" rel="noreferrer">Homepage <ExternalLink size={13}/></a>}</div><div className="extension-actions"><button className="secondary-button compact" disabled={busy} onClick={() => void toggle(record)}>{record.enabled ? 'Disable' : 'Enable'}</button><button className="text-button danger" disabled={busy} onClick={() => void uninstall(record)}><Trash2 size={15}/> Uninstall</button></div></details>
      })}
      <details className="bundled-extension-group">
        <summary><span>Bundled extensions</span><small>{bundled.length}</small></summary>
        <div className="bundled-extension-list">
          {bundled.map((manifest) => <details className="extension-row" key={manifest.id}><summary><span><strong>{manifest.name}</strong><small>Bundled · {manifest.publisher}</small></span><span className="extension-state"><i>Active</i><code>v{manifest.version}</code></span></summary><p className="extension-description">{manifest.description}</p><ManifestSummary manifest={manifest}/></details>)}
        </div>
      </details>
    </div>
    {diagnostics.filter((diagnostic) => !installed.some((record) => record.manifest.id === diagnostic.extensionId)).length > 0 && <p className="extension-warning" role="status"><AlertTriangle size={15} /> An extension error was isolated. Your study data remains available.</p>}
  </div>
}
