import { AlertTriangle, Check, ExternalLink, PackagePlus, Puzzle, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AnyExtensionPermission } from '../../packages/extension-sdk/src/index'
import { extensionRuntime } from '../extensions/runtime'
import { safeExternalUrl } from '../lib/urls'
import { ExtensionMarketplace } from './ExtensionMarketplace'

const permissionLabels: Record<string, string> = {
  'study:read': 'Read a scoped study projection',
  'study:signals': 'Return bounded study priority signals',
  'study:prompt-types': 'Create and render declared prompt types',
  'study:queue-policies': 'Score bounded recovery queue candidates',
  'content:read': 'Read declared content projections',
  'content:patch-own': 'Propose validated changes in owned scope',
  'content:migrate': 'Inspect and commit validated workspace migrations',
  'media:create': 'Create content-hashed media through core',
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

export const ExtensionManagerPanel = () => {
  const bridge = window.neoAnkiDesktop
  const safeMode = new URLSearchParams(window.location.search).get('safe-mode') === '1'
  const [installed, setInstalled] = useState<NeoAnkiInstalledExtension[]>([])
  const [candidate, setCandidate] = useState<NeoAnkiExtensionCandidate | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [reloadRequired, setReloadRequired] = useState(false)
  const diagnostics = extensionRuntime.getDiagnostics()

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
    const hasSecrets = record.manifest.permissions.includes('secrets:device')
    const retainSecrets = !hasSecrets || window.confirm(`Retain ${record.manifest.name} credentials in this device's secure storage for a future reinstall?\n\nChoose OK to retain them or Cancel to delete them now.`)
    setBusy(true); setError('')
    try {
      await bridge.uninstallExtension(record.manifest.id, !retainSecrets)
      setMessage(`${record.manifest.name} was uninstalled${retainSecrets && hasSecrets ? '; its device-local credentials were retained' : '; its device-local credentials were deleted'}. Reload to finish.`)
      setReloadRequired(true); await refresh()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not uninstall that extension.') }
    finally { setBusy(false) }
  }

  return <div className="setting-block extension-manager">
    <div className="extensions-heading"><span><Puzzle size={18} /><strong>Extensions</strong></span><small>{installed.filter((record) => record.enabled).length} active</small></div>
    <p>Every extension shown here is a signed, installable package running in the isolated SDK 2 worker/iframe runtime. Core application features are not presented as extensions.</p>

    {safeMode && <div className="extension-reload" role="status"><span><ShieldCheck size={17}/><span><strong>Safe mode is active</strong><small>Locally installed extensions were skipped for this launch.</small></span></span><button className="secondary-button compact" onClick={() => { window.location.search = '' }}>Restart normally</button></div>}

    <ExtensionMarketplace installed={installed} candidateActive={Boolean(candidate)} onCandidate={setCandidate}/>

    {bridge ? <button className="secondary-button extension-install-button" disabled={busy || Boolean(candidate)} onClick={choosePackage}><PackagePlus size={18} /> {busy ? 'Reading package…' : 'Install from file…'}</button> : <p className="extension-browser-note">Local extension installation is available in the desktop app.</p>}

    {candidate && <section className="extension-review" aria-labelledby="extension-review-title">
      <div className="extension-review-heading"><span><ShieldCheck size={20}/><span><small>{candidate.currentVersion ? candidate.isDowngrade ? 'Review downgrade' : 'Review update' : 'Review installation'}</small><h3 id="extension-review-title">{candidate.manifest.name}</h3></span></span><code>v{candidate.manifest.version}</code></div>
      <p>{candidate.manifest.description || 'This extension did not provide a description.'}</p>
      <dl className="extension-facts"><div><dt>Publisher</dt><dd>{candidate.manifest.publisher}</dd></div><div><dt>Package</dt><dd>{formatBytes(candidate.compressedBytes)}</dd></div><div><dt>Fingerprint</dt><dd><code>{candidate.digest.slice(0, 12)}</code></dd></div><div><dt>Runtime</dt><dd>Signed · isolated SDK 2</dd></div><div><dt>Publisher key</dt><dd><code>{candidate.manifest.publisherKey.slice(0, 16)}…</code></dd></div><div><dt>Source commit</dt><dd><code>{candidate.manifest.provenance.sourceCommit.slice(0, 12)}</code></dd></div>{candidate.manifest.provenance.coreCommit && <div><dt>Core SDK commit</dt><dd><code>{candidate.manifest.provenance.coreCommit.slice(0, 12)}</code></dd></div>}{candidate.currentVersion && <div><dt>Installed</dt><dd>v{candidate.currentVersion}</dd></div>}</dl>
      <strong className="permission-title">Requested capabilities</strong>
      <ManifestSummary manifest={candidate.manifest} addedPermissions={candidate.addedPermissions}/>
      <p className="extension-trust-warning"><AlertTriangle size={16}/><span>Worker code and UI run in isolated contexts; core validates every capability call and workspace patch. A valid signature proves package integrity, not publisher identity, so publisher trust still matters.</span></p>
      {candidate.isDowngrade && <p className="extension-error" role="alert">This package is older than the installed version. Downgrading may remove features or make data created by the extension unavailable.</p>}
      <div className="button-row extension-review-actions"><button className="secondary-button" disabled={busy} onClick={() => void cancelCandidate()}>Cancel</button><button className="primary-button" disabled={busy} onClick={() => void installCandidate()}><Check size={17}/> {candidate.currentVersion ? candidate.isDowngrade ? 'Downgrade' : 'Update' : 'Install extension'}</button></div>
    </section>}

    {reloadRequired && <div className="extension-reload" role="status"><span><RefreshCw size={17}/><span><strong>Reload required</strong><small>Finish applying extension changes.</small></span></span><button className="secondary-button compact" onClick={() => void bridge?.reloadForExtensions()}>Reload now</button></div>}
    {error && <p className="extension-error" role="alert">{error} Try the package again or verify it with the SDK CLI.</p>}
    {message && <p className="inline-message" role="status">{message}</p>}

    <div className="extension-list">
      {installed.map((record) => {
        const failure = diagnostics.find((diagnostic) => diagnostic.extensionId === record.manifest.id)
        const homepage = safeExternalUrl(record.manifest.homepage)
        return <details className="extension-row" key={record.manifest.id}><summary><span><strong>{record.manifest.name}</strong><small>Signed isolated SDK 2 package · {record.manifest.publisher}</small></span><span className="extension-state"><i className={record.enabled && !failure ? '' : 'inactive'}>{failure ? 'Error' : record.enabled ? 'Active' : 'Disabled'}</i><code>v{record.manifest.version}</code></span></summary><p className="extension-description">{record.manifest.description}</p>{failure && <p className="extension-error" role="status">{failure.message}</p>}<ManifestSummary manifest={record.manifest}/><div className="extension-record-meta"><span>SHA-256 <code>{record.digest.slice(0, 12)}</code></span><span>Key <code>{record.manifest.publisherKey.slice(0, 12)}</code></span><span>Source <code>{record.manifest.provenance.sourceCommit.slice(0, 12)}</code></span>{homepage && <a href={homepage} target="_blank" rel="noopener noreferrer">Homepage <ExternalLink size={13}/></a>}</div><div className="extension-actions"><button className="secondary-button compact" disabled={busy} onClick={() => void toggle(record)}>{record.enabled ? 'Disable' : 'Enable'}</button><button className="text-button danger" disabled={busy} onClick={() => void uninstall(record)}><Trash2 size={15}/> Uninstall</button></div></details>
      })}
    </div>
    {diagnostics.filter((diagnostic) => !installed.some((record) => record.manifest.id === diagnostic.extensionId)).length > 0 && <p className="extension-warning" role="status"><AlertTriangle size={15} /> An extension error was isolated. Your study data remains available.</p>}
  </div>
}
