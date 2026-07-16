import { describe, expect, it } from 'vitest'
import { State } from 'ts-fsrs'
import { createSeedData } from '../data/seed'
import type { PracticeCard, ReviewEvent, UserSettings } from '../types'
import { makeEmptyFSRSCard } from './fsrs'
import { buildDailyPlan } from './planner'

const now = new Date('2026-07-16T10:00:00.000Z')
const settings = (dailyMinutes: number): UserSettings => ({
  dailyMinutes,
  retention: 0.9,
  theme: 'light',
  onboardingComplete: true,
  recoveryStrategy: 'risk',
})

const makeCard = (state: State, due: Date, id = crypto.randomUUID()): PracticeCard => {
  const fsrs = makeEmptyFSRSCard(now)
  fsrs.state = state
  fsrs.due = due.toISOString()
  fsrs.stability = state === State.New ? 0 : 3
  return { id, itemId: `item-${id}`, variant: 'forward', suspended: false, fsrs, estimatedSeconds: 14, createdAt: now.toISOString(), updatedAt: now.toISOString() }
}

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
})
