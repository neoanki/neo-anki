import { describe, expect, it } from 'vitest'
import { createSeedData } from '../data/seed'
import { collectWorkspaceInvariantIssues, migrateWorkspaceData, parseWorkspaceData, type LegacyWorkspaceData } from './workspace-schema'

describe('semantic workspace invariants', () => {
  it('accepts a valid workspace and rejects duplicate ids and broken content references', () => {
    const valid = createSeedData()
    expect(collectWorkspaceInvariantIssues(valid)).toEqual([])
    expect(parseWorkspaceData(valid).settings.burySiblings).toBe(true)

    const duplicate = structuredClone(valid); duplicate.cards.push(structuredClone(duplicate.cards[0]))
    expect(() => parseWorkspaceData(duplicate)).toThrow(/Duplicate id/)
    const missingItem = structuredClone(valid); missingItem.cards[0].itemId = 'missing'
    expect(() => parseWorkspaceData(missingItem)).toThrow(/Unknown knowledge item/)
    const missingMedia = structuredClone(valid); missingMedia.items[0].mediaIds = ['missing']
    expect(() => parseWorkspaceData(missingMedia)).toThrow(/Unknown media asset/)
  })

  it('checks occlusions, FSRS bounds, reversals, and Trash ownership', () => {
    const occlusion = createSeedData(); occlusion.items[0].occlusions = [{ id: 'mask', x: .9, y: 0, width: .2, height: 0 }]
    expect(collectWorkspaceInvariantIssues(occlusion).map((issue) => issue.message).join(' ')).toMatch(/positive|bounds/)
    const invalidFsrs = createSeedData(); invalidFsrs.cards[0].fsrs.stability = -1
    expect(collectWorkspaceInvariantIssues(invalidFsrs).map((issue) => issue.message).join(' ')).toMatch(/FSRS values/)
    const reversal = createSeedData(); const timestamp = reversal.updatedAt
    reversal.reviews = [{ id: 'r', cardId: reversal.cards[0].id, rating: 3, kind: 'reversal', reviewedAt: timestamp, durationSeconds: 0, previousDue: timestamp, nextDue: timestamp, reversesReviewId: 'missing' }]
    expect(() => parseWorkspaceData(reversal)).toThrow(/Unknown review/)
    const crossCard = createSeedData(); crossCard.cards.push({ ...crossCard.cards[0], id: 'other-card' }); crossCard.reviews = [
      { id: 'review', cardId: crossCard.cards[0].id, rating: 3, kind: 'review', reviewedAt: timestamp, durationSeconds: 1, previousDue: timestamp, nextDue: timestamp },
      { id: 'reversal', cardId: 'other-card', rating: 3, kind: 'reversal', reviewedAt: timestamp, durationSeconds: 0, previousDue: timestamp, nextDue: timestamp, reversesReviewId: 'review' },
    ]
    expect(() => parseWorkspaceData(crossCard)).toThrow(/same card/)
    const trash = createSeedData(); trash.trash = [{ id: trash.items[0].id, item: trash.items[0], cards: [{ ...trash.cards[0], itemId: 'other' }], deletedAt: timestamp }]
    expect(collectWorkspaceInvariantIssues(trash).map((issue) => issue.message).join(' ')).toMatch(/cannot also be live|must belong/)
  })

  it('normalizes legacy safeguard defaults and refuses future workspace versions', () => {
    const seed = createSeedData()
    const legacy = { ...seed, settings: { ...seed.settings, burySiblings: undefined, leechThreshold: undefined, leechAction: undefined } }
    expect(migrateWorkspaceData(legacy as unknown as LegacyWorkspaceData).settings).toMatchObject({ burySiblings: true, leechThreshold: 8, leechAction: 'flag' })
    expect(() => migrateWorkspaceData({ ...legacy, version: 99 } as unknown as LegacyWorkspaceData)).toThrow(/version 99/)
    expect(() => migrateWorkspaceData(null as never)).toThrow(/must be an object/)
  })

  it('preserves imported deck scheduling metadata across startup migration', () => {
    const seed = createSeedData()
    seed.cards[0].deckName = 'Japanese Grammar::00 - Foundation::01 · Recognition'
    seed.cards[0].presetId = 'anki:preset:1'
    seed.cards[0].schedulerOptions = {
      desiredRetention: .9, maximumIntervalDays: 36_500,
      learningStepsMinutes: [1, 10], relearningStepsMinutes: [10],
      newCardsPerDay: 20, reviewsPerDay: 200,
      buryNewSiblings: false, buryReviewSiblings: false,
      leechThreshold: 8, leechAction: 'flag',
    }
    const migrated = migrateWorkspaceData(seed)

    expect(migrated.cards[0]).toMatchObject({
      deckName: seed.cards[0].deckName,
      presetId: 'anki:preset:1',
      schedulerOptions: { newCardsPerDay: 20, reviewsPerDay: 200 },
    })
  })
})
