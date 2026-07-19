import { Activity, Brain, CheckCircle2, Clock3, TrendingUp } from 'lucide-react'
import { State } from 'ts-fsrs'
import { useMemo, useState } from 'react'
import type { CoreModulePageProps } from '../core-module'

const dayKey = (date: Date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
const ratingLabel = (rating: number) => rating === 1 ? 'Again' : rating === 2 ? 'Hard' : rating === 3 ? 'Good' : 'Easy'
const duration = (seconds: number) => seconds < 60 ? `${Math.round(seconds)}s` : seconds < 3600 ? `${Math.round(seconds / 60)}m` : `${(seconds / 3600).toFixed(1)}h`

export const InsightsPage = ({ data, plan }: CoreModulePageProps) => {
  const [windowDays, setWindowDays] = useState<7 | 30 | 90 | 'all'>(30)
  const [now] = useState(() => new Date())
  const insights = useMemo(() => {
    const reversed = new Set(data.reviews.filter((review) => review.kind === 'reversal' && review.reversesReviewId).map((review) => review.reversesReviewId!))
    const effective = data.reviews.filter((review) => (review.kind === 'review' || !review.kind) && !reversed.has(review.id))
    const cutoff = windowDays === 'all' ? Number.NEGATIVE_INFINITY : now.getTime() - windowDays * 86_400_000
    const reviews = effective.filter((review) => new Date(review.reviewedAt).getTime() >= cutoff)
    let recalled = 0; let timedSeconds = 0; let timedCount = 0; let totalActiveSeconds = 0
    const counts = [0, 0, 0, 0, 0]
    const reviewsByCard = new Map<string, typeof reviews>()
    const reviewsByDay = new Map<string, typeof reviews>()
    for (const review of reviews) {
      if (review.rating >= 3) recalled += 1
      if (review.durationSeconds >= 2 && review.durationSeconds <= 120) { timedSeconds += review.durationSeconds; timedCount += 1 }
      totalActiveSeconds += Math.min(120, Math.max(0, review.durationSeconds)); counts[review.rating] += 1
      const cardReviews = reviewsByCard.get(review.cardId); if (cardReviews) cardReviews.push(review); else reviewsByCard.set(review.cardId, [review])
      const key = dayKey(new Date(review.reviewedAt)); const dayReviews = reviewsByDay.get(key); if (dayReviews) dayReviews.push(review); else reviewsByDay.set(key, [review])
    }
    const ratingCounts = [1, 2, 3, 4].map((rating) => ({ rating, label: ratingLabel(rating), count: counts[rating] }))
    const cardById = new Map(data.cards.map((card) => [card.id, card]))
    const itemById = new Map(data.items.map((item) => [item.id, item]))
    const deckMap = new Map<string, typeof data.cards>()
    for (const card of data.cards) {
      const deck = card.deckName || itemById.get(card.itemId)?.collection || 'Default'
      deckMap.set(deck, [...(deckMap.get(deck) || []), card])
    }
    const deckRows = [...deckMap].map(([deck, cards]) => {
      const deckReviews = cards.flatMap((card) => reviewsByCard.get(card.id) || [])
      return {
        deck, cards: cards.length, newCards: cards.filter((card) => card.fsrs.state === State.New).length,
        learning: cards.filter((card) => card.fsrs.state === State.Learning || card.fsrs.state === State.Relearning).length,
        review: cards.filter((card) => card.fsrs.state === State.Review).length,
        due: cards.filter((card) => !card.suspended && (!card.buriedUntil || new Date(card.buriedUntil) <= now) && card.fsrs.state !== State.New && new Date(card.fsrs.due) <= now).length,
        suspended: cards.filter((card) => card.suspended).length,
        observedRecall: deckReviews.length ? Math.round(deckReviews.filter((review) => review.rating >= 3).length / deckReviews.length * 100) : null,
        sample: deckReviews.length,
      }
    }).sort((left, right) => right.due - left.due || left.deck.localeCompare(right.deck))
    const requestedDays = windowDays === 'all' ? Math.min(365, Math.max(1, Math.ceil((now.getTime() - Math.min(now.getTime(), ...reviews.map((review) => Date.parse(review.reviewedAt)))) / 86_400_000) + 1)) : windowDays
    const daily = Array.from({ length: requestedDays }, (_, offset) => {
      const date = new Date(now); date.setDate(date.getDate() - (requestedDays - 1 - offset)); const key = dayKey(date)
      const entries = reviewsByDay.get(key) || []
      return { key, label: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), reviews: entries.length, activeSeconds: entries.reduce((sum, review) => sum + Math.min(120, review.durationSeconds), 0), recall: entries.length ? Math.round(entries.filter((review) => review.rating >= 3).length / entries.length * 100) : null }
    })
    return {
      success: reviews.length ? Math.round((recalled / reviews.length) * 100) : null,
      average: timedCount ? Math.round(timedSeconds / timedCount) : null,
      sample: reviews.length, totalActiveSeconds, ratingCounts, daily, deckRows,
      difficult: data.cards.filter((card) => card.fsrs.lapses >= 3).length,
      mature: data.cards.filter((card) => card.fsrs.stability >= 21).length,
      stateCounts: {
        new: data.cards.filter((card) => card.fsrs.state === State.New).length,
        learning: data.cards.filter((card) => card.fsrs.state === State.Learning || card.fsrs.state === State.Relearning).length,
        review: data.cards.filter((card) => card.fsrs.state === State.Review).length,
        suspended: data.cards.filter((card) => card.suspended).length,
        buried: data.cards.filter((card) => card.buriedUntil && new Date(card.buriedUntil) > now).length,
      },
      orphanReviews: reviews.filter((review) => !cardById.has(review.cardId)).length,
    }
  }, [data, now, windowDays])
  const max = Math.max(data.settings.dailyMinutes, ...plan.forecast.map((day) => day.plannedMinutes), 1)
  const period = windowDays === 'all' ? 'all history' : `last ${windowDays} days`

  return (
    <div className="page insights-page">
      <header className="page-header"><div><p className="eyebrow">Memory</p><h1>Insights</h1><p className="page-intro">Observed study history and current workload—not mastery scores.</p></div><label className="insight-window"><span>History window</span><select value={windowDays} onChange={(event) => setWindowDays(event.target.value === 'all' ? 'all' : Number(event.target.value) as 7 | 30 | 90)}><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option><option value="all">All history</option></select></label></header>

      <section className="metrics-grid" aria-label="Memory metrics">
        <div className="metric-card"><div className="metric-icon purple"><Brain size={21} /></div><span>Observed successful recall</span><strong>{insights.success == null ? '—' : `${insights.success}%`}</strong><p>{insights.sample ? `${insights.sample} ratings in ${period}` : `No ratings in ${period}`}</p></div>
        <div className="metric-card"><div className="metric-icon green"><Clock3 size={21} /></div><span>Average active response</span><strong>{insights.average == null ? '—' : `${insights.average}s`}</strong><p>{insights.average == null ? 'Complete reviews to establish a pace' : `${duration(insights.totalActiveSeconds)} total · 2–120s samples`}</p></div>
        <div className="metric-card"><div className="metric-icon amber"><Activity size={21} /></div><span>Needs repair</span><strong>{insights.difficult}</strong><p>Cards with at least three recorded lapses</p></div>
        <div className="metric-card"><div className="metric-icon blue"><CheckCircle2 size={21} /></div><span>High-stability cards</span><strong>{insights.mature}</strong><p>Estimated stability over 21 days; not a mastery claim</p></div>
      </section>

      <section className="insight-panel state-panel" aria-labelledby="collection-state-title">
        <div className="card-heading compact-heading"><div><p className="eyebrow">Collection state</p><h2 id="collection-state-title">What exists right now</h2></div></div>
        <dl className="state-summary"><div><dt>New</dt><dd>{insights.stateCounts.new}</dd></div><div><dt>Learning</dt><dd>{insights.stateCounts.learning}</dd></div><div><dt>Review</dt><dd>{insights.stateCounts.review}</dd></div><div><dt>Suspended</dt><dd>{insights.stateCounts.suspended}</dd></div><div><dt>Buried</dt><dd>{insights.stateCounts.buried}</dd></div></dl>
      </section>

      <div className="insights-grid">
        <section className="insight-panel workload-panel">
          <div className="card-heading compact-heading"><div><p className="eyebrow">Workload</p><h2>Seven-day forecast</h2></div><TrendingUp size={21} /></div>
          <p>This heuristic estimate uses current due dates and fixed reinforcement costs; it is not a scheduler simulation or guarantee.</p>
          <div className="horizontal-forecast" role="img" aria-label="Seven day workload compared with daily budget">
            {plan.forecast.map((day) => <div className="horizontal-day" key={day.date}><span>{day.label}</span><div><i style={{ width: `${Math.min(100, (day.plannedMinutes / max) * 100)}%` }} /></div><b>{day.plannedMinutes}m</b></div>)}
          </div>
          <details className="data-table-details"><summary>Exact forecast data</summary><div className="table-scroll"><table><thead><tr><th scope="col">Day</th><th scope="col">Estimated review</th><th scope="col">Planned total</th></tr></thead><tbody>{plan.forecast.map((day) => <tr key={day.date}><th scope="row">{day.label}</th><td>{day.reviewMinutes} min</td><td>{day.plannedMinutes} min</td></tr>)}</tbody></table></div></details>
        </section>

        <section className="insight-panel explanation-panel">
          <p className="eyebrow">Why today looks this way</p>
          <h2>Neo Anki introduced {plan.newPlanned} new prompts.</h2>
          <ul className="explanation-list">
            <li><span>1</span><div><strong>{plan.duePlanned} due reviews were reserved first.</strong><p>At your current pace, they need about {Math.round(plan.reviewSeconds / 60)} minutes.</p></div></li>
            <li><span>2</span><div><strong>The next seven days were estimated.</strong><p>Each new prompt adds a fixed heuristic learning and review cost.</p></div></li>
            <li><span>3</span><div><strong>New material filled safe capacity.</strong><p>A buffer remains for difficult answers, pauses, and natural variation.</p></div></li>
          </ul>
        </section>
      </div>

      <section className="insight-panel history-panel" aria-labelledby="history-table-title">
        <div className="card-heading compact-heading"><div><p className="eyebrow">Review history</p><h2 id="history-table-title">Daily activity · {period}</h2></div></div>
        {!insights.sample ? <div className="insight-empty"><strong>No completed reviews in this window.</strong><p>Choose a longer history window or complete a study session.</p></div> : <><div className="rating-summary" aria-label="Rating distribution">{insights.ratingCounts.map((entry) => <div key={entry.rating}><span>{entry.label}</span><strong>{entry.count}</strong><small>{insights.sample ? Math.round(entry.count / insights.sample * 100) : 0}%</small></div>)}</div><div className="table-scroll"><table><thead><tr><th scope="col">Local day</th><th scope="col">Reviews</th><th scope="col">Observed recall</th><th scope="col">Active time</th></tr></thead><tbody>{insights.daily.filter((day) => day.reviews).map((day) => <tr key={day.key}><th scope="row">{day.label}</th><td>{day.reviews}</td><td>{day.recall}%</td><td>{duration(day.activeSeconds)}</td></tr>)}</tbody></table></div></>}
      </section>

      <section className="insight-panel deck-panel" aria-labelledby="deck-table-title">
        <div className="card-heading compact-heading"><div><p className="eyebrow">Decks</p><h2 id="deck-table-title">Workload and observed recall</h2></div></div>
        <div className="table-scroll"><table><thead><tr><th scope="col">Deck</th><th scope="col">Cards</th><th scope="col">New</th><th scope="col">Learning</th><th scope="col">Review</th><th scope="col">Due now</th><th scope="col">Suspended</th><th scope="col">Observed recall</th></tr></thead><tbody>{insights.deckRows.map((row) => <tr key={row.deck}><th scope="row">{row.deck}</th><td>{row.cards}</td><td>{row.newCards}</td><td>{row.learning}</td><td>{row.review}</td><td>{row.due}</td><td>{row.suspended}</td><td>{row.observedRecall == null ? '—' : `${row.observedRecall}% (n=${row.sample})`}</td></tr>)}</tbody></table></div>
        {insights.orphanReviews > 0 && <p className="inline-error" role="status">{insights.orphanReviews} review events in this window reference cards no longer present in the live collection.</p>}
      </section>
    </div>
  )
}
