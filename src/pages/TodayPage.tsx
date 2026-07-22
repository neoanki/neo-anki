import { AlertTriangle, Blocks, Play, Plus, Upload } from 'lucide-react'
import { useMemo, useState } from 'react'
import { formatDuration } from '../lib/date'
import { buildStudySession, compareStudyContexts, studySubjectForCollection } from '../lib/planner'
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
  const { data, plan, planning, planningError, retryPlanning, startSession, setDailyMinutes, setRecoveryStrategy, navigate, loadDemoWorkspace } = useApp()
  const availableWorkSeconds = plan.reviewSeconds + plan.newSeconds
  const [sessionMinutes, setSessionMinutes] = useState<number | null>(null)
  const [intent, setIntent] = useState<SessionIntent>('balanced')
  const [renderedAt] = useState(Date.now)
  const weekday = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  const collections = useMemo(() => [...new Set(plan.queue.map((entry) => studySubjectForCollection(data.items.find((item) => item.id === entry.card.itemId)?.collection || '')))].sort(compareStudyContexts), [data.items, plan.queue])
  const [focusCollection, setFocusCollection] = useState(() => collections[0] || '')
  const effectiveFocusCollection = collections.includes(focusCollection) ? focusCollection : collections[0] || ''
  const recommendedMinutes = recommendedSessionMinutes(data.settings.dailyMinutes, availableWorkSeconds)
  const effectiveSessionMinutes = sessionMinutes !== null && sessionMinutes * 60 <= availableWorkSeconds ? sessionMinutes : recommendedMinutes

  const sessionOptions = useMemo(() => {
    const remainingMinutes = Math.max(1, Math.ceil(availableWorkSeconds / 60))
    return [...new Set([5, 10, 20, remainingMinutes])].filter((minutes) => minutes <= remainingMinutes).sort((a, b) => a - b)
  }, [availableWorkSeconds])
  const request = useMemo(() => ({ minutes: effectiveSessionMinutes, intent, focusCollection: intent === 'focus' ? effectiveFocusCollection : undefined }), [effectiveFocusCollection, effectiveSessionMinutes, intent])
  const session = useMemo(() => buildStudySession(plan, data.items, request), [data.items, plan, request])
  const remainingAfterSession = Math.max(0, availableWorkSeconds - session.plannedSeconds)
  const recoveryPolicies = [{ id: 'risk', label: 'Most at-risk first' }, ...extensionQueuePoliciesV2().map(({ id, label }) => ({ id, label }))]
  const nextDue = useMemo(() => data.cards.filter((card) => !card.suspended && (!card.buriedUntil || Date.parse(card.buriedUntil) <= renderedAt)).map((card) => new Date(card.fsrs.due)).filter((date) => Number.isFinite(date.getTime()) && date.getTime() > renderedAt).sort((left, right) => left.getTime() - right.getTime())[0], [data.cards, renderedAt])

  if (data.items.length === 0) return (
    <div className="page today-page quiet-today">
      <header className="page-header today-header">
        <div>
          <p className="eyebrow">{weekday}</p>
          <h1>Today</h1>
          <p className="page-intro">Your workspace is ready for its first knowledge item.</p>
        </div>
        <label className="daily-target-select" htmlFor="daily-target-empty">
          <span>Daily target</span>
          <select id="daily-target-empty" value={data.settings.dailyMinutes} onChange={(event) => setDailyMinutes(Number(event.target.value))}>
            {budgetOptions.map((minutes) => <option value={minutes} key={minutes}>{minutes} min</option>)}
          </select>
        </label>
      </header>
      <section className="empty-state today-empty-state" aria-labelledby="empty-today-title">
        <Plus size={32} aria-hidden="true" />
        <h2 id="empty-today-title">Add something you want to remember</h2>
        <p>Capture one knowledge item and Neo Anki will turn it into practice prompts, then schedule them when retrieval will help.</p>
        <div className="empty-state-actions">
          <button className="primary-button" onClick={() => navigate('create')}><Plus size={17} aria-hidden="true" /> Add your first knowledge item</button>
          <button className="secondary-button" onClick={() => navigate('extensions:org.neoanki.interoperability')}><Upload size={17} aria-hidden="true" /> Import from Anki</button>
          <button className="secondary-button" onClick={() => navigate('extensions')}><Blocks size={17} aria-hidden="true" /> Browse extensions</button>
        </div>
        <button className="text-button" onClick={() => window.confirm('Load Neo Anki’s sample workspace? This adds example knowledge to your currently empty workspace.') && loadDemoWorkspace()}>Load sample workspace</button>
      </section>
    </div>
  )

  if (!planning && !planningError && plan.queue.length === 0) return (
    <div className="page today-page quiet-today">
      <header className="page-header today-header">
        <div><p className="eyebrow">{weekday}</p><h1>Today</h1><p className="page-intro">{formatDuration(plan.spentSeconds)} studied · {formatDuration(plan.remainingSeconds)} available</p></div>
        <label className="daily-target-select" htmlFor="daily-target-caught-up"><span>Daily target</span><select id="daily-target-caught-up" value={data.settings.dailyMinutes} onChange={(event) => setDailyMinutes(Number(event.target.value))}>{budgetOptions.map((minutes) => <option value={minutes} key={minutes}>{minutes} min</option>)}</select></label>
      </header>
      <section className="empty-state today-empty-state" aria-labelledby="caught-up-title">
        <Blocks size={32} aria-hidden="true" />
        <h2 id="caught-up-title">You’re caught up</h2>
        <p>{nextDue ? `The next practice prompt is due ${new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(nextDue)}.` : 'Nothing else is scheduled yet. New knowledge will enter practice when your daily target has room.'}</p>
        <div className="empty-state-actions"><button className="primary-button" onClick={() => navigate('create')}><Plus size={17} aria-hidden="true" /> Add knowledge item</button><button className="secondary-button" onClick={() => navigate('extensions')}><Blocks size={17} aria-hidden="true" /> Browse extensions</button></div>
      </section>
    </div>
  )

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
          <h2 id="study-launcher-title">{formatDuration(availableWorkSeconds)} available</h2>
          <p role={planning ? 'status' : undefined}>{planning ? 'Planning this large workspace in the background… Study controls will be ready without freezing this screen.' : planningError ? 'Neo Anki could not build today’s session. Your imported cards are safe.' : `${plan.duePlanned} ${plan.duePlanned === 1 ? 'review is' : 'reviews are'} ready, with ${plan.newPlanned} new practice ${plan.newPlanned === 1 ? 'prompt' : 'prompts'}. Neo Anki will keep unrelated subjects in separate blocks.`}</p>
        </div>
        <div className="study-controls">
          <label htmlFor="session-length"><span>Study for</span><select id="session-length" value={effectiveSessionMinutes} onChange={(event) => setSessionMinutes(Number(event.target.value))}>{sessionOptions.map((minutes) => <option value={minutes} key={minutes}>{minutes === Math.ceil(availableWorkSeconds / 60) ? `Finish (${minutes} min)` : `${minutes} min`}</option>)}</select></label>
          <label htmlFor="session-mode"><span>Mode</span><select id="session-mode" value={intent} onChange={(event) => setIntent(event.target.value as SessionIntent)}><option value="balanced">Mixed by subject</option><option value="focus">One subject</option><option value="urgent">Reviews only</option></select></label>
          {intent === 'focus' && <label htmlFor="focus-collection"><span>Subject</span><select id="focus-collection" value={effectiveFocusCollection} onChange={(event) => setFocusCollection(event.target.value)}>{collections.map((collection) => <option key={collection}>{collection}</option>)}</select></label>}
          <button className="primary-button study-button" disabled={planning || Boolean(planningError) || !session.queue.length} onClick={() => startSession(request)}><Play size={15} fill="currentColor" />{planning ? 'Planning…' : planningError ? 'Planning unavailable' : session.queue.length ? `Study ${formatDuration(session.plannedSeconds)}` : plan.remainingSeconds === 0 ? 'Done for today' : 'Nothing to study'}</button>
        </div>
      </section>

      <section className="session-list-pane" aria-labelledby="session-order-title">
        <header>
          <div><h2 id="session-order-title">Session order</h2><p>{planning ? 'Preparing practice prompts…' : `${session.queue.length} practice ${session.queue.length === 1 ? 'prompt' : 'prompts'} in ${session.blocks.length} ${session.blocks.length === 1 ? 'subject block' : 'subject blocks'}`}</p></div>
          <span>{planning ? 'Please wait' : `${formatDuration(remainingAfterSession)} left for later`}</span>
        </header>
        {planning ? <div className="empty-session" role="status" aria-live="polite"><strong>Building your session…</strong><span>Neo Anki is checking the imported scheduling data.</span></div> : planningError ? <div className="empty-session" role="alert"><strong>Today’s session could not be built.</strong><span>{planningError}</span><button className="secondary-button compact" onClick={retryPlanning}>Try again</button></div> : session.blocks.length > 0 ? (
          <div className="session-table" role="table" aria-label="Planned study blocks">
            <div className="session-table-header" role="row"><span role="columnheader">Subject</span><span role="columnheader">Reviews</span><span role="columnheader">New</span><span role="columnheader">Time</span></div>
            {session.blocks.map((block, index) => {
              const reviews = block.cards.filter((entry) => entry.reason === 'due').length
              const newCards = block.cards.length - reviews
              return <div className="block-preview-row" role="row" key={block.id}><span className="session-order-number">{index + 1}</span><strong role="cell">{block.contextKey}</strong><span role="cell">{reviews || '—'}</span><span role="cell">{newCards || '—'}</span><span role="cell">{formatDuration(block.estimatedSeconds)}</span><small>{block.cards.length} practice {block.cards.length === 1 ? 'prompt' : 'prompts'}</small></div>
            })}
          </div>
        ) : <div className="empty-session" role="status"><strong>No practice prompts match “{intent === 'urgent' ? 'Reviews only' : intent === 'focus' ? `One subject: ${effectiveFocusCollection}` : 'Mixed by subject'}.”</strong><span>The session filter is hiding otherwise available work.</span><button className="secondary-button compact" onClick={() => { setIntent('balanced'); setFocusCollection(collections[0] || '') }}>Reset session settings</button></div>}
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
