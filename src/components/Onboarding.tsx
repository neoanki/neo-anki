import { ArrowRight, Check, Clock3 } from 'lucide-react'
import { useState } from 'react'
import { useApp } from '../state/AppContext'
import { Brand } from './Brand'

const options = [
  { minutes: 10, label: 'Light', copy: 'A small habit for busy days.' },
  { minutes: 20, label: 'Steady', copy: 'Enough room for gradual growth.' },
  { minutes: 30, label: 'Focused', copy: 'A serious daily learning practice.' },
  { minutes: 45, label: 'Deep', copy: 'For exams or ambitious goals.' },
]

export const Onboarding = () => {
  const { completeOnboarding } = useApp()
  const [minutes, setMinutes] = useState(30)
  return (
    <div className="onboarding-shell">
      <div className="onboarding-top"><Brand /><span>Local-first memory system</span></div>
      <main className="onboarding-card">
        <div className="onboarding-icon"><Clock3 size={27} /></div>
        <p className="eyebrow">One useful promise</p>
        <h1>How much time can learning reliably have?</h1>
        <p className="onboarding-intro">Neo Anki adapts new material to this budget. Due knowledge is protected first, and overloaded days become recovery plans—not failures.</p>
        <fieldset className="time-options">
          <legend className="visually-hidden">Choose daily learning time</legend>
          {options.map((option) => (
            <button key={option.minutes} onClick={() => setMinutes(option.minutes)} className={minutes === option.minutes ? 'selected' : ''} aria-pressed={minutes === option.minutes}>
              <span className="radio-mark">{minutes === option.minutes && <Check size={15} />}</span>
              <span><strong>{option.minutes} minutes · {option.label}</strong><small>{option.copy}</small></span>
            </button>
          ))}
        </fieldset>
        <button className="primary-button full-width" onClick={() => completeOnboarding(minutes)}>Build my first plan <ArrowRight size={19} /></button>
        <p className="onboarding-note">You can change this any day. Your data stays in this browser.</p>
      </main>
    </div>
  )
}
