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

  it('checks occlusions, cloze ordinals, FSRS bounds, reversals, and Trash ownership', () => {
    const occlusion = createSeedData(); occlusion.items[0].occlusions = [{ id: 'mask', x: .9, y: 0, width: .2, height: 0 }]
    expect(collectWorkspaceInvariantIssues(occlusion).map((issue) => issue.message).join(' ')).toMatch(/positive|bounds/)
    const cloze = createSeedData(); cloze.cards[0].variant = 'cloze'; cloze.cards[0].promptData = { clozeOrdinal: 0 }; cloze.cards[0].fsrs.stability = -1
    expect(collectWorkspaceInvariantIssues(cloze).map((issue) => issue.message).join(' ')).toMatch(/Cloze ordinals.*FSRS values/s)
    const reversal = createSeedData(); const timestamp = reversal.updatedAt
    reversal.reviews = [{ id: 'r', cardId: reversal.cards[0].id, rating: 3, kind: 'reversal', reviewedAt: timestamp, durationSeconds: 0, previousDue: timestamp, nextDue: timestamp, reversesReviewId: 'missing' }]
    expect(() => parseWorkspaceData(reversal)).toThrow(/Unknown review/)
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
})
