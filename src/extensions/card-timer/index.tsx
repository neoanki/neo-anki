import { useEffect, useState } from 'react'
import type { CoreModuleReviewToolProps, CoreModuleSettingsPanelProps } from '../core-module'
import { defineCoreModule } from '../core-module'

export const CARD_TIMER_STORAGE_KEY = 'neoanki:extension:org.neoanki.card-timer:settings:v1'
const SETTINGS_EVENT = 'neoanki:card-timer-settings-changed'
const MIN_SECONDS = 5
const MAX_SECONDS = 300
const DEFAULT_SECONDS = 20

interface CardTimerSettings {
  enabled: boolean
  seconds: number
}

const defaultSettings = (): CardTimerSettings => ({ enabled: false, seconds: DEFAULT_SECONDS })
const clampSeconds = (value: number) => Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.round(value)))

export const readCardTimerSettings = (): CardTimerSettings => {
  try {
    const stored = JSON.parse(localStorage.getItem(CARD_TIMER_STORAGE_KEY) || 'null') as Partial<CardTimerSettings> | null
    if (!stored || typeof stored !== 'object') return defaultSettings()
    return {
      enabled: stored.enabled === true,
      seconds: typeof stored.seconds === 'number' && Number.isFinite(stored.seconds) ? clampSeconds(stored.seconds) : DEFAULT_SECONDS,
    }
  } catch {
    return defaultSettings()
  }
}

const writeCardTimerSettings = (settings: CardTimerSettings) => {
  localStorage.setItem(CARD_TIMER_STORAGE_KEY, JSON.stringify(settings))
  window.dispatchEvent(new Event(SETTINGS_EVENT))
}

const useCardTimerSettings = () => {
  const [settings, setSettings] = useState(readCardTimerSettings)
  useEffect(() => {
    const refresh = () => setSettings(readCardTimerSettings())
    const refreshFromStorage = (event: StorageEvent) => { if (event.key === CARD_TIMER_STORAGE_KEY) refresh() }
    window.addEventListener(SETTINGS_EVENT, refresh)
    window.addEventListener('storage', refreshFromStorage)
    return () => {
      window.removeEventListener(SETTINGS_EVENT, refresh)
      window.removeEventListener('storage', refreshFromStorage)
    }
  }, [])
  return settings
}

export const CardTimerSettingsPanel = ({ moduleId }: CoreModuleSettingsPanelProps) => {
  const settings = useCardTimerSettings()
  const update = (changes: Partial<CardTimerSettings>) => writeCardTimerSettings({ ...settings, ...changes })
  const inputId = `${moduleId}-seconds`

  return (
    <section className="setting-block card-timer-settings" aria-labelledby={`${moduleId}-title`}>
      <div className="extension-setting-heading">
        <div>
          <strong id={`${moduleId}-title`}>Card timer</strong>
          <p>Set one time limit for every card in a practice session.</p>
        </div>
        <label className="extension-switch">
          <input type="checkbox" checked={settings.enabled} onChange={(event) => update({ enabled: event.target.checked })} />
          <span>{settings.enabled ? 'Enabled' : 'Disabled'}</span>
        </label>
      </div>
      {settings.enabled && (
        <div className="card-timer-limit">
          <label htmlFor={inputId}>Seconds per card</label>
          <input
            id={inputId}
            type="number"
            min={MIN_SECONDS}
            max={MAX_SECONDS}
            step={5}
            value={settings.seconds}
            onChange={(event) => {
              const value = Number(event.target.value)
              if (Number.isFinite(value)) update({ seconds: clampSeconds(value) })
            }}
          />
        </div>
      )}
      <p className="card-timer-explanation">At zero, Neo Anki shows that the target time elapsed. Time alone never records a memory grade; reveal and grade the card yourself.</p>
    </section>
  )
}

const ActiveCardTimer = ({ seconds }: { seconds: number }) => {
  const [remaining, setRemaining] = useState(seconds)

  useEffect(() => {
    const deadline = performance.now() + seconds * 1000
    const tick = () => {
      const next = Math.max(0, Math.ceil((deadline - performance.now()) / 1000))
      setRemaining(next)
    }
    const interval = window.setInterval(tick, 200)
    return () => window.clearInterval(interval)
  }, [seconds])

  const percentage = Math.max(0, Math.min(100, (remaining / seconds) * 100))
  const urgent = remaining <= 5

  return (
    <div className={urgent ? 'card-timer urgent' : 'card-timer'} role="timer" aria-label={`${remaining} seconds remaining for this card`}>
      <span className="card-timer-value">{remaining}s</span>
      <span className="card-timer-track" aria-hidden="true"><span style={{ width: `${percentage}%` }} /></span>
      {remaining === 5 && <span className="visually-hidden" role="status">Five seconds remaining for this card.</span>}
      {remaining === 0 && <span className="visually-hidden" role="status">Target time elapsed. Reveal and grade the card when ready.</span>}
    </div>
  )
}

export const CardTimerReviewTool = ({ card }: CoreModuleReviewToolProps) => {
  const settings = useCardTimerSettings()
  if (!settings.enabled) return null
  return <ActiveCardTimer key={`${card.id}:${settings.seconds}`} seconds={settings.seconds} />
}

export const cardTimerExtension = defineCoreModule({
  manifest: {
    id: 'org.neoanki.card-timer',
    name: 'Card Timer',
    version: '1.1.0',
    runtime: 'core',
    publisher: 'Neo Anki',
    permissions: ['ui:settings-panels', 'review:tools'],
    description: 'Shows an optional per-card target time without grading memory from elapsed time. Disabled by default.',
  },
  settingsPanels: [{ id: 'card-timer.settings', component: CardTimerSettingsPanel }],
  reviewTools: [{ id: 'card-timer.review', component: CardTimerReviewTool }],
})
