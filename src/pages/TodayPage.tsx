import { ArrowRight, BookOpen, CalendarDays, Clock3, Gauge, Layers3, Sparkles, Target, Zap } from 'lucide-react'
import { useMemo, useState } from 'react'
import { formatDuration } from '../lib/date'
import { buildStudySession } from '../lib/planner'
import { useApp } from '../state/AppContext'
import type { SessionIntent } from '../types'

const budgetOptions = [10, 20, 30, 45, 60]

const recommendedSessionMinutes = (dailyMinutes: number, availableWorkSeconds: number) => {
  const remainingMinutes = Math.max(1, Math.ceil(availableWorkSeconds / 60))
  const recommendation = dailyMinutes <= 15 ? dailyMinutes : dailyMinutes <= 30 ? 10 : 20
  return Math.min(recommendation, remainingMinutes)
}

export const TodayPage = () => {
  const { data, plan, startSession, setDailyMinutes, setRecoveryStrategy } = useApp()
  const availableWorkSeconds = plan.reviewSeconds + plan.newSeconds
  const [sessionMinutes, setSessionMinutes] = useState(() => recommendedSessionMinutes(data.settings.dailyMinutes, availableWorkSeconds))
  const [intent, setIntent] = useState<SessionIntent>('balanced')
  const weekday = new Date().toLocaleDateString(undefined, { weekday: 'long' })
  const collections = useMemo(() => [...new Set(plan.queue.map((entry) => data.items.find((item) => item.id === entry.card.itemId)?.collection || 'Unsorted'))], [data.items, plan.queue])
  const [focusCollection, setFocusCollection] = useState(() => collections[0] || '')
  const effectiveFocusCollection = collections.includes(focusCollection) ? focusCollection : collections[0] || ''
  const effectiveSessionMinutes = sessionMinutes * 60 <= availableWorkSeconds ? sessionMinutes : recommendedSessionMinutes(data.settings.dailyMinutes, availableWorkSeconds)

  const sessionOptions = useMemo(() => {
    const remainingMinutes = Math.max(1, Math.ceil(availableWorkSeconds / 60))
    return [...new Set([5, 10, 20, remainingMinutes])].filter((minutes) => minutes <= remainingMinutes).sort((a, b) => a - b)
  }, [availableWorkSeconds])
  const request = useMemo(() => ({ minutes: effectiveSessionMinutes, intent, focusCollection: intent === 'focus' ? effectiveFocusCollection : undefined }), [effectiveFocusCollection, effectiveSessionMinutes, intent])
  const session = useMemo(() => buildStudySession(plan, data.items, request), [data.items, plan, request])
  const projectedProgress = Math.min(100, Math.round(((plan.spentSeconds + session.plannedSeconds) / Math.max(1, plan.budgetSeconds)) * 100))
  const maxForecast = Math.max(data.settings.dailyMinutes, ...plan.forecast.map((day) => day.plannedMinutes), 1)
  const remainingAfterSession = Math.max(0, plan.remainingSeconds - session.plannedSeconds)

  return (
    <div className="page today-page">
      <header className="page-header today-header">
        <div>
          <p className="eyebrow">{weekday}</p>
          <h1>Today’s study plan</h1>
          <p className="page-intro">Choose a session length. Neo Anki has already balanced reviews, new material, and your future workload.</p>
        </div>
        <div className={`plan-status ${plan.status}`}><span />{plan.remainingSeconds === 0 ? 'Daily target complete' : plan.status === 'recovery' ? 'Recovery mode' : plan.status === 'full' ? 'Plan is full' : 'Comfortable plan'}</div>
      </header>

      <section className="budget-card" aria-labelledby="budget-title">
        <div className="budget-copy">
          <div className="section-icon"><Clock3 size={20} /></div>
          <div>
            <p className="eyebrow">Daily time target</p>
            <h2 id="budget-title">{formatDuration(plan.spentSeconds)} practiced · {formatDuration(plan.remainingSeconds)} available</h2>
            <p>Neo Anki adapts new material to stay inside your {data.settings.dailyMinutes}-minute promise.</p>
          </div>
        </div>
        <div className="segmented-control" aria-label="Daily time target">
          {budgetOptions.map((minutes) => (
            <button key={minutes} className={data.settings.dailyMinutes === minutes ? 'selected' : ''} onClick={() => setDailyMinutes(minutes)} aria-pressed={data.settings.dailyMinutes === minutes}>{minutes}</button>
          ))}
        </div>
      </section>

      <div className="today-grid">
        <section className="plan-card primary-surface" aria-labelledby="session-title">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Practice now</p>
              <h2 id="session-title">Choose the shape of this session</h2>
            </div>
            <span className="large-count">{session.queue.length}</span>
          </div>

          <fieldset className="session-fieldset">
            <legend>How much time do you have?</legend>
            <div className="session-time-control">
              {sessionOptions.map((minutes) => <button type="button" key={minutes} className={effectiveSessionMinutes === minutes ? 'selected' : ''} aria-pressed={effectiveSessionMinutes === minutes} onClick={() => setSessionMinutes(minutes)}>{minutes === Math.ceil(availableWorkSeconds / 60) ? `Finish · ${minutes} min` : `${minutes} min`}</button>)}
            </div>
          </fieldset>

          <fieldset className="session-fieldset">
            <legend>What should Neo Anki optimize for?</legend>
            <div className="intent-grid">
              <button type="button" className={intent === 'balanced' ? 'selected' : ''} aria-pressed={intent === 'balanced'} onClick={() => setIntent('balanced')}><Layers3 size={18} /><span><strong>Today’s mix</strong><small>Coherent topic blocks</small></span></button>
              <button type="button" className={intent === 'focus' ? 'selected' : ''} aria-pressed={intent === 'focus'} onClick={() => setIntent('focus')}><Target size={18} /><span><strong>Focus</strong><small>Stay in one context</small></span></button>
              <button type="button" className={intent === 'urgent' ? 'selected' : ''} aria-pressed={intent === 'urgent'} onClick={() => setIntent('urgent')}><Zap size={18} /><span><strong>Urgent only</strong><small>No new material</small></span></button>
            </div>
            {intent === 'focus' && <div className="focus-select"><label htmlFor="focus-collection">Focus area</label><select id="focus-collection" value={effectiveFocusCollection} onChange={(event) => setFocusCollection(event.target.value)}>{collections.map((collection) => <option key={collection}>{collection}</option>)}</select></div>}
          </fieldset>

          <div className="progress-track session-budget-progress" role="progressbar" aria-label="Daily time after this session" aria-valuemin={0} aria-valuemax={100} aria-valuenow={projectedProgress}><span style={{ width: `${projectedProgress}%` }} /></div>

          <div className="session-summary" aria-live="polite">
            <div><strong>{formatDuration(session.plannedSeconds)}</strong><span>planned now</span></div>
            <div><strong>{session.blocks.length}</strong><span>{session.blocks.length === 1 ? 'context block' : 'context blocks'}</span></div>
            <div><strong>{formatDuration(remainingAfterSession)}</strong><span>left for later</span></div>
          </div>

          {session.blocks.length > 0 && <div className="block-preview" aria-label="Session order">{session.blocks.map((block, index) => <div className="block-preview-row" key={block.id}><span>{index + 1}</span><div><strong>{block.contextKey}</strong><small>{block.cards.length} prompts · {formatDuration(block.estimatedSeconds)}</small></div></div>)}</div>}

          {plan.deferred > 0 && (
            <div className="recovery-note"><Gauge size={20} /><div><strong>{plan.deferred} reviews won’t fit today.</strong><p>New material is paused while Neo Anki protects the most useful part of your queue.</p><label htmlFor="recovery-strategy">Recovery strategy</label><select id="recovery-strategy" value={data.settings.recoveryStrategy} onChange={(event) => setRecoveryStrategy(event.target.value as 'risk' | 'oldest' | 'momentum')}><option value="risk">Protect most at-risk</option><option value="oldest">Oldest overdue first</option><option value="momentum">Quick wins first</option></select></div></div>
          )}

          <button className="primary-button full-width" disabled={!session.queue.length} onClick={() => startSession(request)}>
            {session.queue.length ? `Start ${formatDuration(session.plannedSeconds)} session` : plan.remainingSeconds === 0 ? 'Daily target complete' : 'No matching prompts'} <ArrowRight size={19} />
          </button>
          <p className="keyboard-hint">You can stop between blocks. Unfinished prompts simply remain available later.</p>
        </section>

        <section className="forecast-card" aria-labelledby="forecast-title">
          <div className="card-heading compact-heading">
            <div><p className="eyebrow">Load forecast</p><h2 id="forecast-title">The next seven days</h2></div>
            <CalendarDays size={21} />
          </div>
          <p className="chart-summary">With {plan.newPlanned} new prompts available today, the forecast remains inside your {data.settings.dailyMinutes}-minute target.</p>
          <div className="forecast-chart" role="img" aria-label={`Seven-day workload forecast, daily target ${data.settings.dailyMinutes} minutes`}>
            <div className="budget-line" style={{ bottom: `${(data.settings.dailyMinutes / maxForecast) * 100}%` }}><span>target</span></div>
            {plan.forecast.map((day) => (
              <div className="forecast-column" key={day.date}>
                <div className="forecast-value">{day.plannedMinutes || '—'}</div>
                <div className="forecast-bar-wrap"><span className="forecast-bar" style={{ height: `${Math.max(4, (day.plannedMinutes / maxForecast) * 100)}%` }} /></div>
                <span>{day.label}</span>
              </div>
            ))}
          </div>
          <div className="allocation-list forecast-allocation">
            <div className="allocation-row"><span className="allocation-dot review" /><div><strong>Protect what you know</strong><span>{plan.duePlanned} due reviews</span></div><b>{formatDuration(plan.reviewSeconds)}</b></div>
            <div className="allocation-row"><span className="allocation-dot new" /><div><strong>Grow carefully</strong><span>{plan.newPlanned} new prompts</span></div><b>{formatDuration(plan.newSeconds)}</b></div>
            <div className="allocation-row muted-row"><span className="allocation-dot buffer" /><div><strong>Breathing room</strong><span>For difficult prompts and pauses</span></div><b>{formatDuration(plan.bufferSeconds)}</b></div>
          </div>
        </section>
      </div>

      <section className="principle-strip" aria-label="Planning principles">
        <div><BookOpen size={20} /><span><strong>Daily target, flexible sessions</strong>Practice in one sitting or several.</span></div>
        <div><Layers3 size={20} /><span><strong>Contexts stay coherent</strong>Related ideas mix; unrelated topics switch in blocks.</span></div>
        <div><Sparkles size={20} /><span><strong>New material is elastic</strong>It fills safe future capacity automatically.</span></div>
      </section>
    </div>
  )
}
