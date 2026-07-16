import { Download, Moon, RotateCcw, Sun, Upload, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { useApp } from '../state/AppContext'
import { downloadBackup, parseBackup } from '../lib/storage'
import { importFile as importAnyFile } from '../lib/importers'
import { exportCsv } from '../lib/importers/csv'

export const SettingsPanel = ({ onClose }: { onClose: () => void }) => {
  const { data, setRetention, toggleTheme, replaceData, resetData, mergeImport } = useApp()
  const fileRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState('')

  const importFile = async (file?: File) => {
    if (!file) return
    try {
      if (file.name.toLowerCase().endsWith('.json')) replaceData(await parseBackup(file))
      else {
        const result = await importAnyFile(file)
        mergeImport(result)
        setMessage(`Imported ${result.items.length} items. ${result.warnings.join(' ')}`)
        return
      }
      setMessage('Backup imported successfully.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not import that file.')
    }
  }

  const downloadCsv = () => {
    const url = URL.createObjectURL(new Blob([exportCsv(data.items, data.cards)], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'neo-anki.csv'; anchor.click(); URL.revokeObjectURL(url)
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
          <strong>Portable by default</strong>
          <p>Your data is stored locally in this browser. Import Anki, CSV, or a complete Neo Anki backup.</p>
          <div className="button-row">
            <button className="secondary-button" onClick={() => downloadBackup(data)}><Download size={18} /> Export</button>
            <button className="secondary-button" onClick={downloadCsv}><Download size={18} /> CSV</button>
            <button className="secondary-button" onClick={() => fileRef.current?.click()}><Upload size={18} /> Import</button>
            <input ref={fileRef} className="visually-hidden" type="file" accept=".json,.csv,.apkg,.colpkg" onChange={(event) => importFile(event.target.files?.[0])} />
          </div>
          {message && <p className="inline-message" role="status">{message}</p>}
        </div>

        <div className="danger-zone">
          <div>
            <strong>Reset local data</strong>
            <p>Restore the sample collection and onboarding.</p>
          </div>
          <button className="text-button danger" onClick={() => window.confirm('Reset all local Neo Anki data?') && resetData()}><RotateCcw size={17} /> Reset</button>
        </div>
      </section>
    </div>
  )
}
