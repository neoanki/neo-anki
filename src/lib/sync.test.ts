import { describe, expect, it } from 'vitest'
import { createSeedData } from '../data/seed'
import { mergeAppData } from './sync'

describe('deterministic sync merge', () => {
  it('keeps newest mutable records and unions immutable reviews', () => {
    const local = createSeedData()
    const remote = structuredClone(local)
    remote.deviceId = 'remote'
    remote.items[0].answer = 'Remote newest answer'
    remote.items[0].updatedAt = '2099-01-01T00:00:00Z'
    remote.updatedAt = '2099-01-01T00:00:00Z'
    remote.reviews.push({ id: 'remote-review', cardId: remote.cards[0].id, rating: 3, reviewedAt: '2099-01-01T00:00:00Z', durationSeconds: 10, previousDue: '', nextDue: '' })
    const merged = mergeAppData(local, remote)
    expect(merged.deviceId).toBe(local.deviceId)
    expect(merged.items[0].answer).toBe('Remote newest answer')
    expect(merged.reviews.some((review) => review.id === 'remote-review')).toBe(true)
  })
})
