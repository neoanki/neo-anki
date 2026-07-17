import { ArchiveRestore, Database, Download, Moon, RotateCcw, Sun, Upload, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { useApp } from '../state/AppContext'
import { downloadBackup, getStorageStatus, parseBackup } from '../lib/storage'
import { extensionRuntime } from '../extensions/runtime'
import { ExtensionManagerPanel } from './ExtensionManagerPanel'

export const SettingsPanel = ({ onClose }: { onClose: () => void }) => {
  const { data, persistenceError, setRetention, toggleTheme, replaceData, resetData, mergeImport } = useApp()
  const fileRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState('')
  const [busyAction, setBusyAction] = useState<'backup' | 'restore' | ''>('')
  const storage = getStorageStatus()

  const importFile = async (file?: File) => {
    if (!file) return
    try {
      if (file.name.toLowerCase().endsWith('.json')) replaceData(await parseBackup(file))
      else {
        const result = await extensionRuntime.importFile(file)
        mergeImport(result)
        setMessage(`Imported ${result.items.length} ${result.items.length === 1 ? 'item' : 'items'}. ${result.warnings.join(' ')}`)
        return
      }
      setMessage('Backup imported successfully.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not import that file.')
    }
  }

  const exportWith = async (id: string) => {
    const exporter = extensionRuntime.exporters().find((candidate) => candidate.id === id)
    if (!exporter) return
    const url = URL.createObjectURL(new Blob([await exporter.export(data)], { type: exporter.mimeType }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = exporter.filename; anchor.click(); URL.revokeObjectURL(url)
  }

  const exportBackup = async () => {
    setBusyAction('backup')
    try {
      const result = await downloadBackup(data)
      if (!result.canceled) setMessage(result.path ? `Backup saved to ${result.path}` : 'Backup exported successfully.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not export the backup.')
    } finally { setBusyAction('') }
  }

  const restoreBackup = async () => {
    if (!window.neoAnkiDesktop || !window.confirm('Restore a complete Neo Anki backup? The current workspace will be backed up automatically before it is replaced.')) return
    setBusyAction('restore'); setMessage('')
    try {
      const result = await window.neoAnkiDesktop.restoreBackup()
      if (!result.canceled) window.location.reload()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not restore that backup. Your current workspace was not changed.')
    } finally { setBusyAction('') }
  }

  return (
    <div className="scrim" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Workspace</p>
            <h2 id="settings-title">Settings</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close settings"><X size={20} /></button>
        </div>

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

        <div className="setting-block">
          <label htmlFor="retention"><strong>Recall target</strong></label>
          <p>Higher confidence requires more review time. The daily planner will introduce less new material when necessary.</p>
          <div className="range-line">
            <input id="retention" type="range" min="80" max="96" step="1" value={Math.round(data.settings.retention * 100)} onChange={(event) => setRetention(Number(event.target.value) / 100)} />
            <output>{Math.round(data.settings.retention * 100)}%</output>
          </div>
        </div>

        <div className="setting-block">
          <strong>{storage.mode === 'desktop' ? 'Desktop data' : 'Portable by default'}</strong>
          <p>{storage.mode === 'desktop' ? 'Your workspace uses a transactional local database with daily recovery backups and content-addressed media.' : 'This development build stores data in the browser. Use the desktop application for durable storage.'}</p>
          {storage.path && <div className="storage-location"><Database size={17} /><span><small>Data file</small><code>{storage.path}</code></span></div>}
          {storage.recoveredFromBackup && <p className="storage-warning" role="status">Neo Anki recovered this workspace from its latest verified automatic backup.</p>}
          {storage.migratedLegacyData && <p className="storage-warning" role="status">Your legacy JSON workspace was migrated to the production database. The original file was preserved in Backups.</p>}
          {(storage.loadError || persistenceError) && <p className="storage-error" role="alert">{storage.loadError || persistenceError}</p>}
          <div className="button-row">
            <button className="secondary-button" disabled={Boolean(busyAction)} onClick={exportBackup}><Download size={18} /> {busyAction === 'backup' ? 'Exporting…' : 'Export backup'}</button>
            {window.neoAnkiDesktop && <button className="secondary-button" disabled={Boolean(busyAction)} onClick={restoreBackup}><ArchiveRestore size={18} /> {busyAction === 'restore' ? 'Restoring…' : 'Restore backup'}</button>}
            {extensionRuntime.exporters().map((exporter) => <button className="secondary-button" key={exporter.id} onClick={() => exportWith(exporter.id)}><Download size={18} /> {exporter.label}</button>)}
            <button className="secondary-button" onClick={() => fileRef.current?.click()}><Upload size={18} /> Import</button>
            <input ref={fileRef} className="visually-hidden" type="file" accept=".json,.csv,.apkg,.colpkg" onChange={(event) => importFile(event.target.files?.[0])} />
          </div>
          {message && <p className="inline-message" role="status">{message}</p>}
        </div>

        <ExtensionManagerPanel />

        <div className="danger-zone">
          <div>
            <strong>Reset workspace</strong>
            <p>Remove the active data file and restore the sample collection.</p>
          </div>
          <button className="text-button danger" onClick={() => window.confirm('Reset the complete Neo Anki workspace? A manual backup is recommended first.') && resetData()}><RotateCcw size={17} /> Reset</button>
        </div>
      </section>
    </div>
  )
}
