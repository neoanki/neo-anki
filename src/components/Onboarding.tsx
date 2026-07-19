import { ArrowLeft, ArrowRight, Check, Clock3, FileArchive, FolderOpen, Plus } from 'lucide-react'
import { useRef, useState } from 'react'
import { useApp } from '../state/AppContext'
import { Brand } from './Brand'
import { extensionRuntime } from '../extensions/runtime'
import { parseBackup } from '../lib/storage'
import type { ImportSummary } from '../types'
import { ImportPreflightReview } from './ImportPreflightReview'
import { cancelActiveAnkiImport } from '../extensions/interoperability'

const options = [
  { minutes: 10, label: 'Light', copy: 'A small habit for busy days.' },
  { minutes: 20, label: 'Steady', copy: 'Enough room for gradual growth.' },
  { minutes: 30, label: 'Focused', copy: 'A serious daily learning practice.' },
  { minutes: 45, label: 'Deep', copy: 'For exams or ambitious goals.' },
]

type StartChoice = 'fresh' | 'anki' | 'neo'

export const Onboarding = () => {
  const { completeOnboarding, mergeImport, replaceData } = useApp()
  const [choice, setChoice] = useState<StartChoice | null>(null)
  const [minutes, setMinutes] = useState(30)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [pendingImport, setPendingImport] = useState<{ filename: string; result: ImportSummary } | null>(null)
  const ankiFile = useRef<HTMLInputElement>(null)
  const neoFile = useRef<HTMLInputElement>(null)

  const migrateAnki = async (file?: File) => {
    if (!file) return
    if (!/\.(?:apkg|colpkg)$/i.test(file.name)) { setStatus('Choose an Anki .apkg or .colpkg package.'); return }
    setBusy(true); setStatus('Inspecting the package in an isolated worker. Your workspace has not changed…')
    try {
      const result = await extensionRuntime.importFile(file, setStatus)
      if (!result.preflight) throw new Error('The Anki package did not produce a compatibility preflight.')
      setPendingImport({ filename: file.name, result }); setStatus('')
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not inspect that Anki package.') }
    finally { setBusy(false); if (ankiFile.current) ankiFile.current.value = '' }
  }

  const commitAnki = async () => {
    if (!pendingImport) return
    setBusy(true); setStatus('Creating a rollback checkpoint before activation…')
    try {
      await window.neoAnkiDesktop?.createImportCheckpoint()
      // The seed shown before onboarding is a disposable preview, not user
      // content. First-launch migration must activate only the imported graph.
      await mergeImport({ ...pendingImport.result, workspaceV4Operation: 'replace-profile' })
      completeOnboarding(minutes)
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not commit that Anki migration.'); setBusy(false) }
  }

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
          {choice === 'anki' && (pendingImport?.result.preflight ? <ImportPreflightReview filename={pendingImport.filename} preflight={pendingImport.result.preflight} busy={busy} onCancel={() => { setPendingImport(null); setStatus('Migration canceled. No workspace data changed.') }} onConfirm={() => void commitAnki()} /> : <><p className="onboarding-intro">Workspace v4 preserves named fields, templates/CSS, scheduling, review history, presets, flags, bury/suspend state, filtered-deck origin, media, and bounded inert add-on metadata. A .colpkg replaces the active profile; an .apkg is additive.</p><button className="primary-button full-width" disabled={busy} onClick={() => ankiFile.current?.click()}>{busy ? 'Inspecting package…' : 'Choose Anki package to inspect'}</button>{busy && <button className="secondary-button full-width" onClick={() => { cancelActiveAnkiImport(); setBusy(false); setStatus('Import canceled. The workspace was not changed.') }}>Cancel import</button>}<input ref={ankiFile} className="visually-hidden" type="file" accept=".apkg,.colpkg" onChange={(event) => void migrateAnki(event.target.files?.[0])} /></>)}
          {choice === 'neo' && <><p className="onboarding-intro">Neo Anki validates schema, references, scheduling bounds, Trash, packs, and media metadata before activating the workspace.</p><button className="primary-button full-width" disabled={busy} onClick={() => neoFile.current?.click()}>{busy ? 'Validating workspace…' : 'Choose Neo JSON backup'}</button><input ref={neoFile} className="visually-hidden" type="file" accept=".json" onChange={(event) => void openNeo(event.target.files?.[0])} /></>}
        </>}
        {status && <p className={/could not|refused|not supported|error/i.test(status) ? 'inline-message error' : 'inline-message'} role={/could not|refused|not supported|error/i.test(status) ? 'alert' : 'status'}>{status}</p>}
        <p className="onboarding-note">No migration is committed without a checkpoint and explicit confirmation.</p>
      </main>
    </div>
  )
}
