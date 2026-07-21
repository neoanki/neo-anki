import { ArrowLeft, ArrowRight, Check, Clock3, FileArchive, FolderOpen, Plus } from 'lucide-react'
import { useRef, useState } from 'react'
import { useApp } from '../state/AppContext'
import { Brand } from './Brand'
import { parseBackup } from '../lib/storage'
import { extensionUiContributionsV2 } from '../extensions/v2/registry'
import { ExtensionUiFrameV2 } from '../extensions/v2/ExtensionUiFrameV2'

const options = [
  { minutes: 10, label: 'Light', copy: 'A small habit for busy days.' },
  { minutes: 20, label: 'Steady', copy: 'Enough room for gradual growth.' },
  { minutes: 30, label: 'Focused', copy: 'A serious daily learning practice.' },
  { minutes: 45, label: 'Deep', copy: 'For exams or ambitious goals.' },
]

type StartChoice = 'fresh' | 'anki' | 'neo'

export const Onboarding = () => {
  const { completeOnboarding, replaceData } = useApp()
  const [choice, setChoice] = useState<StartChoice | null>(null)
  const [minutes, setMinutes] = useState(30)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const neoFile = useRef<HTMLInputElement>(null)
  const migrationPanels = extensionUiContributionsV2('migration')

  const openNeo = async (file?: File) => {
    if (!file) return
    setBusy(true); setStatus('Validating the complete Neo workspace. Current data has not changed…')
    try {
      const replacement = await parseBackup(file)
      if (!window.confirm(`Open this complete Neo workspace with ${replacement.items.length} items? A checkpoint will be created before activation.`)) { setStatus('Workspace was not opened.'); return }
      await window.neoAnkiDesktop?.createImportCheckpoint()
      replacement.settings.onboardingComplete = true
      replaceData(replacement)
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not open that Neo workspace.') }
    finally { setBusy(false); if (neoFile.current) neoFile.current.value = '' }
  }

  return (
    <div className="onboarding-shell">
      <div className="onboarding-top"><Brand /><span>Local-first memory system</span></div>
      <main className="onboarding-card">
        {!choice ? <>
          <p className="eyebrow">Start safely</p>
          <h1>What are you bringing to Neo Anki?</h1>
          <p className="onboarding-intro">Choose first so Neo Anki can explain migration limits before any data changes.</p>
          <div className="start-choice-grid">
            <button onClick={() => setChoice('fresh')}><Plus aria-hidden="true" /><span><strong>Create a fresh workspace</strong><small>Set a daily time budget and start with a Neo collection.</small></span><ArrowRight aria-hidden="true" /></button>
            <button onClick={() => setChoice('anki')}><FileArchive aria-hidden="true" /><span><strong>Migrate from Anki</strong><small>Inspect an .apkg or .colpkg and verify every preserved or transformed field before commit.</small></span><ArrowRight aria-hidden="true" /></button>
            <button onClick={() => setChoice('neo')}><FolderOpen aria-hidden="true" /><span><strong>Open an existing Neo workspace</strong><small>Validate and restore a complete Neo JSON backup.</small></span><ArrowRight aria-hidden="true" /></button>
          </div>
        </> : <>
          <button className="text-button onboarding-back" disabled={busy} onClick={() => { setChoice(null); setStatus('') }}><ArrowLeft size={17} /> Back</button>
          <div className="onboarding-icon">{choice === 'fresh' ? <Clock3 size={27} /> : choice === 'anki' ? <FileArchive size={27} /> : <FolderOpen size={27} />}</div>
          <p className="eyebrow">{choice === 'fresh' ? 'Daily workload' : choice === 'anki' ? 'Migration preflight' : 'Validated restore'}</p>
          <h1>{choice === 'fresh' ? 'How much time can learning reliably have?' : choice === 'anki' ? 'Inspect your Anki package before changing anything' : 'Open a complete Neo workspace'}</h1>
          {choice === 'fresh' && <>
            <p className="onboarding-intro">Neo Anki adapts new material to this budget. Due knowledge is protected first, and overloaded days become recovery plans—not failures.</p>
            <fieldset className="time-options"><legend className="visually-hidden">Choose daily learning time</legend>{options.map((option) => <button key={option.minutes} onClick={() => setMinutes(option.minutes)} className={minutes === option.minutes ? 'selected' : ''} aria-pressed={minutes === option.minutes}><span className="radio-mark">{minutes === option.minutes && <Check size={15} />}</span><span><strong>{option.minutes} minutes · {option.label}</strong><small>{option.copy}</small></span></button>)}</fieldset>
            <button className="primary-button full-width" onClick={() => completeOnboarding(minutes)}>Build my first plan <ArrowRight size={19} /></button>
          </>}
          {choice === 'anki' && <><p className="onboarding-intro">Preview your Anki collection before importing it. Neo Anki creates a rollback checkpoint automatically.</p>{migrationPanels.length ? migrationPanels.map((panel) => <ExtensionUiFrameV2 key={`${panel.extensionId}:${panel.id}`} contribution={panel} dto={{ mode: 'onboarding', operation: 'replace-profile', dailyMinutes: minutes }} />) : <p className="inline-message" role="status">Install Anki & CSV Import/Export from the extension marketplace, then restart onboarding.</p>}</>}
          {choice === 'neo' && <><p className="onboarding-intro">Neo Anki validates schema, references, scheduling bounds, Trash, packs, and media metadata before activating the workspace.</p><button className="primary-button full-width" disabled={busy} onClick={() => neoFile.current?.click()}>{busy ? 'Validating workspace…' : 'Choose Neo JSON backup'}</button><input ref={neoFile} className="visually-hidden" type="file" accept=".json" onChange={(event) => void openNeo(event.target.files?.[0])} /></>}
        </>}
        {status && <p className={/could not|refused|not supported|error/i.test(status) ? 'inline-message error' : 'inline-message'} role={/could not|refused|not supported|error/i.test(status) ? 'alert' : 'status'}>{status}</p>}
        <p className="onboarding-note">No migration is committed without a checkpoint and explicit confirmation.</p>
      </main>
    </div>
  )
}
