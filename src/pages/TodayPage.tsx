import { AlertTriangle, Play } from 'lucide-react'
import { useMemo, useState } from 'react'
import { formatDuration } from '../lib/date'
import { buildStudySession } from '../lib/planner'
import { useApp } from '../state/AppContext'
import type { SessionIntent } from '../types'
import { extensionQueuePoliciesV2 } from '../extensions/v2/registry'

const budgetOptions = [10, 20, 30, 45, 60]

const recommendedSessionMinutes = (dailyMinutes: number, availableWorkSeconds: number) => {
  const remainingMinutes = Math.max(1, Math.ceil(availableWorkSeconds / 60))
  const recommendation = dailyMinutes <= 15 ? dailyMinutes : dailyMinutes <= 30 ? 10 : 20
  return Math.min(recommendation, remainingMinutes)
}

export const TodayPage = () => {
  const { data, plan, planning, startSession, setDailyMinutes, setRecoveryStrategy } = useApp()
  const availableWorkSeconds = plan.reviewSeconds + plan.newSeconds
  const [sessionMinutes, setSessionMinutes] = useState(() => recommendedSessionMinutes(data.settings.dailyMinutes, availableWorkSeconds))
  const [intent, setIntent] = useState<SessionIntent>('balanced')
  const weekday = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
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
  const remainingAfterSession = Math.max(0, plan.remainingSeconds - session.plannedSeconds)
  const recoveryPolicies = [{ id: 'risk', label: 'Most at-risk first' }, ...extensionQueuePoliciesV2().map(({ id, label }) => ({ id, label }))]

  return (
    <div className="page today-page quiet-today">
      <header className="page-header today-header">
        <div>
          <p className="eyebrow">{weekday}</p>
          <h1>Today</h1>
          <p className="page-intro">{formatDuration(plan.spentSeconds)} studied · {formatDuration(plan.remainingSeconds)} available</p>
        </div>
        <label className="daily-target-select" htmlFor="daily-target">
          <span>Daily target</span>
          <select id="daily-target" value={data.settings.dailyMinutes} onChange={(event) => setDailyMinutes(Number(event.target.value))}>
            {budgetOptions.map((minutes) => <option value={minutes} key={minutes}>{minutes} min</option>)}
          </select>
        </label>
      </header>

      <section className="study-launcher" aria-labelledby="study-launcher-title">
        <div className="study-launcher-copy">
          <h2 id="study-launcher-title">{formatDuration(plan.remainingSeconds)} available</h2>
          <p role={planning ? 'status' : undefined}>{planning ? 'Planning this large workspace in the background… Study controls will be ready without freezing this screen.' : `${plan.duePlanned} reviews and ${plan.newPlanned} new prompts are ready. Neo Anki will keep unrelated subjects in separate blocks.`}</p>
        </div>
        <div className="study-controls">
          <label htmlFor="session-length"><span>Study for</span><select id="session-length" value={effectiveSessionMinutes} onChange={(event) => setSessionMinutes(Number(event.target.value))}>{sessionOptions.map((minutes) => <option value={minutes} key={minutes}>{minutes === Math.ceil(availableWorkSeconds / 60) ? `Finish (${minutes} min)` : `${minutes} min`}</option>)}</select></label>
          <label htmlFor="session-mode"><span>Mode</span><select id="session-mode" value={intent} onChange={(event) => setIntent(event.target.value as SessionIntent)}><option value="balanced">Mixed by subject</option><option value="focus">One subject</option><option value="urgent">Reviews only</option></select></label>
          {intent === 'focus' && <label htmlFor="focus-collection"><span>Subject</span><select id="focus-collection" value={effectiveFocusCollection} onChange={(event) => setFocusCollection(event.target.value)}>{collections.map((collection) => <option key={collection}>{collection}</option>)}</select></label>}
          <button className="primary-button study-button" disabled={planning || !session.queue.length} onClick={() => startSession(request)}><Play size={15} fill="currentColor" />{planning ? 'Planning…' : session.queue.length ? `Study ${formatDuration(session.plannedSeconds)}` : plan.remainingSeconds === 0 ? 'Done for today' : 'Nothing to study'}</button>
        </div>
      </section>

      <section className="session-list-pane" aria-labelledby="session-order-title">
        <header>
          <div><h2 id="session-order-title">Session order</h2><p>{session.queue.length} prompts in {session.blocks.length} {session.blocks.length === 1 ? 'subject block' : 'subject blocks'}</p></div>
          <span>{formatDuration(remainingAfterSession)} left for later</span>
        </header>
        {session.blocks.length > 0 ? (
          <div className="session-table" role="table" aria-label="Planned study blocks">
            <div className="session-table-header" role="row"><span role="columnheader">Subject</span><span role="columnheader">Reviews</span><span role="columnheader">New</span><span role="columnheader">Time</span></div>
            {session.blocks.map((block, index) => {
              const reviews = block.cards.filter((entry) => entry.reason === 'due').length
              const newCards = block.cards.length - reviews
              return <div className="block-preview-row" role="row" key={block.id}><span className="session-order-number">{index + 1}</span><strong role="cell">{block.contextKey}</strong><span role="cell">{reviews || '—'}</span><span role="cell">{newCards || '—'}</span><span role="cell">{formatDuration(block.estimatedSeconds)}</span><small>{block.cards.length} prompts</small></div>
            })}
          </div>
        ) : <div className="empty-session">No prompts match these session settings.</div>}
        <p className="plain-note">You can stop between subject blocks. Anything unfinished stays in the queue.</p>
      </section>

      {plan.deferred > 0 && (
        <div className="plain-warning"><AlertTriangle size={16} /><div><strong>{plan.deferred} reviews do not fit today’s target.</strong><span>New material is paused.</span></div><label htmlFor="recovery-strategy"><span className="visually-hidden">Recovery strategy</span><select id="recovery-strategy" value={data.settings.recoveryStrategy} onChange={(event) => setRecoveryStrategy(event.target.value)}>{recoveryPolicies.map((policy) => <option value={policy.id} key={policy.id}>{policy.label}</option>)}</select></label></div>
      )}

      <details className="planning-details">
        <summary>Planning details</summary>
        <div className="planning-details-body">
          <div className="allocation-list">
            <div className="allocation-row"><div><strong>Reviews</strong><span>{plan.duePlanned} due prompts</span></div><b>{formatDuration(plan.reviewSeconds)}</b></div>
            <div className="allocation-row"><div><strong>New material</strong><span>{plan.newPlanned} prompts</span></div><b>{formatDuration(plan.newSeconds)}</b></div>
            <div className="allocation-row"><div><strong>Buffer</strong><span>Difficulty and pauses</span></div><b>{formatDuration(plan.bufferSeconds)}</b></div>
          </div>
          <div className="plain-forecast"><strong>Seven-day estimate</strong>{plan.forecast.map((day) => <span key={day.date}><i>{day.label}</i><b>{day.plannedMinutes} min</b></span>)}</div>
        </div>
      </details>
    </div>
  )
}
