import { State } from 'ts-fsrs'
import type { DailyPlan, KnowledgeItem, PlannedCard, PracticeCard, RecoveryStrategy, ReviewEvent, SessionBlock, SessionRequest, StudySession, UserSettings } from '../types'
import { addDays, dayKey, endOfDay, startOfDay } from './date'

const DEFAULT_REVIEW_SECONDS = 14
const NEW_INTRODUCTION_SECONDS = 72
const UTILIZATION_TARGET = 0.88
const FUTURE_NEW_COST = [0, 34, 22, 15, 11, 8, 7]
const contextCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
export const compareStudyContexts = (left: string, right: string) => contextCollator.compare(left, right) || left.localeCompare(right)
const sourcePathFor = (card: PracticeCard, itemMap: Map<string, KnowledgeItem>) => card.deckName || itemMap.get(card.itemId)?.collection || ''
const compareCardsByCurriculum = (left: PracticeCard, right: PracticeCard, itemMap: Map<string, KnowledgeItem>) =>
  compareStudyContexts(sourcePathFor(left, itemMap), sourcePathFor(right, itemMap))
  || compareStudyContexts(itemMap.get(left.itemId)?.createdAt || left.createdAt, itemMap.get(right.itemId)?.createdAt || right.createdAt)
  || compareStudyContexts(left.createdAt, right.createdAt)
  || compareStudyContexts(left.id, right.id)

const best = <T,>(values: T[], limit: number, compare: (left: T, right: T) => number) => {
  if (values.length <= limit) return values.sort(compare)
  if (limit <= 0) return []
  const heap: T[] = []
  const worse = (left: T, right: T) => compare(left, right) > 0
  const bubbleUp = (index: number) => {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (!worse(heap[index], heap[parent])) break
      ;[heap[parent], heap[index]] = [heap[index], heap[parent]]
      index = parent
    }
  }
  const bubbleDown = (index: number) => {
    while (true) {
      const left = index * 2 + 1
      const right = left + 1
      let worst = index
      if (left < heap.length && worse(heap[left], heap[worst])) worst = left
      if (right < heap.length && worse(heap[right], heap[worst])) worst = right
      if (worst === index) break
      ;[heap[index], heap[worst]] = [heap[worst], heap[index]]
      index = worst
    }
  }
  for (const value of values) {
    if (heap.length < limit) {
      heap.push(value)
      bubbleUp(heap.length - 1)
    } else if (compare(value, heap[0]) < 0) {
      heap[0] = value
      bubbleDown(0)
    }
  }
  return heap.sort(compare)
}

export interface PlanningSignal { id: string; label: string; score: number }
export interface QueuePolicyCandidate { card: PracticeCard; overdueDays: number; extensionBoost: number }

export const averageReviewSeconds = (reviews: ReviewEvent[]) => {
  const recent = [...reviews].filter((review) => review.kind === 'review' || !review.kind).sort((left, right) => Date.parse(left.reviewedAt) - Date.parse(right.reviewedAt) || left.id.localeCompare(right.id)).slice(-100).filter((review) => review.durationSeconds >= 2 && review.durationSeconds <= 120)
  if (!recent.length) return DEFAULT_REVIEW_SECONDS
  const weighted = recent.reduce((sum, review, index) => sum + review.durationSeconds * (index + 1), 0)
  const weights = recent.reduce((sum, _, index) => sum + index + 1, 0)
  return clamp(weighted / weights, 7, 35)
}

export interface PlannerExtensionHooks {
  signalsFor?: (item: KnowledgeItem, now: Date) => PlanningSignal[]
  scoreQueuePolicy?: (strategy: RecoveryStrategy, candidate: QueuePolicyCandidate) => number | null
}

const priority = (card: PracticeCard, now: Date, strategy: RecoveryStrategy, extensionBoost: number, hooks: PlannerExtensionHooks = {}) => {
  const overdueDays = Math.max(0, (now.getTime() - new Date(card.fsrs.due).getTime()) / 86_400_000)
  const extensionScore = strategy === 'risk' ? null : hooks.scoreQueuePolicy?.(strategy, { card, overdueDays, extensionBoost })
  if (extensionScore != null) return extensionScore
  return overdueDays / Math.max(0.25, card.fsrs.stability) + card.fsrs.lapses * 0.16 + 1 / Math.max(1, card.fsrs.stability) + extensionBoost
}

export const buildDailyPlan = (
  cards: PracticeCard[],
  reviews: ReviewEvent[],
  settings: Pick<UserSettings, 'dailyMinutes' | 'recoveryStrategy'>,
  now = new Date(),
  items: KnowledgeItem[] = [],
  hooks: PlannerExtensionHooks = {},
): DailyPlan => {
  const budgetSeconds = settings.dailyMinutes * 60
  const todayStart = startOfDay(now).getTime()
  const todayEnd = endOfDay(now).getTime()
  const reviewsToday = reviews.filter((review) => {
    if (review.kind && review.kind !== 'review') return false
    const reviewedAt = Date.parse(review.reviewedAt)
    return reviewedAt >= todayStart && reviewedAt <= todayEnd
  })
  const spentSeconds = reviewsToday.reduce((sum, review) => sum + clamp(review.durationSeconds, 0, 120), 0)
  const remainingSeconds = Math.max(0, budgetSeconds - spentSeconds)
  const avgSeconds = averageReviewSeconds(reviews)
  const nowTime = now.getTime()
  const active = cards.filter((card) => !card.suspended && (!card.buriedUntil || Date.parse(card.buriedUntil) <= nowTime))
  const cardById = reviewsToday.length ? new Map(cards.map((card) => [card.id, card])) : null
  const studiedByPreset = new Map<string, { new: number; review: number }>()
  for (const review of reviewsToday) {
    const reviewedCard = cardById?.get(review.cardId)
    if (!reviewedCard?.presetId) continue
    const count = studiedByPreset.get(reviewedCard.presetId) || { new: 0, review: 0 }
    const queue = review.previousScheduling?.queue || reviewedCard.scheduling?.queue
    if (queue === 'new') count.new += 1
    else if (queue === 'review') count.review += 1
    studiedByPreset.set(reviewedCard.presetId, count)
  }
  const plannedByPreset = new Map<string, { new: number; review: number }>()
  const withinDailyLimit = (card: PracticeCard, kind: 'new' | 'review') => {
    if (!card.presetId || !card.schedulerOptions || card.scheduling?.queue === 'learn' || card.scheduling?.queue === 'relearn') return true
    const studied = studiedByPreset.get(card.presetId) || { new: 0, review: 0 }
    const planned = plannedByPreset.get(card.presetId) || { new: 0, review: 0 }
    const limit = kind === 'new' ? card.schedulerOptions.newCardsPerDay : card.schedulerOptions.reviewsPerDay
    if (studied[kind] + planned[kind] >= limit) return false
    planned[kind] += 1
    plannedByPreset.set(card.presetId, planned)
    return true
  }
  const signalSnapshot = new Map<string, PlanningSignal[]>()
  if (hooks.signalsFor) {
    for (const item of items) {
      const signals = hooks.signalsFor(item, now).filter((signal) => Boolean(signal.id?.trim()) && Boolean(signal.label?.trim()) && Number.isFinite(signal.score))
      if (signals.length) signalSnapshot.set(item.id, signals)
    }
  }
  const signalBoost = (itemId: string) => (signalSnapshot.get(itemId) || []).reduce((highest, signal) => Math.max(highest, signal.score), 0)
  const dueCandidates = active
    .filter((card) => card.fsrs.state !== State.New && Date.parse(card.fsrs.due) <= nowTime)
    .map((card, index) => ({ card, index, score: priority(card, now, settings.recoveryStrategy, signalBoost(card.itemId), hooks) }))
  const compareDue = (a: typeof dueCandidates[number], b: typeof dueCandidates[number]) => b.score - a.score || a.index - b.index
  const hasPresetLimits = active.some((card) => Boolean(card.presetId && card.schedulerOptions))
  const due = (hasPresetLimits
    ? dueCandidates.sort(compareDue)
    : best(dueCandidates, Math.floor(remainingSeconds / 7) + 1, compareDue))
    .map((entry) => entry.card)
    .filter((card) => withinDailyLimit(card, 'review'))
  let used = 0
  const plannedDue: PracticeCard[] = []
  for (const card of due) {
    const cost = clamp(card.estimatedSeconds || avgSeconds, 7, 45)
    if (used + cost > remainingSeconds) continue
    plannedDue.push(card)
    used += cost
  }

  const dayBoundaries = Array.from({ length: 8 }, (_, index) => addDays(startOfDay(now), index).getTime())
  const forecastCounts = Array.from({ length: 7 }, () => 0)
  for (const card of active) {
    if (card.fsrs.state === State.New) continue
    const dueAt = Date.parse(card.fsrs.due)
    if (dueAt < dayBoundaries[1]) { forecastCounts[0] += 1; continue }
    for (let index = 1; index < 7; index += 1) {
      if (dueAt >= dayBoundaries[index] && dueAt < dayBoundaries[index + 1]) { forecastCounts[index] += 1; break }
    }
  }
  const baseForecast = forecastCounts.map((count) => count * avgSeconds)

  const remainingToday = Math.max(0, remainingSeconds - used)
  let safeNew = Math.floor(remainingToday / NEW_INTRODUCTION_SECONDS)
  for (let day = 1; day < FUTURE_NEW_COST.length; day += 1) {
    const headroom = Math.max(0, budgetSeconds * UTILIZATION_TARGET - baseForecast[day])
    safeNew = Math.min(safeNew, Math.floor(headroom / FUTURE_NEW_COST[day]))
  }
  if (plannedDue.length < dueCandidates.length) safeNew = 0
  const freshCount = active.reduce((count, card) => count + (card.fsrs.state === State.New ? 1 : 0), 0)
  safeNew = clamp(safeNew, 0, freshCount)

  let plannedNew: PracticeCard[] = []
  if (safeNew > 0) {
    const itemMap = new Map(items.map((item) => [item.id, item]))
    const freshCandidates = active
      .filter((card) => card.fsrs.state === State.New)
      .map((card) => {
        const item = itemMap.get(card.itemId)
        return {
          card,
          urgency: signalBoost(card.itemId),
          dueAt: Date.parse(card.fsrs.due),
          source: sourcePathFor(card, itemMap),
          itemCreatedAt: item?.createdAt || card.createdAt,
        }
      })
    const compareFresh = (a: typeof freshCandidates[number], b: typeof freshCandidates[number]) => b.urgency - a.urgency
        || a.dueAt - b.dueAt
        || compareStudyContexts(a.source, b.source)
        || compareStudyContexts(a.itemCreatedAt, b.itemCreatedAt)
        || compareStudyContexts(a.card.createdAt, b.card.createdAt)
        || compareStudyContexts(a.card.id, b.card.id)
    plannedNew = (hasPresetLimits
      ? freshCandidates.sort(compareFresh)
      : best(freshCandidates, safeNew, compareFresh))
      .map((entry) => entry.card)
      .filter((card) => withinDailyLimit(card, 'new'))
      .slice(0, safeNew)
  }
  const newSeconds = plannedNew.length * NEW_INTRODUCTION_SECONDS
  used += newSeconds
  const toPlanned = (card: PracticeCard, reason: 'due' | 'new', estimatedSeconds: number) =>
    ({ card, reason, estimatedSeconds, signalIds: (signalSnapshot.get(card.itemId) || []).map((signal) => signal.id) })
  const queue = [
    ...plannedDue.map((card) => toPlanned(card, 'due', clamp(card.estimatedSeconds || avgSeconds, 7, 45))),
    ...plannedNew.map((card) => toPlanned(card, 'new', NEW_INTRODUCTION_SECONDS)),
  ]

  const signals = new Map<string, string>()
  signalSnapshot.forEach((itemSignals) => itemSignals.forEach((signal) => signals.set(signal.id, signal.label)))
  const signalBreakdown = [...signals].map(([signalId, name]) => ({ signalId, name, count: queue.filter((entry) => entry.signalIds.includes(signalId)).length })).filter((entry) => entry.count > 0)

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

  const deferred = dueCandidates.length - plannedDue.length
  const fill = (spentSeconds + used) / Math.max(1, budgetSeconds)
  return {
    budgetSeconds,
    spentSeconds,
    remainingSeconds,
    reviewSeconds: Math.round(used - newSeconds),
    newSeconds,
    bufferSeconds: Math.max(0, Math.round(remainingSeconds - used)),
    dueTotal: dueCandidates.length,
    duePlanned: plannedDue.length,
    newPlanned: plannedNew.length,
    deferred,
    averageReviewSeconds: avgSeconds,
    queue,
    forecast,
    signalBreakdown,
    status: deferred > 0 ? 'recovery' : fill > 0.82 ? 'full' : 'comfortable',
    recoveryStrategy: settings.recoveryStrategy,
  }
}

export const studySubjectForCollection = (collection: string) => collection.split('::', 1)[0]?.trim() || 'Unsorted'
const contextFor = (entry: PlannedCard, itemMap: Map<string, KnowledgeItem>) => studySubjectForCollection(itemMap.get(entry.card.itemId)?.collection || '')

const avoidAdjacentSiblings = (entries: PlannedCard[]) => {
  const remaining = [...entries]
  const ordered: PlannedCard[] = []
  while (remaining.length) {
    const previousItemId = ordered.at(-1)?.card.itemId
    const nextIndex = remaining.findIndex((entry) => entry.card.itemId !== previousItemId)
    ordered.push(remaining.splice(nextIndex < 0 ? 0 : nextIndex, 1)[0])
  }
  return ordered
}

export const buildStudySession = (
  plan: DailyPlan,
  items: KnowledgeItem[],
  request: SessionRequest,
): StudySession => {
  const itemMap = new Map(items.map((item) => [item.id, item]))
  const requestedSeconds = Math.max(60, Math.round(request.minutes * 60))
  const budgetSeconds = Math.min(requestedSeconds, plan.remainingSeconds)
  const eligible = plan.queue.filter((entry) => {
    const context = contextFor(entry, itemMap)
    if (request.intent === 'focus') return context === request.focusCollection
    if (request.intent === 'urgent') return entry.reason === 'due'
    return true
  })

  const grouped = new Map<string, PlannedCard[]>()
  eligible.forEach((entry) => {
    const context = contextFor(entry, itemMap)
    grouped.set(context, [...(grouped.get(context) || []), entry])
  })
  grouped.forEach((entries, context) => grouped.set(context, avoidAdjacentSiblings(entries.sort((left, right) => compareCardsByCurriculum(left.card, right.card, itemMap)))))

  const contexts = [...grouped.keys()].sort(compareStudyContexts)
  const selectedByContext = new Map(contexts.map((context) => [context, [] as PlannedCard[]]))
  let plannedSeconds = 0
  let cursor = 0

  while (contexts.some((context) => (grouped.get(context)?.length || 0) > 0) && plannedSeconds < budgetSeconds) {
    const context = contexts[cursor % Math.max(1, contexts.length)]
    cursor += 1
    const source = grouped.get(context)
    if (!source?.length) continue

    const nextIndex = source.findIndex((candidate) => plannedSeconds + candidate.estimatedSeconds <= budgetSeconds)
    if (nextIndex < 0) { source.length = 0; continue }
    const [next] = source.splice(nextIndex, 1)
    selectedByContext.get(context)!.push(next)
    plannedSeconds += next.estimatedSeconds
  }

  const activeContexts = contexts.filter((context) => (selectedByContext.get(context)?.length || 0) > 0)
  const blocks: SessionBlock[] = activeContexts.map((context, blockIndex) => {
    const selected = selectedByContext.get(context)!
    const blockId = `block-${blockIndex}-${context.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
    const cards = selected.map((entry) => ({ ...entry, blockId, blockIndex, contextKey: context }))
    return { id: blockId, contextKey: context, estimatedSeconds: cards.reduce((sum, entry) => sum + entry.estimatedSeconds, 0), cards }
  })
  const queue = blocks.flatMap((block) => block.cards)
  return {
    request,
    budgetSeconds,
    plannedSeconds,
    queue,
    blocks,
    omitted: Math.max(0, eligible.length - queue.length),
  }
}

export const buildCustomStudySession = (cards: PracticeCard[], items: KnowledgeItem[], reschedule: boolean): StudySession => {
  const queue = cards.filter((card) => !card.suspended).map((card): PlannedCard => ({
    card,
    reason: card.fsrs.state === State.New ? 'new' : 'due',
    estimatedSeconds: clamp(card.estimatedSeconds || 14, 7, 45),
    signalIds: [],
  }))
  const seconds = Math.max(60, queue.reduce((sum, entry) => sum + entry.estimatedSeconds, 0))
  const plan: DailyPlan = {
    budgetSeconds: seconds, spentSeconds: 0, remainingSeconds: seconds, reviewSeconds: seconds,
    newSeconds: 0, bufferSeconds: 0, dueTotal: queue.length, duePlanned: queue.length,
    newPlanned: queue.filter((entry) => entry.reason === 'new').length, deferred: 0,
    averageReviewSeconds: queue.length ? seconds / queue.length : 14, queue, forecast: [], signalBreakdown: [],
    status: 'comfortable', recoveryStrategy: 'protect-reviews',
  }
  return buildStudySession(plan, items, { minutes: Math.ceil(seconds / 60), intent: 'balanced', kind: 'custom', reschedule })
}
