import { describe, expect, it } from 'vitest'
import { hydrateFSRSCard, makeEmptyFSRSCard, previewReview, scheduleReview, serializeFSRSCard } from './fsrs'
import type { PracticeCard } from '../types'

describe('FSRS integration', () => {
  it('schedules a recalled card into the future', () => {
    const now = new Date('2026-07-16T10:00:00.000Z')
    const card: PracticeCard = {
      id: 'card',
      itemId: 'item',
      variant: 'forward',
      suspended: false,
      fsrs: makeEmptyFSRSCard(now),
      estimatedSeconds: 14,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }
    const result = scheduleReview(card, 3, 0.9, now)
    expect(result.card.reps).toBe(1)
    expect(result.card.due.getTime()).toBeGreaterThan(now.getTime())
  })
  it('hydrates serialized dates and previews all three UI outcomes', () => {
    const now = new Date('2026-07-16T10:00:00.000Z')
    const stored = makeEmptyFSRSCard(now)
    expect(serializeFSRSCard(hydrateFSRSCard(stored)).due).toBe(stored.due)
    const card: PracticeCard = { id: 'preview', itemId: 'item', variant: 'forward', suspended: false, fsrs: stored, estimatedSeconds: 14, createdAt: now.toISOString(), updatedAt: now.toISOString() }
    const preview = previewReview(card, 0.9, now)
    expect(Object.values(preview).every((date) => date instanceof Date)).toBe(true)
  })

  it('previews the exact intervals that custom scheduler settings will apply', () => {
    const now = new Date('2026-07-16T10:00:00.000Z')
    const options: NonNullable<PracticeCard['schedulerOptions']> = {
      desiredRetention: 0.93,
      maximumIntervalDays: 30,
      learningStepsMinutes: [5, 25],
      relearningStepsMinutes: [30],
      newCardsPerDay: 20,
      reviewsPerDay: 200,
      buryNewSiblings: true,
      buryReviewSiblings: true,
      leechThreshold: 8,
      leechAction: 'flag',
    }
    const card: PracticeCard = { id: 'custom-preview', itemId: 'item', variant: 'forward', suspended: false, fsrs: makeEmptyFSRSCard(now), schedulerOptions: options, estimatedSeconds: 14, createdAt: now.toISOString(), updatedAt: now.toISOString() }
    const preview = previewReview(card, options, now)

    expect(preview.forgot).toEqual(scheduleReview(card, 1, options, now).card.due)
    expect(preview.effort).toEqual(scheduleReview(card, 2, options, now).card.due)
    expect(preview.recalled).toEqual(scheduleReview(card, 3, options, now).card.due)
    expect(preview.easy).toEqual(scheduleReview(card, 4, options, now).card.due)
  })
})
