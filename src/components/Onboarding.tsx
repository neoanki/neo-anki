import { ArrowLeft, ArrowRight, Check, Clock3, FolderOpen, Plus } from 'lucide-react'
import { useRef, useState } from 'react'
import { useApp } from '../state/AppContext'
import { Brand } from './Brand'
import { parseBackup } from '../lib/storage'

const options = [
  { minutes: 10, label: 'Light', copy: 'A small habit for busy days.' },
  { minutes: 20, label: 'Steady', copy: 'Enough room for gradual growth.' },
  { minutes: 30, label: 'Focused', copy: 'A serious daily learning practice.' },
  { minutes: 45, label: 'Deep', copy: 'For exams or ambitious goals.' },
]

type StartChoice = 'fresh' | 'neo'

export const Onboarding = () => {
  const { completeOnboarding, replaceData } = useApp()
  const [choice, setChoice] = useState<StartChoice | null>(null)
  const [minutes, setMinutes] = useState(30)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const neoFile = useRef<HTMLInputElement>(null)

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
          <h1>How would you like to begin?</h1>
          <p className="onboarding-intro">Start with a clean workspace or restore a complete Neo Anki backup. You can import Anki collections after setup.</p>
          <div className="start-choice-grid">
            <button onClick={() => setChoice('fresh')}><Plus aria-hidden="true" /><span><strong>Start fresh</strong><small>Create a completely empty workspace and choose a daily review target.</small></span><ArrowRight aria-hidden="true" /></button>
            <button onClick={() => setChoice('neo')}><FolderOpen aria-hidden="true" /><span><strong>Restore Neo Anki backup</strong><small>Validate and restore a complete Neo Anki JSON backup.</small></span><ArrowRight aria-hidden="true" /></button>
          </div>
        </> : <>
          <button className="text-button onboarding-back" disabled={busy} onClick={() => { setChoice(null); setStatus('') }}><ArrowLeft size={17} /> Back</button>
          <div className="onboarding-icon">{choice === 'fresh' ? <Clock3 size={27} /> : <FolderOpen size={27} />}</div>
          <p className="eyebrow">{choice === 'fresh' ? 'Daily workload' : 'Validated restore'}</p>
          <h1>{choice === 'fresh' ? 'How much time can learning reliably have?' : 'Open a complete Neo workspace'}</h1>
          {choice === 'fresh' && <>
            <p className="onboarding-intro">Neo Anki adapts new material to this budget. Due knowledge is protected first, and overloaded days become recovery plans—not failures.</p>
            <fieldset className="time-options"><legend className="visually-hidden">Choose daily learning time</legend>{options.map((option) => <button key={option.minutes} onClick={() => setMinutes(option.minutes)} className={minutes === option.minutes ? 'selected' : ''} aria-pressed={minutes === option.minutes}><span className="radio-mark">{minutes === option.minutes && <Check size={15} />}</span><span><strong>{option.minutes} minutes · {option.label}</strong><small>{option.copy}</small></span></button>)}</fieldset>
            <button className="primary-button full-width" onClick={() => completeOnboarding(minutes)}>Create workspace <ArrowRight size={19} /></button>
          </>}
          {choice === 'neo' && <><p className="onboarding-intro">Neo Anki validates schema, references, scheduling bounds, Trash, packs, and media metadata before activating the workspace.</p><button className="primary-button full-width" disabled={busy} onClick={() => neoFile.current?.click()}>{busy ? 'Validating workspace…' : 'Choose Neo JSON backup'}</button><input ref={neoFile} className="visually-hidden" type="file" accept=".json" aria-label="Choose Neo Anki JSON backup to restore" onChange={(event) => void openNeo(event.target.files?.[0])} /></>}
        </>}
        {status && <p className={/could not|refused|not supported|error/i.test(status) ? 'inline-message error' : 'inline-message'} role={/could not|refused|not supported|error/i.test(status) ? 'alert' : 'status'}>{status}</p>}
        <p className="onboarding-note">Fresh workspaces contain no sample knowledge. Restores require validation and explicit confirmation.</p>
      </main>
    </div>
  )
}
