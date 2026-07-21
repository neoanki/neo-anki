import { ArchiveRestore, Bug, Database, Download, Moon, RotateCcw, Sun, Trash2, Upload, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '../state/AppContext'
import { downloadBackup, getStorageStatus, parseBackup } from '../lib/storage'
import { ExtensionManagerPanel } from './ExtensionManagerPanel'
import { UpdatePanel } from './UpdatePanel'
import { useModalDialog } from './useModalDialog'
import { extensionUiContributionsV2 } from '../extensions/v2/registry'
import { ExtensionUiFrameV2 } from '../extensions/v2/ExtensionUiFrameV2'
import { CompatibilityManager } from './CompatibilityManager'
import { SyncPanel } from './SyncPanel'

const MAX_IMPORT_BYTES = 512 * 1024 * 1024
const LARGE_IMPORT_BYTES = 128 * 1024 * 1024
const formatImportSize = (bytes: number) => bytes >= 1024 * 1024 * 1024 ? `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB` : `${Math.ceil(bytes / 1024 / 1024)} MB`
type MigrationRecoveryFile = { kind: 'source-package' | 'workspace-checkpoint'; name: string; byteLength: number; createdAt: string }

export const SettingsPanel = ({ onClose }: { onClose: () => void }) => {
  const { data, persistenceError, setRetention, setLearningSafeguards, toggleTheme, replaceData, resetData } = useApp()
  const fileRef = useRef<HTMLInputElement>(null)
  const importToken = useRef(0)
  const [message, setMessage] = useState('')
  const [messageIsError, setMessageIsError] = useState(false)
  const [recoveryFiles, setRecoveryFiles] = useState<MigrationRecoveryFile[]>([])
  const [busyAction, setBusyAction] = useState<'backup' | 'restore' | 'diagnostics' | 'import' | ''>('')
  const storage = getStorageStatus()
  const isolatedSettingsPanels = extensionUiContributionsV2('settings')
  const isolatedMigrationPanels = extensionUiContributionsV2('migration')
  const [dialogRef, requestClose, onBackdropMouseDown] = useModalDialog(onClose)
  const showMessage = (text: string, error = false) => { setMessage(text); setMessageIsError(error) }
  const loadRecoveryFiles = useCallback(async () => await window.neoAnkiDesktop?.listMigrationRecoveryFiles?.() || [], [])
  const refreshRecoveryFiles = useCallback(async () => setRecoveryFiles(await loadRecoveryFiles()), [loadRecoveryFiles])
  useEffect(() => {
    let current = true
    void loadRecoveryFiles().then((files) => { if (current) setRecoveryFiles(files) })
    return () => { current = false }
  }, [loadRecoveryFiles])

  const importFile = async (file?: File) => {
    if (!file) return
    if (file.size > MAX_IMPORT_BYTES) { showMessage(`That file is ${formatImportSize(file.size)}. Neo Anki limits a single import to 512 MB compressed.`, true); return }
    if (file.size > LARGE_IMPORT_BYTES && !window.confirm(`This import is ${formatImportSize(file.size)} and may take several minutes. Continue?`)) return
    const replacesWorkspace = file.name.toLowerCase().endsWith('.json')
    if (replacesWorkspace && !window.confirm('Restore this JSON backup as the complete workspace? Neo Anki will create a recovery checkpoint before replacing current data.')) return
    const token = ++importToken.current
    setBusyAction('import'); showMessage(`Reading ${file.name}… Your workspace has not changed.`)
    try {
      if (replacesWorkspace) {
        const replacement = await parseBackup(file)
        if (token !== importToken.current) return
        await window.neoAnkiDesktop?.createImportCheckpoint()
        if (token !== importToken.current) return
        replaceData(replacement)
      }
      else throw new Error('Install an import/export extension from the marketplace for this file type.')
      showMessage('Backup imported successfully.')
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Could not import that file.', true)
    } finally { if (token === importToken.current) { setBusyAction(''); if (fileRef.current) fileRef.current.value = '' } }
  }

  const cancelImport = () => {
    importToken.current += 1
    setBusyAction('')
    showMessage('Import canceled. The workspace was not changed.')
    if (fileRef.current) fileRef.current.value = ''
  }

  const exportBackup = async () => {
    setBusyAction('backup')
    try {
      const result = await downloadBackup(data)
      if (!result.canceled) showMessage(result.path ? `Backup saved to ${result.path}` : 'Backup exported successfully.')
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Could not export the backup.', true)
    } finally { setBusyAction('') }
  }

  const restoreBackup = async () => {
    if (!window.neoAnkiDesktop || !window.confirm('Restore a complete Neo Anki backup? The current workspace will be backed up automatically before it is replaced.')) return
    setBusyAction('restore'); showMessage('')
    try {
      const result = await window.neoAnkiDesktop.restoreBackup()
      if (!result.canceled) window.location.reload()
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Could not restore that backup. Your current workspace was not changed.', true)
    } finally { setBusyAction('') }
  }

  const exportDiagnostics = async () => {
    if (!window.neoAnkiDesktop) return
    setBusyAction('diagnostics'); showMessage('')
    try {
      const result = await window.neoAnkiDesktop.exportDiagnostics()
      if (!result.canceled) showMessage(result.path ? `Diagnostics saved to ${result.path}` : 'Diagnostics exported successfully.')
    } catch (error) { showMessage(error instanceof Error ? error.message : 'Could not export diagnostics.', true) }
    finally { setBusyAction('') }
  }

  return (
    <div className="scrim" role="presentation" onMouseDown={onBackdropMouseDown}>
      <section ref={dialogRef} tabIndex={-1} className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Workspace</p>
            <h2 id="settings-title">Settings</h2>
          </div>
          <button className="icon-button" onClick={requestClose} aria-label="Close settings"><X size={20} /></button>
        </div>

        <>
        <div className="setting-row">
          <div>
            <strong>Appearance</strong>
            <p>Switch between paper and evening themes.</p>
          </div>
          <button className="secondary-button compact" onClick={toggleTheme}>
            {data.settings.theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
            {data.settings.theme === 'light' ? 'Dark' : 'Light'}
          </button>
        </div>

        <CompatibilityManager />

        <SyncPanel />

        <div className="setting-block">
          <label htmlFor="retention"><strong>Recall target</strong></label>
          <p>Higher confidence requires more review time. The daily planner will introduce less new material when necessary.</p>
          <div className="range-line">
            <input id="retention" type="range" min="80" max="96" step="1" value={Math.round(data.settings.retention * 100)} onChange={(event) => setRetention(Number(event.target.value) / 100)} />
            <output>{Math.round(data.settings.retention * 100)}%</output>
          </div>
        </div>

        <div className="setting-block">
          <strong>Learning safeguards</strong>
          <p>Separate sibling prompts and flag repeatedly lapsed cards for repair instead of silently turning poor prompts into endless workload.</p>
          <label className="check-row"><input aria-label="Bury siblings for the rest of the day" type="checkbox" checked={data.settings.burySiblings} onChange={(event) => setLearningSafeguards({ burySiblings: event.target.checked })} /><span><strong>Bury siblings for the rest of the day</strong><small>After grading one card, related cards wait until the next local day.</small></span></label>
          <div className="field-grid"><label className="form-field"><span>Leech lapse threshold</span><input type="number" min="1" max="100" value={data.settings.leechThreshold} onChange={(event) => setLearningSafeguards({ leechThreshold: Math.max(1, Math.min(100, Number(event.target.value) || 8)) })} /></label><label className="form-field"><span>Leech action</span><select value={data.settings.leechAction} onChange={(event) => setLearningSafeguards({ leechAction: event.target.value as 'flag' | 'suspend' })}><option value="flag">Flag for repair</option><option value="suspend">Flag and suspend</option></select></label></div>
        </div>

        <div className="setting-block">
          <strong>{storage.mode === 'desktop' ? 'Desktop data' : 'Portable by default'}</strong>
          <p>{storage.mode === 'desktop' ? 'Your workspace uses a transactional local database with daily recovery backups and content-addressed media.' : 'This development build stores data in the browser. Use the desktop application for durable storage.'}</p>
          {storage.path && <div className="storage-location"><Database size={17} /><span><small>Data file</small><code>{storage.path}</code></span></div>}
          {storage.recoveredFromBackup && <p className="storage-warning" role="status">Neo Anki recovered this workspace from the newest automatic backup that passed integrity and semantic validation.</p>}
          {storage.migratedLegacyData && <p className="storage-warning" role="status">Your legacy JSON workspace was migrated to the production database. The original file was preserved in Backups.</p>}
          {(storage.loadError || persistenceError) && <p className="storage-error" role="alert">{storage.loadError || persistenceError}</p>}
          <div className="button-row">
            <button className="secondary-button" disabled={Boolean(busyAction)} onClick={exportBackup}><Download size={18} /> {busyAction === 'backup' ? 'Exporting…' : 'Export backup'}</button>
            {window.neoAnkiDesktop && <button className="secondary-button" disabled={Boolean(busyAction)} onClick={restoreBackup}><ArchiveRestore size={18} /> {busyAction === 'restore' ? 'Restoring…' : 'Restore backup'}</button>}
            <button className="secondary-button" disabled={Boolean(busyAction)} onClick={() => fileRef.current?.click()}><Upload size={18} /> {busyAction === 'import' ? 'Importing…' : 'Import'}</button>
            {busyAction === 'import' && <button className="text-button danger" onClick={cancelImport}>Cancel import</button>}
            {window.neoAnkiDesktop && <button className="secondary-button" disabled={Boolean(busyAction)} onClick={() => void exportDiagnostics()}><Bug size={18}/> {busyAction === 'diagnostics' ? 'Exporting…' : 'Export diagnostics'}</button>}
            <input ref={fileRef} className="visually-hidden" type="file" accept=".json" onChange={(event) => void importFile(event.target.files?.[0])} />
          </div>
          {recoveryFiles.length > 0 && <details className="migration-recovery-files"><summary>Migration rollback files ({recoveryFiles.length})</summary><p>Keep these until you have verified your migrated collection and an Anki export. Removing a file is permanent and does not change the live workspace.</p><ul>{recoveryFiles.map((file) => <li key={`${file.kind}:${file.name}`}><span><strong>{file.kind === 'source-package' ? 'Original Anki package' : 'Pre-import workspace checkpoint'}</strong><small>{formatImportSize(file.byteLength)} · {new Date(file.createdAt).toLocaleString()}</small></span><button className="text-button danger" onClick={() => void (async () => {
            if (!window.neoAnkiDesktop?.removeMigrationRecoveryFile || !window.confirm(`Permanently remove this ${file.kind === 'source-package' ? 'original Anki package' : 'pre-import workspace checkpoint'}? Keep it until migration and rollback exports are verified.`)) return
            try { await window.neoAnkiDesktop.removeMigrationRecoveryFile(file.kind, file.name); await refreshRecoveryFiles(); showMessage('The selected rollback file was removed. The live workspace was not changed.') }
            catch (error) { showMessage(error instanceof Error ? error.message : 'Could not remove the rollback file.', true) }
          })()}><Trash2 size={15}/> Remove</button></li>)}</ul></details>}
          {message && <p className={messageIsError ? 'inline-message error' : 'inline-message'} role={messageIsError ? 'alert' : 'status'}>{message}</p>}
        </div>

        {isolatedSettingsPanels.map((contribution) => <div className="setting-block" key={`${contribution.extensionId}:${contribution.id}`}><strong>{contribution.label}</strong><ExtensionUiFrameV2 contribution={contribution} dto={{ theme: data.settings.theme, platform: window.neoAnkiDesktop ? 'desktop' : 'web' }} /></div>)}
        {isolatedMigrationPanels.map((contribution) => <div className="setting-block" key={`${contribution.extensionId}:${contribution.id}`}><strong>{contribution.label}</strong><ExtensionUiFrameV2 contribution={contribution} dto={{ mode: 'settings', operation: 'additive' }} /></div>)}

        <UpdatePanel />
        <ExtensionManagerPanel />

        <div className="danger-zone">
          <div>
            <strong>Reset workspace</strong>
            <p>Back up the current workspace automatically, then restore the sample collection.</p>
          </div>
          <button className="text-button danger" onClick={() => window.confirm('Reset the complete Neo Anki workspace? A recovery backup will be created first.') && resetData()}><RotateCcw size={17} /> Reset</button>
        </div>
        </>
      </section>
    </div>
  )
}
