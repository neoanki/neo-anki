import { describe, expect, it } from 'vitest'
import { applyWorkspacePatchV2, migrateWorkspaceV3ToV4, parseWorkspaceDocumentV4, projectKnowledgeItems, validateWorkspaceV4Invariants } from '../../packages/compatibility-domain/src/index'
import type { WorkspaceV4 } from '../../packages/compatibility-domain/src/index'

const now = '2026-07-18T12:00:00.000Z'
const base = { revision: 1, createdAt: now, updatedAt: now }
const workspace = (): WorkspaceV4 => ({
  version: 4, workspaceId: 'workspace', revision: 1, deviceId: 'device', createdAt: now, updatedAt: now,
  profiles: [{ ...base, id: 'profile', name: 'My collection', active: true }],
  noteTypes: [{ ...base, id: 'type', profileId: 'profile', name: 'Basic', fieldIds: ['front', 'back'], templateIds: ['template'], kind: 'standard' }],
  fields: [
    { ...base, id: 'front', noteTypeId: 'type', name: 'Front', ordinal: 0, rtl: false, sticky: false },
    { ...base, id: 'back', noteTypeId: 'type', name: 'Back', ordinal: 1, rtl: false, sticky: false },
  ],
  templates: [{ ...base, id: 'template', noteTypeId: 'type', name: 'Card 1', ordinal: 0, promptFieldId: 'front', answerFieldId: 'back', supportingFieldIds: [], responseMode: 'reveal' }],
  presets: [{ ...base, id: 'preset', profileId: 'profile', name: 'Default', desiredRetention: .9, maximumIntervalDays: 36500, learningStepsMinutes: [1, 10], relearningStepsMinutes: [10], newCardsPerDay: 20, reviewsPerDay: 200, buryNewSiblings: true, buryReviewSiblings: true, leechThreshold: 8, leechAction: 'flag' }],
  decks: [{ ...base, id: 'deck', profileId: 'profile', name: 'Default', presetId: 'preset' }],
  notes: [{ ...base, id: 'note', profileId: 'profile', noteTypeId: 'type', fields: { front: 'Question', back: 'Answer' }, tags: ['tag'], marked: false }],
  cards: [{ ...base, id: 'card', profileId: 'profile', noteId: 'note', templateId: 'template', deckId: 'deck', presetId: 'preset', ordinal: 0, flags: 0, suspended: false, scheduling: { strategy: 'neo-fsrs', queue: 'new', dueAt: now, stability: 0, difficulty: 0, elapsedDays: 0, scheduledDays: 0, reps: 0, lapses: 0, state: 0 } }],
  reviews: [], media: [], extensionRecords: [], sourceEnvelopes: [],
})

describe('Workspace v4 compatibility domain', () => {
  it('validates references and derives a non-authoritative study projection', () => {
    const data = validateWorkspaceV4Invariants(workspace())
    expect(projectKnowledgeItems(data)).toEqual([expect.objectContaining({ prompt: 'Question', answer: 'Answer', deckName: 'Default' })])
    data.notes[0].noteTypeId = 'missing'
    expect(() => validateWorkspaceV4Invariants(data)).toThrow(/Missing note type/)
  })

  it('rejects an invalid patch atomically and protects append-only reviews', () => {
    const data = workspace()
    expect(() => applyWorkspacePatchV2(data, {
      version: 2, idempotencyKey: 'delete-note', expectedWorkspaceRevision: 1, owner: { type: 'core' },
      operations: [{ op: 'delete', kind: 'note', id: 'note', expectedRevision: 1 }],
    })).toThrow(/Missing note/)
    expect(data.notes).toHaveLength(1)

    data.reviews.push({ ...base, id: 'review', profileId: 'profile', cardId: 'card', kind: 'review', rating: 3, reviewedAt: now, durationMilliseconds: 1000, intervalBefore: 0, intervalAfter: 1 })
    expect(() => applyWorkspacePatchV2(data, {
      version: 2, idempotencyKey: 'delete-review', expectedWorkspaceRevision: 1, owner: { type: 'core' },
      operations: [{ op: 'delete', kind: 'review', id: 'review', expectedRevision: 1 }],
    })).toThrow(/append-only/)
  })

  it('rejects malformed reversal histories before they can corrupt undo state', () => {
    const review = { ...base, id: 'review', profileId: 'profile', cardId: 'card', kind: 'review' as const, rating: 3 as const, reviewedAt: now, durationMilliseconds: 1000, intervalBefore: 0, intervalAfter: 1 }

    const missingTarget = workspace()
    missingTarget.reviews = [{ ...review, id: 'reversal', kind: 'reversal', rating: 3 }]
    expect(() => validateWorkspaceV4Invariants(missingTarget)).toThrow(/must name the review/)

    const duplicate = workspace()
    duplicate.reviews = [
      review,
      { ...review, id: 'reversal-1', kind: 'reversal', rating: 3, reversesReviewId: review.id },
      { ...review, id: 'reversal-2', kind: 'reversal', rating: 3, reversesReviewId: review.id },
    ]
    expect(() => validateWorkspaceV4Invariants(duplicate)).toThrow(/only once/)

    const crossCard = workspace()
    crossCard.cards.push({ ...crossCard.cards[0], id: 'other-card' })
    crossCard.reviews = [review, { ...review, id: 'reversal', cardId: 'other-card', kind: 'reversal', rating: 3, reversesReviewId: review.id }]
    expect(() => validateWorkspaceV4Invariants(crossCard)).toThrow(/same card/)

    const reverseReversal = workspace()
    reverseReversal.reviews = [
      review,
      { ...review, id: 'reversal-1', kind: 'reversal', rating: 3, reversesReviewId: review.id },
      { ...review, id: 'reversal-2', kind: 'reversal', rating: 3, reversesReviewId: 'reversal-1' },
    ]
    expect(() => validateWorkspaceV4Invariants(reverseReversal)).toThrow(/cannot reverse another reversal/)
  })

  it('confines extension patches to owned content entities and their declared scope', () => {
    const data = workspace()
    const ownedNote = { ...data.notes[0], id: 'extension:org.example.cards:note-1', fields: { front: 'Owned', back: 'Card' } }
    const created = applyWorkspacePatchV2(data, {
      version: 2, idempotencyKey: 'create-owned-note', expectedWorkspaceRevision: 1,
      owner: { type: 'extension', extensionId: 'org.example.cards', scopes: ['content:patch-own'] },
      operations: [{ op: 'create', kind: 'note', id: ownedNote.id, value: ownedNote }],
    })
    expect(created.notes.some((note) => note.id === ownedNote.id)).toBe(true)
    expect(() => applyWorkspacePatchV2(data, {
      version: 2, idempotencyKey: 'modify-user-note', expectedWorkspaceRevision: 1,
      owner: { type: 'extension', extensionId: 'org.example.cards', scopes: ['content:patch-own'] },
      operations: [{ op: 'update', kind: 'note', id: 'note', expectedRevision: 1, value: { ...data.notes[0], revision: 2 } }],
    })).toThrow(/reserved namespace/)
    expect(() => applyWorkspacePatchV2(data, {
      version: 2, idempotencyKey: 'forge-review', expectedWorkspaceRevision: 1,
      owner: { type: 'extension', extensionId: 'org.example.cards', scopes: ['content:patch-own'] },
      operations: [{ op: 'create', kind: 'review', id: 'extension:org.example.cards:review', value: { ...base, id: 'extension:org.example.cards:review', profileId: 'profile', cardId: 'card', kind: 'review', rating: 3, reviewedAt: now, durationMilliseconds: 1, intervalBefore: 0, intervalAfter: 1 } }],
    })).toThrow(/cannot mutate review/)
  })

  it('converts a v3 workspace without mutating it and preserves scheduling continuity', () => {
    const legacy = {
      version: 3 as const, deviceId: 'device', updatedAt: now, settings: { retention: .91 },
      items: [{ id: 'item', prompt: 'P', answer: 'A', context: 'C', collection: 'Deck', tags: ['tag'], extensionData: { plugin: { safe: true } }, createdAt: now, updatedAt: now }],
      cards: [{ id: 'legacy-card', itemId: 'item', variant: 'forward', suspended: true, createdAt: now, updatedAt: now, fsrs: { due: '2026-08-01T12:00:00.000Z', stability: 12, difficulty: 4, elapsed_days: 3, scheduled_days: 12, reps: 8, lapses: 1, state: 2 } }],
      reviews: [], assets: [],
    }
    const snapshot = structuredClone(legacy)
    const migrated = migrateWorkspaceV3ToV4(legacy, 'workspace')
    expect(legacy).toEqual(snapshot)
    expect(migrated.cards[0]).toMatchObject({ suspended: true, scheduling: { dueAt: '2026-08-01T12:00:00.000Z', stability: 12 } })
    expect(migrated.sourceEnvelopes[0].opaque).toMatchObject({ extensionData: { plugin: { safe: true } }, legacy: { id: 'item', prompt: 'P' } })
  })

  it('materializes legacy template markup and scheduling only at the import boundary', () => {
    const legacy = workspace() as unknown as {
      noteTypes: Array<Record<string, unknown>>
      templates: Array<Record<string, unknown>>
      presets: Array<Record<string, unknown>>
      cards: Array<Record<string, unknown>>
      fields: Array<{ id: string }>
      notes: Array<{ fields: Record<string, string> }>
      [key: string]: unknown
    }
    legacy.noteTypes[0].kind = 'cloze'
    legacy.noteTypes[0].css = '.card { color: red; }'
    legacy.templates[0] = { ...legacy.templates[0], questionFormat: '{{Front}}', answerFormat: '{{FrontSide}}<hr>{{Back}}' }
    legacy.notes[0].fields[legacy.fields[0].id] = '&amp;lt;b&amp;gt;Prompt&amp;lt;/b&amp;gt;'
    delete legacy.templates[0].promptFieldId
    delete legacy.templates[0].answerFieldId
    delete legacy.templates[0].supportingFieldIds
    delete legacy.templates[0].responseMode
    legacy.presets[0].scheduler = 'anki'
    legacy.cards[0].clozeOrdinal = 1
    legacy.cards[0].scheduling = { strategy: 'anki', queue: 'review', due: 10, intervalDays: 4, easeFactor: 2500, repetitions: 3, lapses: 1, remainingSteps: 0, mod: 1_700_000_000 }

    const imported = parseWorkspaceDocumentV4({
      format: 'neo-anki-workspace',
      schemaVersion: 4,
      workspace: legacy,
      clientState: { settings: {}, goals: [], views: [], packs: [], packConflicts: [], trash: [] },
    })

    expect(imported.workspace.noteTypes[0]).toMatchObject({ kind: 'deletion' })
    expect(imported.workspace.noteTypes[0]).not.toHaveProperty('css')
    expect(imported.workspace.templates[0]).toMatchObject({ promptFieldId: expect.any(String), answerFieldId: expect.any(String), responseMode: 'reveal' })
    expect(imported.workspace.templates[0]).not.toHaveProperty('questionFormat')
    expect(imported.workspace.notes[0].fields[imported.workspace.templates[0].promptFieldId]).toBe('&lt;b&gt;Prompt&lt;/b&gt;')
    expect(imported.workspace.cards[0]).toMatchObject({ deletionOrdinal: 1, scheduling: { strategy: 'neo-fsrs', dueAt: now, scheduledDays: 4, reps: 3 } })
    expect(imported.workspace.presets[0]).not.toHaveProperty('scheduler')
  })
})
