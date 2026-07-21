import { AlertTriangle, ArchiveRestore, Download, FileWarning, RefreshCw, RotateCcw } from 'lucide-react'
import { useRef, useState } from 'react'
import { parseBackup } from '../lib/storage'
import { useApp } from '../state/AppContext'

export const WorkspaceRecovery = () => {
  const { workspaceLoadFailure, retryWorkspaceLoad, exportWorkspaceRecoverySource, startEmptyAfterRecovery, replaceData } = useApp()
  const backupInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'export' | 'restore' | 'empty' | ''>('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  if (!workspaceLoadFailure) return null

  const exportOriginal = async () => {
    setBusy('export'); setMessage(''); setError('')
    try {
      const result = await exportWorkspaceRecoverySource()
      if (!result.canceled) setMessage(result.path ? `Original workspace saved to ${result.path}` : 'Original workspace downloaded.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not export the original workspace.') }
    finally { setBusy('') }
  }

  const restoreDesktopBackup = async () => {
    if (!window.neoAnkiDesktop) { backupInput.current?.click(); return }
    setBusy('restore'); setMessage(''); setError('')
    try {
      const result = await window.neoAnkiDesktop.restoreBackup()
      if (!result.canceled) window.location.reload()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not restore that backup.') }
    finally { setBusy('') }
  }

  const restoreBrowserBackup = async (file?: File) => {
    if (!file) return
    setBusy('restore'); setMessage(''); setError('')
    try {
      const restored = await parseBackup(file)
      replaceData(restored)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not restore that backup.') }
    finally { setBusy(''); if (backupInput.current) backupInput.current.value = '' }
  }

  const startEmpty = async () => {
    const checkpointCopy = window.neoAnkiDesktop
      ? 'The preserved damaged database will remain beside your Neo Anki data.'
      : 'Neo Anki will download the original browser data before erasing it.'
    if (!window.confirm(`Erase the unreadable workspace and start empty? ${checkpointCopy}`)) return
    setBusy('empty'); setMessage(''); setError('')
    try { await startEmptyAfterRecovery() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not start an empty workspace. The original data was not erased.') }
    finally { setBusy('') }
  }

  return <main className="fatal-recovery" aria-labelledby="workspace-recovery-title">
    <section className="fatal-recovery-card">
      <span className="fatal-mark"><AlertTriangle size={28} aria-hidden="true" /></span>
      <p className="eyebrow">Workspace recovery</p>
      <h1 id="workspace-recovery-title">Your workspace needs attention.</h1>
      <p>Neo Anki could not safely read your saved workspace, so editing and automatic saving are paused. No sample data has been substituted and the original source has not been overwritten.</p>
      <details>
        <summary>Technical detail</summary>
        <code>{workspaceLoadFailure.message}</code>
        {workspaceLoadFailure.sourcePath && <code>Preserved source: {workspaceLoadFailure.sourcePath}</code>}
      </details>
      <div className="fatal-actions">
        <button className="primary-button" disabled={Boolean(busy)} onClick={retryWorkspaceLoad}><RefreshCw size={18} aria-hidden="true" /> Retry</button>
        <button className="secondary-button" disabled={Boolean(busy) || !workspaceLoadFailure.canExportOriginal} onClick={() => void exportOriginal()}><Download size={18} aria-hidden="true" /> {busy === 'export' ? 'Exporting…' : 'Export original data'}</button>
        <button className="secondary-button" disabled={Boolean(busy)} onClick={() => void restoreDesktopBackup()}><ArchiveRestore size={18} aria-hidden="true" /> {busy === 'restore' ? 'Restoring…' : 'Restore backup'}</button>
        <button className="text-button danger" disabled={Boolean(busy)} onClick={() => void startEmpty()}><RotateCcw size={18} aria-hidden="true" /> {busy === 'empty' ? 'Starting empty…' : 'Start empty'}</button>
      </div>
      {!window.neoAnkiDesktop && <input ref={backupInput} className="visually-hidden" type="file" accept=".json,application/json" onChange={(event) => void restoreBrowserBackup(event.target.files?.[0])} />}
      {message && <p className="inline-message" role="status">{message}</p>}
      {error && <p className="inline-message error" role="alert"><FileWarning size={16} aria-hidden="true" /> {error}</p>}
    </section>
  </main>
}
