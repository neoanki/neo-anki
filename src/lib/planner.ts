import { State } from 'ts-fsrs'
import type { DailyPlan, KnowledgeItem, LearningGoal, PracticeCard, RecoveryStrategy, ReviewEvent, UserSettings } from '../types'
import { addDays, dayKey, endOfDay, startOfDay } from './date'
import { goalUrgency, goalsForItem } from './views'

const DEFAULT_REVIEW_SECONDS = 14
const NEW_INTRODUCTION_SECONDS = 72
const UTILIZATION_TARGET = 0.88
const FUTURE_NEW_COST = [0, 34, 22, 15, 11, 8, 7]

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export const averageReviewSeconds = (reviews: ReviewEvent[]) => {
  const recent = reviews.slice(-100).filter((review) => review.durationSeconds >= 2 && review.durationSeconds <= 120)
  if (!recent.length) return DEFAULT_REVIEW_SECONDS
  const weighted = recent.reduce((sum, review, index) => sum + review.durationSeconds * (index + 1), 0)
  const weights = recent.reduce((sum, _, index) => sum + index + 1, 0)
  return clamp(weighted / weights, 7, 35)
}

const priority = (card: PracticeCard, now: Date, strategy: RecoveryStrategy, item?: KnowledgeItem, goals: LearningGoal[] = [], allCards: PracticeCard[] = []) => {
  const overdueDays = Math.max(0, (now.getTime() - new Date(card.fsrs.due).getTime()) / 86_400_000)
  const matchingGoals = item ? goalsForItem(item, allCards, goals, now) : []
  const goalBoost = matchingGoals.reduce((highest, goal) => Math.max(highest, goalUrgency(goal, now)), 0)
  if (strategy === 'oldest') return overdueDays * 2 + card.fsrs.lapses * 0.08 + goalBoost
  if (strategy === 'momentum') return 35 / Math.max(7, card.estimatedSeconds) + 1 / Math.max(1, card.fsrs.difficulty) + goalBoost
  return overdueDays / Math.max(0.25, card.fsrs.stability) + card.fsrs.lapses * 0.16 + 1 / Math.max(1, card.fsrs.stability) + goalBoost
}

export const buildDailyPlan = (
  cards: PracticeCard[],
  reviews: ReviewEvent[],
  settings: UserSettings,
  now = new Date(),
  items: KnowledgeItem[] = [],
  goals: LearningGoal[] = [],
): DailyPlan => {
  const budgetSeconds = settings.dailyMinutes * 60
  const avgSeconds = averageReviewSeconds(reviews)
  const active = cards.filter((card) => !card.suspended)
  const due = active
    .filter((card) => card.fsrs.state !== State.New && new Date(card.fsrs.due) <= endOfDay(now))
    .sort((a, b) => priority(b, now, settings.recoveryStrategy, items.find((item) => item.id === b.itemId), goals, cards) - priority(a, now, settings.recoveryStrategy, items.find((item) => item.id === a.itemId), goals, cards))
  const fresh = active
    .filter((card) => card.fsrs.state === State.New)
    .sort((a, b) => {
      const itemA = items.find((item) => item.id === a.itemId)
      const itemB = items.find((item) => item.id === b.itemId)
      const urgencyA = itemA ? goalsForItem(itemA, cards, goals, now).reduce((value, goal) => Math.max(value, goalUrgency(goal, now)), 0) : 0
      const urgencyB = itemB ? goalsForItem(itemB, cards, goals, now).reduce((value, goal) => Math.max(value, goalUrgency(goal, now)), 0) : 0
      return urgencyB - urgencyA || new Date(a.fsrs.due).getTime() - new Date(b.fsrs.due).getTime()
    })

  let used = 0
  const plannedDue: PracticeCard[] = []
  for (const card of due) {
    const cost = clamp(card.estimatedSeconds || avgSeconds, 7, 45)
    if (used + cost > budgetSeconds && plannedDue.length > 0) break
    plannedDue.push(card)
    used += cost
  }

  const baseForecast = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(startOfDay(now), index)
    const next = addDays(date, 1)
    const dueOnDay = active.filter((card) => {
      if (card.fsrs.state === State.New) return false
      const dueAt = new Date(card.fsrs.due)
      if (index === 0 && dueAt < next) return true
      return dueAt >= date && dueAt < next
    }).length
    return dueOnDay * avgSeconds
  })

  const remainingToday = Math.max(0, budgetSeconds - used)
  let safeNew = Math.floor(remainingToday / NEW_INTRODUCTION_SECONDS)
  for (let day = 1; day < FUTURE_NEW_COST.length; day += 1) {
    const headroom = Math.max(0, budgetSeconds * UTILIZATION_TARGET - baseForecast[day])
    safeNew = Math.min(safeNew, Math.floor(headroom / FUTURE_NEW_COST[day]))
  }
  if (plannedDue.length < due.length) safeNew = 0
  safeNew = clamp(safeNew, 0, fresh.length)

  const plannedNew = fresh.slice(0, safeNew)
  const newSeconds = plannedNew.length * NEW_INTRODUCTION_SECONDS
  used += newSeconds
  const toPlanned = (card: PracticeCard, reason: 'due' | 'new', estimatedSeconds: number) => {
    const item = items.find((candidate) => candidate.id === card.itemId)
    return { card, reason, estimatedSeconds, goalIds: item ? goalsForItem(item, cards, goals, now).map((goal) => goal.id) : [] }
  }
  const queue = [
    ...plannedDue.map((card) => toPlanned(card, 'due', clamp(card.estimatedSeconds || avgSeconds, 7, 45))),
    ...plannedNew.map((card) => toPlanned(card, 'new', NEW_INTRODUCTION_SECONDS)),
  ]

  const goalBreakdown = goals
    .filter((goal) => goal.active)
    .map((goal) => ({ goalId: goal.id, name: goal.name, count: queue.filter((entry) => entry.goalIds.includes(goal.id)).length }))
    .filter((entry) => entry.count > 0)

  const forecast = baseForecast.map((seconds, index) => {
    const date = addDays(now, index)
    const planned = seconds + plannedNew.length * FUTURE_NEW_COST[index]
    return {
      date: dayKey(date),
      label: index === 0 ? 'Today' : date.toLocaleDateString(undefined, { weekday: 'short' }),
      reviewMinutes: Math.round((seconds / 60) * 10) / 10,
      plannedMinutes: Math.round((planned / 60) * 10) / 10,
    }
  })

  const deferred = due.length - plannedDue.length
  const fill = used / Math.max(1, budgetSeconds)
  return {
    budgetSeconds,
    reviewSeconds: Math.round(used - newSeconds),
    newSeconds,
    bufferSeconds: Math.max(0, Math.round(budgetSeconds - used)),
    dueTotal: due.length,
    duePlanned: plannedDue.length,
    newPlanned: plannedNew.length,
    deferred,
    averageReviewSeconds: avgSeconds,
    queue,
    forecast,
    goalBreakdown,
    status: deferred > 0 ? 'recovery' : fill > 0.82 ? 'full' : 'comfortable',
    recoveryStrategy: settings.recoveryStrategy,
  }
}
