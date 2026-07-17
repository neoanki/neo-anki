import { describe, expect, it } from 'vitest'
import { State } from 'ts-fsrs'
import { createSeedData } from '../data/seed'
import type { KnowledgeItem, PracticeCard, ReviewEvent, UserSettings } from '../types'
import { makeEmptyFSRSCard } from './fsrs'
import { buildDailyPlan, buildStudySession } from './planner'
import { addDays, dayKey } from './date'

const now = new Date('2026-07-16T10:00:00.000Z')
const settings = (dailyMinutes: number): UserSettings => ({
  dailyMinutes,
  retention: 0.9,
  theme: 'light',
  onboardingComplete: true,
  recoveryStrategy: 'risk',
})

const makeCard = (state: State, due: Date, id: string = crypto.randomUUID()): PracticeCard => {
  const fsrs = makeEmptyFSRSCard(now)
  fsrs.state = state
  fsrs.due = due.toISOString()
  fsrs.stability = state === State.New ? 0 : 3
  return { id, itemId: `item-${id}`, variant: 'forward', suspended: false, fsrs, estimatedSeconds: 14, createdAt: now.toISOString(), updatedAt: now.toISOString() }
}

const makeItem = (card: PracticeCard, collection: string): KnowledgeItem => ({
  id: card.itemId,
  prompt: `${collection} prompt`,
  answer: `${collection} answer`,
  context: '',
  collection,
  tags: [],
  citations: [],
  mediaIds: [],
  occlusions: [],
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
})

describe('time-budget planner', () => {
  it('introduces more new material when the user offers more time', () => {
    const seeded = createSeedData()
    const fresh = Array.from({ length: 50 }, () => makeCard(State.New, now))
    const cards = [...seeded.cards, ...fresh]
    const tenMinutes = buildDailyPlan(cards, seeded.reviews, settings(10), now)
    const sixtyMinutes = buildDailyPlan(cards, seeded.reviews, settings(60), now)

    expect(sixtyMinutes.newPlanned).toBeGreaterThan(tenMinutes.newPlanned)
    expect(sixtyMinutes.queue.length).toBeGreaterThan(tenMinutes.queue.length)
  })

  it('pauses all new material when due reviews exceed the budget', () => {
    const overdue = Array.from({ length: 80 }, (_, index) => makeCard(State.Review, new Date(now.getTime() - (index + 1) * 86_400_000)))
    const fresh = Array.from({ length: 20 }, () => makeCard(State.New, now))
    const plan = buildDailyPlan([...overdue, ...fresh], [], settings(5), now)

    expect(plan.status).toBe('recovery')
    expect(plan.deferred).toBeGreaterThan(0)
    expect(plan.newPlanned).toBe(0)
  })

  it('learns review pace from recent events', () => {
    const card = makeCard(State.Review, now)
    const reviews: ReviewEvent[] = Array.from({ length: 10 }, (_, index) => ({
      id: `${index}`,
      cardId: card.id,
      rating: 3,
      reviewedAt: now.toISOString(),
      durationSeconds: 25,
      previousDue: now.toISOString(),
      nextDue: now.toISOString(),
    }))
    const plan = buildDailyPlan([card], reviews, settings(30), now)
    expect(plan.averageReviewSeconds).toBe(25)
  })

  it('never plans more work than the configured daily budget', () => {
    const cards = [
      ...Array.from({ length: 20 }, (_, index) => makeCard(State.Review, new Date(now.getTime() - index * 86_400_000))),
      ...Array.from({ length: 40 }, () => makeCard(State.New, now)),
    ]
    const plan = buildDailyPlan(cards, [], settings(20), now)
    expect(plan.reviewSeconds + plan.newSeconds).toBeLessThanOrEqual(plan.budgetSeconds)
  })

  it('subtracts practice already completed today so several sessions share one daily promise', () => {
    const cards = Array.from({ length: 30 }, (_, index) => makeCard(State.Review, new Date(now.getTime() - index * 86_400_000)))
    const reviews: ReviewEvent[] = [{
      id: 'earlier-session',
      cardId: 'finished-card',
      rating: 3,
      reviewedAt: now.toISOString(),
      durationSeconds: 180,
      previousDue: now.toISOString(),
      nextDue: now.toISOString(),
    }]
    const plan = buildDailyPlan(cards, reviews, settings(10), now)

    expect(plan.spentSeconds).toBe(180)
    expect(plan.remainingSeconds).toBe(420)
    expect(plan.reviewSeconds + plan.newSeconds).toBeLessThanOrEqual(420)
  })

  it('counts same-day events after a backward clock adjustment but not yesterday', () => {
    const localNow = new Date(2026, 6, 17, 10, 0)
    const card = makeCard(State.Review, localNow)
    const review = (id: string, reviewedAt: Date): ReviewEvent => ({ id, cardId: card.id, rating: 3, reviewedAt: reviewedAt.toISOString(), durationSeconds: 60, previousDue: localNow.toISOString(), nextDue: localNow.toISOString() })
    const plan = buildDailyPlan([card], [
      review('future-after-rollback', new Date(2026, 6, 17, 11, 0)),
      review('previous-day', new Date(2026, 6, 16, 23, 59)),
    ], settings(10), localNow)
    expect(plan.spentSeconds).toBe(60)
    expect(plan.remainingSeconds).toBe(540)
  })

  it('keeps seven distinct local forecast dates across DST', () => {
    const localNow = new Date(2026, 2, 7, 12, 0)
    const cards = Array.from({ length: 8 }, (_, index) => makeCard(State.Review, new Date(2026, 2, 7 + index, 10), `dst-${index}`))
    const forecast = buildDailyPlan(cards, [], settings(30), localNow).forecast
    expect(new Set(forecast.map((day) => day.date)).size).toBe(7)
    expect(forecast.map((day) => day.date)).toEqual(Array.from({ length: 7 }, (_, index) => dayKey(addDays(localNow, index))))
  })
})

describe('session composer', () => {
  it('keeps unrelated categories in coherent blocks instead of alternating every card', () => {
    const cards = Array.from({ length: 18 }, (_, index) => makeCard(State.Review, new Date(now.getTime() - index * 1_000), `card-${index}`))
    const items = cards.map((card, index) => makeItem(card, index % 2 === 0 ? 'Spanish' : 'Japanese'))
    const daily = buildDailyPlan(cards, [], settings(20), now, items)
    const session = buildStudySession(daily, items, { minutes: 10, intent: 'balanced' })

    expect(session.blocks.length).toBeGreaterThan(1)
    expect(session.blocks.every((block) => block.cards.every((entry) => entry.contextKey === block.contextKey))).toBe(true)
    expect(session.queue.some((entry, index) => index > 0 && entry.contextKey === session.queue[index - 1].contextKey)).toBe(true)
  })

  it('uses one context for a five-minute practice when that context has enough work', () => {
    const spanish = Array.from({ length: 30 }, (_, index) => makeCard(State.Review, new Date(now.getTime() - index * 1_000), `spanish-${index}`))
    const japanese = Array.from({ length: 10 }, (_, index) => makeCard(State.Review, new Date(now.getTime() - index * 1_000), `japanese-${index}`))
    const cards = [...spanish, ...japanese]
    const items = [...spanish.map((card) => makeItem(card, 'Spanish')), ...japanese.map((card) => makeItem(card, 'Japanese'))]
    const daily = buildDailyPlan(cards, [], settings(30), now, items)
    const session = buildStudySession(daily, items, { minutes: 5, intent: 'balanced' })

    expect(new Set(session.queue.map((entry) => entry.contextKey)).size).toBe(1)
  })

  it('supports a focused session without rescheduling other categories', () => {
    const cards = Array.from({ length: 16 }, (_, index) => makeCard(State.Review, new Date(now.getTime() - index * 1_000), `focus-${index}`))
    const items = cards.map((card, index) => makeItem(card, index % 2 === 0 ? 'Spanish' : 'Japanese'))
    const daily = buildDailyPlan(cards, [], settings(20), now, items)
    const session = buildStudySession(daily, items, { minutes: 10, intent: 'focus', focusCollection: 'Japanese' })

    expect(session.queue.length).toBeGreaterThan(0)
    expect(session.queue.every((entry) => entry.contextKey === 'Japanese')).toBe(true)
    expect(daily.queue.length).toBeGreaterThan(session.queue.length)
  })
})
