import { validateWorkspaceV4Invariants } from './invariants.js'
import type { CardTemplate, Deck, Note, NoteType, SourceEnvelope, WorkspaceV4 } from './types.js'

interface LegacyFsrsCard {
  due: string; stability: number; difficulty: number; elapsed_days: number; scheduled_days: number; reps: number; lapses: number; state: number; learning_steps?: number; last_review?: string
}
interface LegacyItem {
  id: string; prompt: string; answer: string; context: string; collection: string; tags: string[]; extensionData?: Record<string, unknown>; citations?: unknown[]; mediaIds?: string[]; occlusions?: unknown[]; source?: string; provenance?: unknown; createdAt: string; updatedAt: string
}
interface LegacyCard {
  id: string; itemId: string; variant: string; suspended: boolean; buriedUntil?: string; buriedBy?: 'user' | 'scheduler'; flags?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7; leech?: boolean; occlusionId?: string; promptData?: Record<string, unknown>; estimatedSeconds?: number; fsrs: LegacyFsrsCard; createdAt: string; updatedAt: string
}
interface LegacyReview {
  id: string; cardId: string; rating: 1 | 2 | 3 | 4; kind?: 'review' | 'migration' | 'reversal'; reversesReviewId?: string; reviewedAt: string; durationSeconds: number; rawDurationSeconds?: number; previousDue?: string; nextDue?: string; previousCard?: unknown; previousEstimatedSeconds?: number; previousCardState?: unknown; siblingChanges?: unknown[]; createdAt?: string; updatedAt?: string
}
interface LegacyAsset { id: string; filename: string; mimeType: string; byteLength: number; hash: string; dataUrl?: string; altText?: string; createdAt: string; updatedAt: string }
export interface LegacyWorkspaceV3 {
  version: 3; deviceId: string; items: LegacyItem[]; cards: LegacyCard[]; reviews: LegacyReview[]; assets: LegacyAsset[]; settings: { retention: number; [key: string]: unknown }; goals?: unknown[]; views?: unknown[]; packs?: unknown[]; packConflicts?: unknown[]; trash?: unknown[]; updatedAt: string
}

const safeOpaque = (value: unknown) => {
  const encoded = new TextEncoder().encode(JSON.stringify(value))
  return encoded.byteLength <= 1024 * 1024 ? value as Record<string, unknown> : { omitted: true, reason: 'Legacy metadata exceeded 1 MiB.' }
}

/** Pure conversion used by the copy-on-write database migration. It never mutates v3 input. */
export const migrateWorkspaceV3ToV4 = (legacy: LegacyWorkspaceV3, workspaceId: string = crypto.randomUUID()): WorkspaceV4 => {
  const now = new Date().toISOString()
  const profileId = 'profile:neo-v3'
  const noteTypeId = 'note-type:neo-basic'
  const fieldIds = ['field:front', 'field:back', 'field:context']
  const templateKind = (variant: string) => variant === 'reverse' ? 'reverse' : variant === 'typed' ? 'typed' : 'forward'
  const templateKinds = [...new Set(['forward', ...legacy.cards.map((card) => templateKind(card.variant))])]
  const templates: CardTemplate[] = templateKinds.map((kind, ordinal) => ({
    id: `template:${kind}`, revision: 1, createdAt: now, updatedAt: now, noteTypeId,
    name: kind === 'forward' ? 'Recall' : kind === 'reverse' ? 'Reverse recall' : 'Type the answer',
    ordinal,
    promptFieldId: kind === 'reverse' ? fieldIds[1] : fieldIds[0],
    answerFieldId: kind === 'reverse' ? fieldIds[0] : fieldIds[1],
    supportingFieldIds: [fieldIds[2]],
    responseMode: kind === 'typed' ? 'type' : 'reveal',
  }))
  const noteType: NoteType = { id: noteTypeId, revision: 1, createdAt: now, updatedAt: now, profileId, name: 'Basic', fieldIds, templateIds: templates.map((value) => value.id), kind: 'standard' }
  const collectionNames = [...new Set(legacy.items.map((item) => item.collection || 'Default'))]
  const deckId = (name: string) => `deck:${encodeURIComponent(name)}`
  const decks: Deck[] = collectionNames.map((name) => ({ id: deckId(name), revision: 1, createdAt: now, updatedAt: now, profileId, name, presetId: 'preset:neo-v3' }))
  const envelopes: SourceEnvelope[] = legacy.items.map((item) => ({
    id: `source:v3:item:${item.id}`, revision: 1, createdAt: now, updatedAt: now, profileId, format: 'neo-v3', sourceId: item.id, schemaVersion: '3',
    opaque: safeOpaque({ extensionData: item.extensionData || {}, legacy: item }),
  }))
  envelopes.push(...legacy.cards.map((card) => ({ id: `source:v3:card:${card.id}`, revision: 1, createdAt: now, updatedAt: now, profileId, format: 'neo-v3' as const, sourceId: card.id, schemaVersion: '3', opaque: safeOpaque({ legacy: card }) })))
  envelopes.push(...legacy.reviews.map((review) => ({ id: `source:v3:review:${review.id}`, revision: 1, createdAt: now, updatedAt: now, profileId, format: 'neo-v3' as const, sourceId: review.id, schemaVersion: '3', opaque: safeOpaque({ legacy: review }) })))
  envelopes.push(...legacy.assets.map((asset) => ({ id: `source:v3:media:${asset.id}`, revision: 1, createdAt: now, updatedAt: now, profileId, format: 'neo-v3' as const, sourceId: asset.id, schemaVersion: '3', opaque: safeOpaque({ legacy: asset }) })))
  envelopes.push({ id: 'source:v3:workspace', revision: 1, createdAt: now, updatedAt: now, profileId, format: 'neo-v3', sourceId: 'workspace', schemaVersion: '3', opaque: safeOpaque({ settings: legacy.settings, goals: legacy.goals || [], views: legacy.views || [], packs: legacy.packs || [], packConflicts: legacy.packConflicts || [], trash: legacy.trash || [] }) })
  const notes: Note[] = legacy.items.map((item) => ({ id: item.id, revision: 1, createdAt: item.createdAt, updatedAt: item.updatedAt, profileId, noteTypeId, fields: { [fieldIds[0]]: item.prompt, [fieldIds[1]]: item.answer, [fieldIds[2]]: item.context }, tags: [...item.tags], marked: false, sourceEnvelopeId: `source:v3:item:${item.id}` }))
  const itemById = new Map(legacy.items.map((item) => [item.id, item]))
  return validateWorkspaceV4Invariants({
    version: 4, workspaceId, revision: 1, deviceId: legacy.deviceId, createdAt: now, updatedAt: legacy.updatedAt,
    profiles: [{ id: profileId, revision: 1, createdAt: now, updatedAt: now, name: 'Migrated Neo workspace', active: true }],
    noteTypes: [noteType],
    fields: [
      { id: fieldIds[0], revision: 1, createdAt: now, updatedAt: now, noteTypeId, name: 'Front', ordinal: 0, rtl: false, sticky: false },
      { id: fieldIds[1], revision: 1, createdAt: now, updatedAt: now, noteTypeId, name: 'Back', ordinal: 1, rtl: false, sticky: false },
      { id: fieldIds[2], revision: 1, createdAt: now, updatedAt: now, noteTypeId, name: 'Context', ordinal: 2, rtl: false, sticky: false },
    ], templates, decks,
    presets: [{ id: 'preset:neo-v3', revision: 1, createdAt: now, updatedAt: now, profileId, name: 'Migrated Neo defaults', desiredRetention: legacy.settings.retention, maximumIntervalDays: 36500, learningStepsMinutes: [1, 10], relearningStepsMinutes: [10], newCardsPerDay: 20, reviewsPerDay: 200, buryNewSiblings: true, buryReviewSiblings: true, leechThreshold: 8, leechAction: 'flag' }],
    notes,
    cards: legacy.cards.map((card) => {
      const source = itemById.get(card.itemId)
      if (!source) throw new Error(`Legacy card ${card.id} references missing item ${card.itemId}.`)
      const kind = templateKind(card.variant)
      return { id: card.id, revision: 1, createdAt: card.createdAt, updatedAt: card.updatedAt, profileId, noteId: card.itemId, templateId: `template:${kind}`, deckId: deckId(source.collection || 'Default'), presetId: 'preset:neo-v3', ordinal: Math.max(0, templateKinds.indexOf(kind)), flags: card.flags || 0, suspended: card.suspended, leech: card.leech, buriedUntil: card.buriedUntil, buriedBy: card.buriedUntil ? card.buriedBy || 'user' : undefined, scheduling: { strategy: 'neo-fsrs' as const, queue: card.fsrs.reps === 0 ? 'new' as const : 'review' as const, dueAt: card.fsrs.due, stability: card.fsrs.stability, difficulty: card.fsrs.difficulty, elapsedDays: card.fsrs.elapsed_days, scheduledDays: card.fsrs.scheduled_days, reps: card.fsrs.reps, lapses: card.fsrs.lapses, state: card.fsrs.state, lastReviewAt: card.fsrs.last_review }, sourceEnvelopeId: `source:v3:card:${card.id}` }
    }),
    reviews: legacy.reviews.map((review) => ({ id: review.id, revision: 1, createdAt: review.createdAt || review.reviewedAt, updatedAt: review.updatedAt || review.reviewedAt, profileId, cardId: review.cardId, kind: review.kind || 'review', rating: review.rating, reviewedAt: review.reviewedAt, durationMilliseconds: Math.max(0, review.durationSeconds * 1000), intervalBefore: 0, intervalAfter: 0, reversesReviewId: review.reversesReviewId, sourceEnvelopeId: `source:v3:review:${review.id}` })),
    media: legacy.assets.map((asset) => ({ id: asset.id, revision: 1, createdAt: asset.createdAt, updatedAt: asset.updatedAt, profileId, filename: asset.filename, mimeType: asset.mimeType, byteLength: asset.byteLength, sha256: asset.hash, storageKey: asset.hash, sourceEnvelopeId: `source:v3:media:${asset.id}` })),
    extensionRecords: [], sourceEnvelopes: envelopes,
  })
}
