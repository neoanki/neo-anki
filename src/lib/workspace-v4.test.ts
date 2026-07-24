import { describe, expect, it } from 'vitest'
import { createSeedData } from '../data/seed'
import { appDataToWorkspaceDocumentV4, refreshWorkspaceDocumentV4FromProjection, workspaceDocumentV4ToAppData } from './workspace-v4'

describe('Workspace v4 production document adapter', () => {
  it('round-trips the complete Neo v3 projection without losing client or study fields', () => {
    const source = createSeedData()
    source.items[0].extensionData = { 'test.extension': { value: 1 } }
    source.cards[0].buriedUntil = '2026-07-19T00:00:00.000Z'
    const document = appDataToWorkspaceDocumentV4(source)
    expect(document.workspace.version).toBe(4)
    expect(document.workspace.notes).toHaveLength(source.items.length)
    expect(document.workspace.cards[0].buriedUntil).toBe('2026-07-19T00:00:00.000Z')
    const projected = workspaceDocumentV4ToAppData(document)
    expect(projected).toMatchObject({ deviceId: source.deviceId, settings: source.settings, goals: source.goals, views: source.views })
    expect(projected.items[0]).toMatchObject({ id: source.items[0].id, prompt: source.items[0].prompt, extensionData: source.items[0].extensionData })
    expect(projected.cards[0]).toMatchObject({ id: source.cards[0].id, buriedUntil: source.cards[0].buriedUntil })
  })

  it('updates named fields by stable field id without flattening the content model', () => {
    const document = appDataToWorkspaceDocumentV4(createSeedData())
    const projected = workspaceDocumentV4ToAppData(document)
    const item = projected.items[0]
    expect(item.contentModel?.fields.length).toBe(3)
    const target = item.contentModel!.fields[2]
    item.contentModel = { ...item.contentModel!, fields: item.contentModel!.fields.map((field) => field.id === target.id ? { ...field, value: 'Edited named context' } : field) }
    const refreshed = refreshWorkspaceDocumentV4FromProjection(projected, document)
    expect(refreshed.workspace.notes.find((note) => note.id === item.id)?.fields[target.id]).toBe('Edited named context')
    expect(workspaceDocumentV4ToAppData(refreshed).items.find((candidate) => candidate.id === item.id)?.contentModel?.fields.find((field) => field.id === target.id)?.value).toBe('Edited named context')
  })

  it('durably round-trips native rich semantics and does not churn unchanged revisions', () => {
    const source = createSeedData()
    const initial = appDataToWorkspaceDocumentV4(source)
    const item = {
      ...source.items[0],
      citations: [{ id: 'citation-1', title: 'Evidence', url: 'https://example.com' }],
      mediaIds: ['asset-1'],
      occlusions: [{ id: 'occ-1', x: 0.1, y: 0.2, width: 0.3, height: 0.4 }],
      source: 'Native source',
      updatedAt: '2026-07-19T10:00:00.000Z',
    }
    const card = { ...source.cards[0], variant: 'cloze', promptData: { clozeOrdinal: 2 }, occlusionId: 'occ-1', updatedAt: item.updatedAt }
    const asset = { id: 'asset-1', filename: 'diagram.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,AA==', byteLength: 1, hash: 'a'.repeat(64), altText: 'A labeled diagram', createdAt: item.updatedAt, updatedAt: item.updatedAt }
    const rich = { ...source, items: [item, ...source.items.slice(1)], cards: [card, ...source.cards.slice(1)], assets: [asset], updatedAt: item.updatedAt }
    const refreshed = refreshWorkspaceDocumentV4FromProjection(rich, initial)
    const projected = workspaceDocumentV4ToAppData(refreshed)
    expect(projected.items[0]).toMatchObject({ citations: item.citations, mediaIds: item.mediaIds, occlusions: item.occlusions, source: item.source })
    expect(projected.cards[0]).toMatchObject({ variant: 'cloze', promptData: { clozeOrdinal: 2 }, occlusionId: 'occ-1' })
    expect(projected.assets[0].altText).toBe('A labeled diagram')

    const unchanged = refreshWorkspaceDocumentV4FromProjection(projected, refreshed)
    expect(unchanged.workspace.revision).toBe(refreshed.workspace.revision)
    expect(unchanged.workspace.notes.map((value) => value.revision)).toEqual(refreshed.workspace.notes.map((value) => value.revision))
    expect(unchanged.workspace.cards.map((value) => value.revision)).toEqual(refreshed.workspace.cards.map((value) => value.revision))
  })

  it('preserves direct v4 preset edits until the corresponding global setting changes', () => {
    const document = appDataToWorkspaceDocumentV4(createSeedData())
    document.workspace.presets[0].desiredRetention = .95
    document.workspace.presets[0].learningStepsMinutes = [2, 12]
    const unchangedProjection = workspaceDocumentV4ToAppData(document)
    expect(unchangedProjection.settings.retention).toBe(.9)

    const preserved = refreshWorkspaceDocumentV4FromProjection(unchangedProjection, document)
    expect(preserved.workspace.presets[0]).toMatchObject({ desiredRetention: .95, learningStepsMinutes: [2, 12] })

    const changedProjection = { ...unchangedProjection, settings: { ...unchangedProjection.settings, retention: .92 }, updatedAt: '2026-07-19T11:00:00.000Z' }
    const propagated = refreshWorkspaceDocumentV4FromProjection(changedProjection, preserved)
    expect(propagated.workspace.presets[0]).toMatchObject({ desiredRetention: .92, learningStepsMinutes: [2, 12] })
  })

  it('keeps reviewed Trash entities hidden, valid, and restorable', () => {
    const source = createSeedData()
    const reviewedAt = '2026-07-19T12:00:00.000Z'
    source.reviews.push({ id: 'review-trash', cardId: source.cards[0].id, rating: 3, kind: 'review', reviewedAt, durationSeconds: 4, previousDue: source.cards[0].fsrs.due, nextDue: source.cards[0].fsrs.due })
    const initial = appDataToWorkspaceDocumentV4(source)
    const item = source.items[0]
    const cards = source.cards.filter((value) => value.itemId === item.id)
    const deleted = { ...source, items: source.items.filter((value) => value.id !== item.id), cards: source.cards.filter((value) => value.itemId !== item.id), trash: [{ id: item.id, item, cards, deletedAt: reviewedAt }], updatedAt: reviewedAt }
    const tombstoned = refreshWorkspaceDocumentV4FromProjection(deleted, initial)
    expect(tombstoned.workspace.reviews.find((value) => value.id === 'review-trash')?.cardId).toBe(source.cards[0].id)
    const hidden = workspaceDocumentV4ToAppData(tombstoned)
    expect(hidden.items.some((value) => value.id === item.id)).toBe(false)
    expect(hidden.reviews.some((value) => value.id === 'review-trash')).toBe(true)

    const restored = refreshWorkspaceDocumentV4FromProjection({ ...hidden, items: [item, ...hidden.items], cards: [...cards, ...hidden.cards], trash: [], updatedAt: '2026-07-19T12:01:00.000Z' }, tombstoned)
    expect(workspaceDocumentV4ToAppData(restored).items.some((value) => value.id === item.id)).toBe(true)
  })
})
