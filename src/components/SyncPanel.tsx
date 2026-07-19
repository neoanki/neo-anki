import { AlertTriangle, Cloud, Copy, Download, KeyRound, RefreshCw, ShieldCheck, Trash2, Unplug } from 'lucide-react'
import { useEffect, useState } from 'react'
import { browserSync, type BrowserSyncStatus } from '../lib/browser-sync'
import { saveData } from '../lib/storage'
import { workspaceDocumentV4ToAppData } from '../lib/workspace-v4'
import { useApp } from '../state/AppContext'

const downloadRecovery = (value: string) => {
  const url = URL.createObjectURL(new Blob([`${value}\n`], { type: 'text/plain;charset=utf-8' })); const anchor = document.createElement('a')
  anchor.href = url; anchor.download = 'neo-anki-recovery-key.txt'; anchor.click(); URL.revokeObjectURL(url)
}
const conflictValue = (value: { present: boolean; value?: unknown }) => !value.present ? '(removed)' : typeof value.value === 'string' ? value.value.slice(0, 240) : JSON.stringify(value.value)?.slice(0, 240) || String(value.value)

export const SyncPanel = () => {
  const bridge = window.neoAnkiDesktop
  const { data, loadWorkspaceDocument, replaceData } = useApp()
  const [status, setStatus] = useState<NeoAnkiSyncStatus | BrowserSyncStatus | null>(null)
  const [devices, setDevices] = useState<NeoAnkiSyncDevice[]>([])
  const [endpoint, setEndpoint] = useState('')
  const [recoveryInput, setRecoveryInput] = useState('')
  const [recoveryOutput, setRecoveryOutput] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState('')
  const [confirmDelete, setConfirmDelete] = useState('')
  const reload = async () => {
    const nextStatus = bridge ? await bridge.syncStatus() : await browserSync.status(); setStatus(nextStatus)
    setDevices(nextStatus.configured ? bridge ? await bridge.syncListDevices() : await browserSync.listDevices() : [])
  }
  useEffect(() => {
    let active = true
    void (async () => { const value = bridge ? await bridge.syncStatus() : await browserSync.status(); const nextDevices = value.configured ? bridge ? await bridge.syncListDevices() : await browserSync.listDevices() : []; if (active) { setStatus(value); setDevices(nextDevices) } })().catch((error) => { if (active) setMessage(error instanceof Error ? error.message : 'Could not read sync status.') })
    return () => { active = false }
  }, [bridge])

  const run = async (name: string, action: () => Promise<void>) => {
    setBusy(name); setMessage('')
    try { await action(); await reload() } catch (error) { setMessage(error instanceof Error ? error.message : 'Sync operation failed.') } finally { setBusy('') }
  }
  const adoptDesktop = (value: unknown) => { if (value) window.dispatchEvent(new CustomEvent('neo-anki:workspace-updated-v4', { detail: value })) }
  const commitBrowser = async ({ document, media }: { document: Parameters<typeof workspaceDocumentV4ToAppData>[0]; media: typeof data.assets }) => {
    const projected = workspaceDocumentV4ToAppData(document); projected.assets = media
    await saveData(projected)
    replaceData(projected)
  }

  return <div className="setting-block sync-panel">
    <div className="sync-heading"><span><Cloud size={20}/><strong>End-to-end encrypted sync</strong></span>{status?.configured && <span className="sync-state"><ShieldCheck size={16}/> Connected</span>}</div>
    <p>Collection text, schedules, review history, settings, and media are encrypted on this device. The service stores ciphertext and cannot read your workspace.</p>
    {!status ? <p role="status">Reading sync status…</p> : !status.configured ? <div className="sync-setup">
      <label className="form-field"><span>Sync service URL</span><input type="url" inputMode="url" placeholder="https://sync.example.com" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} /></label>
      <button className="primary-button" disabled={Boolean(busy) || !endpoint.trim()} onClick={() => void run('create', async () => {
        if (bridge) { const result = await bridge.syncCreateAccount(endpoint.trim()); setRecoveryOutput(result.recoveryBundle); setStatus(result.status) }
        else { const document = await loadWorkspaceDocument(); const result = await browserSync.createAccount(endpoint.trim(), document, data.assets, commitBrowser); setRecoveryOutput(result.recoveryBundle); setStatus(result.status) }
        setMessage('Sync account created. Save the recovery key before leaving this screen.')
      })}><ShieldCheck size={18}/>{busy === 'create' ? 'Creating encrypted account…' : 'Create encrypted sync account'}</button>
      <details><summary>Recover an existing sync account</summary><label className="form-field"><span>Recovery key</span><textarea rows={4} spellCheck={false} autoComplete="off" value={recoveryInput} onChange={(event) => setRecoveryInput(event.target.value)} /></label><button className="secondary-button" disabled={Boolean(busy) || !recoveryInput.trim()} onClick={() => void run('recover', async () => {
        if (bridge) { const result = await bridge.syncRecoverAccount(recoveryInput); adoptDesktop(result.data); setStatus(result.status) }
        else { const result = await browserSync.recoverAccount(recoveryInput, await loadWorkspaceDocument(), commitBrowser); setStatus(result.status) }
        setRecoveryInput(''); setMessage('This device recovered and verified the encrypted workspace.')
      })}><KeyRound size={18}/>{busy === 'recover' ? 'Recovering…' : 'Recover this device'}</button></details>
    </div> : <div className="sync-dashboard">
      <dl><div><dt>Service</dt><dd>{status.endpoint}</dd></div><div><dt>Last successful sync</dt><dd>{status.lastSuccessAt ? new Date(status.lastSuccessAt).toLocaleString() : 'Not yet'}</dd></div><div><dt>Pending encrypted operations</dt><dd>{status.pendingOperations}</dd></div><div><dt>This device</dt><dd>{status.actorId}</dd></div></dl>
      {status.lastError && <p className="storage-error" role="alert">{status.lastError}</p>}
      {status.pendingCommit && <p className="storage-warning" role="status">A verified sync result is safely journaled but has not finished committing locally. Choose Sync now to resume it before making more changes.</p>}
      {(status.conflicts || []).length > 0 && <section className="sync-conflicts" aria-labelledby="sync-conflicts-title"><h3 id="sync-conflicts-title"><AlertTriangle size={18}/> Concurrent edits need a choice</h3><p>Neo Anki preserved both values. Choose deliberately; the result becomes a new synchronized revision on every device.</p>{status.conflicts.map((conflict) => <article key={conflict.id}><strong>{conflict.entityKind} · {conflict.field}</strong><div className="sync-conflict-values"><div><small>This device had</small><pre>{conflictValue(conflict.existing)}</pre></div><div><small>Incoming device proposed</small><pre>{conflictValue(conflict.incoming)}</pre></div></div><div className="button-row"><button className="secondary-button" disabled={Boolean(busy)} onClick={() => void run(`resolve-${conflict.id}`, async () => {
        let queued = false
        if (bridge) { const result = await bridge.syncResolveConflict(conflict.id, 'existing'); adoptDesktop(result.data); setStatus(result.status); queued = Boolean(result.status.lastError) }
        else { const result = await browserSync.resolveConflict(conflict.id, 'existing', await loadWorkspaceDocument(), data.assets, commitBrowser); setStatus(result.status); queued = Boolean(result.status.lastError) }
        setMessage(queued ? 'Conflict resolved locally and queued. Sync will retry when the service is reachable.' : 'Conflict resolved with this device’s value and synchronized.')
      })}>Keep this device</button><button className="secondary-button" disabled={Boolean(busy)} onClick={() => void run(`resolve-${conflict.id}`, async () => {
        let queued = false
        if (bridge) { const result = await bridge.syncResolveConflict(conflict.id, 'incoming'); adoptDesktop(result.data); setStatus(result.status); queued = Boolean(result.status.lastError) }
        else { const result = await browserSync.resolveConflict(conflict.id, 'incoming', await loadWorkspaceDocument(), data.assets, commitBrowser); setStatus(result.status); queued = Boolean(result.status.lastError) }
        setMessage(queued ? 'Conflict resolved locally and queued. Sync will retry when the service is reachable.' : 'Conflict resolved with the incoming value and synchronized.')
      })}>Use incoming value</button></div></article>)}</section>}
      <div className="button-row"><button className="primary-button" disabled={Boolean(busy)} onClick={() => void run('sync', async () => {
        if (bridge) { const result = await bridge.syncNow(); adoptDesktop(result.data); setStatus(result.status); setMessage(`Sync complete: ${result.sent} sent, ${result.received} received.`) }
        else { const result = await browserSync.synchronize(await loadWorkspaceDocument(), data.assets, [], commitBrowser); setStatus(result.status); setMessage(`Sync complete: ${result.sent} sent, ${result.received} received.`) }
      })}><RefreshCw size={18}/>{busy === 'sync' ? 'Syncing…' : 'Sync now'}</button>{bridge && <button className="secondary-button" disabled={Boolean(busy)} onClick={() => void run('rotate', async () => { setRecoveryOutput(await bridge.syncRotateRecovery()); setMessage('Previous recovery keys are now invalid. Save the replacement key.') })}><KeyRound size={18}/> Replace recovery key</button>}<button className="secondary-button" disabled={Boolean(busy)} onClick={() => void run('disconnect', async () => { if (bridge) await bridge.syncDisconnect(); else await browserSync.disconnect(); setStatus({ configured: false, pendingOperations: 0, conflicts: [] }); setMessage('This device was disconnected. Local data remains available.') })}><Unplug size={18}/> Disconnect this device</button></div>
      {!bridge && <details><summary>Replace browser recovery key</summary><p>For browser security, the raw collection key is not kept exportable. Paste the current recovery key to authorize creating its replacement.</p><label className="form-field"><span>Current recovery key</span><textarea rows={4} spellCheck={false} autoComplete="off" value={recoveryInput} onChange={(event) => setRecoveryInput(event.target.value)} /></label><button className="secondary-button" disabled={Boolean(busy) || !recoveryInput.trim()} onClick={() => void run('rotate', async () => { setRecoveryOutput(await browserSync.rotateRecoveryBundle(recoveryInput)); setRecoveryInput(''); setMessage('Previous recovery keys are now invalid. Save the replacement key.') })}><KeyRound size={18}/> Replace recovery key</button></details>}
      <div className="sync-devices"><strong>Authorized devices</strong><ul>{devices.map((device) => <li key={device.actorId}><span><code>{device.actorId}</code><small>{device.current ? 'This device' : device.revokedAt ? `Revoked ${new Date(device.revokedAt).toLocaleString()}` : `Added ${new Date(device.createdAt).toLocaleString()}`}</small></span>{!device.current && !device.revokedAt && <button className="text-button danger" disabled={Boolean(busy)} onClick={() => void run(`revoke-${device.actorId}`, async () => { if (bridge) await bridge.syncRevokeDevice(device.actorId); else await browserSync.revokeDevice(device.actorId); setMessage('Device revoked. Its prior signed history remains verifiable.') })}>Revoke</button>}</li>)}</ul></div>
      <details className="sync-danger"><summary>Delete encrypted sync account</summary><p>This permanently removes server ciphertext for every device. Local workspace data is kept.</p><label className="form-field"><span>Type DELETE SYNC to confirm</span><input value={confirmDelete} onChange={(event) => setConfirmDelete(event.target.value)} /></label><button className="text-button danger" disabled={busy !== '' || confirmDelete !== 'DELETE SYNC'} onClick={() => void run('delete', async () => { if (bridge) await bridge.syncDeleteAccount(); else await browserSync.deleteAccount(); setStatus({ configured: false, pendingOperations: 0, conflicts: [] }); setConfirmDelete(''); setMessage('The encrypted server account was deleted. Local data remains available.') })}><Trash2 size={17}/> Delete sync account</button></details>
    </div>}
    {recoveryOutput && <aside className="recovery-key" aria-labelledby="recovery-key-title"><strong id="recovery-key-title"><KeyRound size={17}/> Recovery key — shown on this device</strong><p>Anyone with this key can decrypt and enroll into the sync account. Store it offline; Neo Anki cannot recover it for you.</p><textarea aria-label="Neo Anki recovery key" readOnly rows={4} value={recoveryOutput} onFocus={(event) => event.currentTarget.select()} /><div className="button-row"><button className="secondary-button" onClick={() => void navigator.clipboard.writeText(recoveryOutput).then(() => setMessage('Recovery key copied.')).catch(() => setMessage('Clipboard access was unavailable; select and copy the key manually.'))}><Copy size={17}/> Copy</button><button className="secondary-button" onClick={() => downloadRecovery(recoveryOutput)}><Download size={17}/> Download</button><button className="text-button" onClick={() => setRecoveryOutput('')}>Hide key</button></div></aside>}
    {message && <p className="inline-message" role="status" aria-live="polite">{message}</p>}
  </div>
}
