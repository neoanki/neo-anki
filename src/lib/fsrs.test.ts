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
})
