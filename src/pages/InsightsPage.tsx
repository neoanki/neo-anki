import { Activity, Brain, CheckCircle2, Clock3, TrendingUp } from 'lucide-react'
import { useMemo } from 'react'
import { useApp } from '../state/AppContext'

export const InsightsPage = () => {
  const { data, plan } = useApp()
  const insights = useMemo(() => {
    const reviews = data.reviews
    const recalled = reviews.filter((review) => review.rating > 1).length
    const average = reviews.length ? reviews.reduce((sum, review) => sum + review.durationSeconds, 0) / reviews.length : plan.averageReviewSeconds
    const difficult = data.cards.filter((card) => card.fsrs.lapses >= 3).length
    const mature = data.cards.filter((card) => card.fsrs.stability >= 21).length
    return {
      recall: reviews.length ? Math.round((recalled / reviews.length) * 100) : 90,
      average: Math.round(average),
      difficult,
      mature,
    }
  }, [data, plan.averageReviewSeconds])
  const max = Math.max(data.settings.dailyMinutes, ...plan.forecast.map((day) => day.plannedMinutes), 1)

  return (
    <div className="page insights-page">
      <header className="page-header"><div><p className="eyebrow">Memory</p><h1>Insights</h1><p className="page-intro">Signals for tuning content and workload—not scores to maximize.</p></div></header>

      <section className="metrics-grid" aria-label="Memory metrics">
        <div className="metric-card"><div className="metric-icon purple"><Brain size={21} /></div><span>Observed recall</span><strong>{insights.recall}%</strong><p>Target: {Math.round(data.settings.retention * 100)}%</p></div>
        <div className="metric-card"><div className="metric-icon green"><Clock3 size={21} /></div><span>Average response</span><strong>{insights.average}s</strong><p>Used by the time planner</p></div>
        <div className="metric-card"><div className="metric-icon amber"><Activity size={21} /></div><span>Needs repair</span><strong>{insights.difficult}</strong><p>Repeatedly forgotten prompts</p></div>
        <div className="metric-card"><div className="metric-icon blue"><CheckCircle2 size={21} /></div><span>Durable knowledge</span><strong>{insights.mature}</strong><p>Stability over 21 days</p></div>
      </section>

      <div className="insights-grid">
        <section className="insight-panel workload-panel">
          <div className="card-heading compact-heading"><div><p className="eyebrow">Workload</p><h2>Seven-day forecast</h2></div><TrendingUp size={21} /></div>
          <p>New material is throttled before projected work exceeds your daily limit.</p>
          <div className="horizontal-forecast" role="img" aria-label="Seven day workload compared with daily budget">
            {plan.forecast.map((day) => <div className="horizontal-day" key={day.date}><span>{day.label}</span><div><i style={{ width: `${Math.min(100, (day.plannedMinutes / max) * 100)}%` }} /></div><b>{day.plannedMinutes}m</b></div>)}
          </div>
        </section>

        <section className="insight-panel explanation-panel">
          <p className="eyebrow">Why today looks this way</p>
          <h2>Neo Anki introduced {plan.newPlanned} new prompts.</h2>
          <ul className="explanation-list">
            <li><span>1</span><div><strong>{plan.duePlanned} due reviews were reserved first.</strong><p>At your current pace, they need about {Math.round(plan.reviewSeconds / 60)} minutes.</p></div></li>
            <li><span>2</span><div><strong>The next seven days were simulated.</strong><p>Each new prompt adds predicted learning and review costs.</p></div></li>
            <li><span>3</span><div><strong>New material filled safe capacity.</strong><p>A buffer remains for difficult answers, pauses, and natural variation.</p></div></li>
          </ul>
        </section>
      </div>
    </div>
  )
}
