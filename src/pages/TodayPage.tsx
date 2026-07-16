import { ArrowRight, BookOpen, CalendarDays, Clock3, Gauge, Sparkles } from 'lucide-react'
import { useApp } from '../state/AppContext'
import { formatDuration } from '../lib/date'

const budgetOptions = [10, 20, 30, 45, 60]

export const TodayPage = () => {
  const { data, plan, navigate, setDailyMinutes, setRecoveryStrategy } = useApp()
  const weekday = new Date().toLocaleDateString(undefined, { weekday: 'long' })
  const usedSeconds = plan.reviewSeconds + plan.newSeconds
  const progress = Math.min(100, Math.round((usedSeconds / plan.budgetSeconds) * 100))
  const maxForecast = Math.max(data.settings.dailyMinutes, ...plan.forecast.map((day) => day.plannedMinutes), 1)

  return (
    <div className="page today-page">
      <header className="page-header today-header">
        <div>
          <p className="eyebrow">{weekday}’s plan</p>
          <h1>Make memory fit your life.</h1>
          <p className="page-intro">Tell Neo Anki how much time you have. It protects due knowledge first, then introduces only the new material your future schedule can afford.</p>
        </div>
        <div className={`plan-status ${plan.status}`}><span />{plan.status === 'recovery' ? 'Recovery mode' : plan.status === 'full' ? 'Plan is full' : 'Comfortable plan'}</div>
      </header>

      <section className="budget-card" aria-labelledby="budget-title">
        <div className="budget-copy">
          <div className="section-icon"><Clock3 size={20} /></div>
          <div>
            <p className="eyebrow">Daily time budget</p>
            <h2 id="budget-title">I have {data.settings.dailyMinutes} minutes</h2>
            <p>This is a real limit. New material automatically expands or contracts around it.</p>
          </div>
        </div>
        <div className="segmented-control" aria-label="Daily time budget">
          {budgetOptions.map((minutes) => (
            <button key={minutes} className={data.settings.dailyMinutes === minutes ? 'selected' : ''} onClick={() => setDailyMinutes(minutes)} aria-pressed={data.settings.dailyMinutes === minutes}>{minutes}</button>
          ))}
        </div>
      </section>

      <div className="today-grid">
        <section className="plan-card primary-surface" aria-labelledby="plan-title">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Your session</p>
              <h2 id="plan-title">{formatDuration(usedSeconds)} of focused work</h2>
            </div>
            <span className="large-count">{plan.queue.length}</span>
          </div>

          <div className="progress-track" role="progressbar" aria-label="Daily budget planned" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></div>

          <div className="allocation-list">
            <div className="allocation-row">
              <span className="allocation-dot review" />
              <div><strong>Protect what you know</strong><span>{plan.duePlanned} due reviews</span></div>
              <b>{formatDuration(plan.reviewSeconds)}</b>
            </div>
            <div className="allocation-row">
              <span className="allocation-dot new" />
              <div><strong>Grow carefully</strong><span>{plan.newPlanned} new prompts</span></div>
              <b>{formatDuration(plan.newSeconds)}</b>
            </div>
            <div className="allocation-row muted-row">
              <span className="allocation-dot buffer" />
              <div><strong>Breathing room</strong><span>For difficult prompts and pauses</span></div>
              <b>{formatDuration(plan.bufferSeconds)}</b>
            </div>
          </div>

          {plan.deferred > 0 && (
            <div className="recovery-note"><Gauge size={20} /><div><strong>{plan.deferred} reviews won’t fit today.</strong><p>New material is paused. Choose how Neo Anki should select today’s rescue queue.</p><label htmlFor="recovery-strategy">Recovery strategy</label><select id="recovery-strategy" value={data.settings.recoveryStrategy} onChange={(event) => setRecoveryStrategy(event.target.value as 'risk' | 'oldest' | 'momentum')}><option value="risk">Protect most at-risk</option><option value="oldest">Oldest overdue first</option><option value="momentum">Quick wins first</option></select></div></div>
          )}

          {plan.goalBreakdown.length > 0 && <div className="goal-breakdown"><strong>Goals represented today</strong>{plan.goalBreakdown.map((goal) => <span key={goal.goalId}>{goal.name}<b>{goal.count}</b></span>)}</div>}

          <button className="primary-button full-width" disabled={!plan.queue.length} onClick={() => navigate('review')}>
            Start focused session <ArrowRight size={19} />
          </button>
          <p className="keyboard-hint">Press <kbd>Space</kbd> to reveal, then <kbd>1</kbd>–<kbd>3</kbd> to grade.</p>
        </section>

        <section className="forecast-card" aria-labelledby="forecast-title">
          <div className="card-heading compact-heading">
            <div><p className="eyebrow">Load forecast</p><h2 id="forecast-title">The next seven days</h2></div>
            <CalendarDays size={21} />
          </div>
          <p className="chart-summary">With {plan.newPlanned} new prompts today, the forecast remains inside your {data.settings.dailyMinutes}-minute budget.</p>
          <div className="forecast-chart" role="img" aria-label={`Seven-day workload forecast, daily budget ${data.settings.dailyMinutes} minutes`}>
            <div className="budget-line" style={{ bottom: `${(data.settings.dailyMinutes / maxForecast) * 100}%` }}><span>budget</span></div>
            {plan.forecast.map((day) => (
              <div className="forecast-column" key={day.date}>
                <div className="forecast-value">{day.plannedMinutes || '—'}</div>
                <div className="forecast-bar-wrap"><span className="forecast-bar" style={{ height: `${Math.max(4, (day.plannedMinutes / maxForecast) * 100)}%` }} /></div>
                <span>{day.label}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="principle-strip" aria-label="Planning principles">
        <div><BookOpen size={20} /><span><strong>Reviews first</strong>Due knowledge gets priority.</span></div>
        <div><Sparkles size={20} /><span><strong>New material is elastic</strong>It fills safe capacity automatically.</span></div>
        <div><Gauge size={20} /><span><strong>Your pace learns</strong>Review duration improves estimates.</span></div>
      </section>
    </div>
  )
}
