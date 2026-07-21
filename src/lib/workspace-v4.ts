import type { AppData, KnowledgeItem, MediaAsset, PracticeCard, ReviewEvent, StoredFSRSCard } from '../types.js'
import {
  createWorkspaceDocumentV4,
  migrateWorkspaceDocumentV3ToV4,
  parseWorkspaceDocumentV4,
  type SourceEnvelope,
  type WorkspaceDocumentV4,
} from '../../packages/compatibility-domain/src/index.js'
import { projectAnkiSchedulingToFsrs } from './scheduler-strategy.js'
import { renderWorkspaceCard } from './card-rendering.js'

const legacyFrom = <T>(envelope: SourceEnvelope | undefined): Partial<T> => {
  const value = envelope?.opaque?.legacy
  return value && typeof value === 'object' ? structuredClone(value) as Partial<T> : {}
}

export const appDataToWorkspaceDocumentV4 = (data: AppData): WorkspaceDocumentV4 => migrateWorkspaceDocumentV3ToV4(structuredClone(data) as unknown as Parameters<typeof migrateWorkspaceDocumentV3ToV4>[0])

const fallbackFsrs = (due: string): StoredFSRSCard => ({
  due, stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, reps: 0, lapses: 0, state: 0, learning_steps: 0,
})

/**
 * Compatibility adapter for the legacy UI projection. The durable authority is
 * the v4 graph; this projection is regenerated after each load/commit.
 */
export const workspaceDocumentV4ToAppData = (input: WorkspaceDocumentV4): AppData => {
  const document = parseWorkspaceDocumentV4(input)
  const { workspace, clientState } = document
  const envelopeById = new Map(workspace.sourceEnvelopes.map((value) => [value.id, value]))
  const noteTypeById = new Map(workspace.noteTypes.map((value) => [value.id, value]))
  const fieldById = new Map(workspace.fields.map((value) => [value.id, value]))
  const deckById = new Map(workspace.decks.map((value) => [value.id, value]))
  const templateById = new Map(workspace.templates.map((value) => [value.id, value]))
  const presetById = new Map(workspace.presets.map((value) => [value.id, value]))
  const noteById = new Map(workspace.notes.map((value) => [value.id, value]))
  const cardsByNote = new Map<string, WorkspaceDocumentV4['workspace']['cards']>()
  const reviewsByCard = new Map<string, WorkspaceDocumentV4['workspace']['reviews']>()
  const cardById = new Map(workspace.cards.map((value) => [value.id, value]))
  for (const card of workspace.cards) { const values = cardsByNote.get(card.noteId); if (values) values.push(card); else cardsByNote.set(card.noteId, [card]) }
  for (const review of workspace.reviews) { const values = reviewsByCard.get(review.cardId); if (values) values.push(review); else reviewsByCard.set(review.cardId, [review]) }
  const tombstonedNotes = new Set((clientState.tombstones || []).filter((value) => value.kind === 'note').map((value) => value.id))
  const tombstonedCards = new Set((clientState.tombstones || []).filter((value) => value.kind === 'card').map((value) => value.id))
  const extensionDataByNote = new Map<string, Record<string, unknown>>()
  for (const record of workspace.extensionRecords) if (record.targetKind === 'note') extensionDataByNote.set(record.targetId, { ...(extensionDataByNote.get(record.targetId) || {}), [record.extensionId]: structuredClone(record.value) })
  const mediaUrl = (asset: WorkspaceDocumentV4['workspace']['media'][number]) => {
    const legacy = legacyFrom<MediaAsset>(envelopeById.get(asset.sourceEnvelopeId || ''))
    return legacy.dataUrl || `neoanki-media://asset/${encodeURIComponent(asset.id)}?v=${asset.sha256.slice(0, 16)}`
  }

  const items = workspace.notes.filter((note) => !tombstonedNotes.has(note.id)).map((note): KnowledgeItem => {
    const legacy = legacyFrom<KnowledgeItem>(envelopeById.get(note.sourceEnvelopeId || ''))
    const noteType = noteTypeById.get(note.noteTypeId)
    const ordered = (noteType?.fieldIds || []).map((id) => note.fields[id] || '')
    const firstCard = cardsByNote.get(note.id)?.find((value) => !tombstonedCards.has(value.id))
    const collection = firstCard ? deckById.get(firstCard.deckId)?.name || 'Default' : 'Default'
    const item: KnowledgeItem = {
      id: note.id,
      prompt: ordered[0] || '',
      answer: ordered[1] || ordered[0] || '',
      context: ordered.slice(2).filter(Boolean).join('\n'),
      collection,
      tags: [...note.tags],
      citations: Array.isArray(legacy.citations) ? legacy.citations : [],
      mediaIds: Array.isArray(legacy.mediaIds) ? legacy.mediaIds : [],
      occlusions: Array.isArray(legacy.occlusions) ? legacy.occlusions : [],
      noteModel: noteType ? {
        noteTypeId: noteType.id,
        noteTypeName: noteType.name,
        fields: noteType.fieldIds.map((fieldId) => {
          const field = fieldById.get(fieldId)
          return { id: fieldId, name: field?.name || fieldId, ordinal: field?.ordinal || 0, value: note.fields[fieldId] || '' }
        }).sort((left, right) => left.ordinal - right.ordinal),
      } : undefined,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    }
    if (legacy.source) item.source = legacy.source
    if (legacy.provenance) item.provenance = legacy.provenance
    const extensionData = { ...(legacy.extensionData || {}), ...(extensionDataByNote.get(note.id) || {}) }
    if (Object.keys(extensionData).length) item.extensionData = extensionData
    return item
  })

  const cards = workspace.cards.filter((card) => !tombstonedCards.has(card.id) && !tombstonedNotes.has(card.noteId)).map((card): PracticeCard => {
    const legacy = legacyFrom<PracticeCard>(envelopeById.get(card.sourceEnvelopeId || ''))
    const scheduling = card.scheduling
    const due = scheduling.strategy === 'neo-fsrs' ? scheduling.dueAt : scheduling.dueAt || workspace.updatedAt
    const preset = presetById.get(card.presetId)
    const importedReviews = (reviewsByCard.get(card.id) || []).map((review): ReviewEvent => ({
      id: review.id, cardId: review.cardId, rating: review.rating, kind: review.kind,
      reversesReviewId: review.reversesReviewId, reviewedAt: review.reviewedAt,
      durationSeconds: review.durationMilliseconds / 1000,
      previousDue: review.reviewedAt, nextDue: review.reviewedAt, scheduler: review.scheduler,
    }))
    const fsrs = (scheduling.strategy === 'neo-fsrs' ? {
      due: scheduling.dueAt, stability: scheduling.stability, difficulty: scheduling.difficulty,
      elapsed_days: scheduling.elapsedDays, scheduled_days: scheduling.scheduledDays,
      reps: scheduling.reps, lapses: scheduling.lapses, state: scheduling.state,
      learning_steps: 0,
      last_review: scheduling.lastReviewAt,
    } : preset ? projectAnkiSchedulingToFsrs(scheduling, importedReviews, preset, workspace.updatedAt) : { ...fallbackFsrs(due), scheduled_days: Math.max(0, scheduling.intervalDays), reps: Math.max(0, scheduling.repetitions), lapses: Math.max(0, scheduling.lapses) }) as StoredFSRSCard
    const template = templateById.get(card.templateId)
    const note = noteById.get(card.noteId)
    const noteType = note ? noteTypeById.get(note.noteTypeId) : undefined
    const deck = deckById.get(card.deckId)
    const rendering = note && noteType && template ? renderWorkspaceCard(
      card,
      note,
      noteType,
      template,
      noteType.fieldIds.map((id) => ({ id, name: fieldById.get(id)?.name || id })),
      deck?.name || 'Default',
      workspace.media,
      mediaUrl,
    ) : undefined
    return {
      id: card.id, itemId: card.noteId,
      deckName: deck?.name || 'Default',
      presetId: card.presetId,
      schedulerOptions: preset ? { desiredRetention: preset.desiredRetention, maximumIntervalDays: preset.maximumIntervalDays, learningStepsMinutes: [...preset.learningStepsMinutes], relearningStepsMinutes: [...preset.relearningStepsMinutes], newCardsPerDay: preset.newCardsPerDay, reviewsPerDay: preset.reviewsPerDay, buryNewSiblings: preset.buryNewSiblings, buryReviewSiblings: preset.buryReviewSiblings, leechThreshold: preset.leechThreshold, leechAction: preset.leechAction } : undefined,
      variant: typeof legacy.variant === 'string' ? legacy.variant : noteTypeById.get(noteById.get(card.noteId)?.noteTypeId || '')?.kind === 'cloze' ? 'cloze' : /type:/i.test(template?.questionFormat || '') ? 'typed' : card.ordinal > 0 ? 'reverse' : 'forward',
      occlusionId: legacy.occlusionId,
      promptData: legacy.promptData,
      suspended: card.suspended,
      buriedUntil: card.buriedUntil,
      buriedBy: card.buriedBy,
      flags: card.flags,
      leech: card.leech ?? legacy.leech,
      fsrs,
      scheduling: structuredClone(scheduling),
      rendering,
      estimatedSeconds: typeof legacy.estimatedSeconds === 'number' ? legacy.estimatedSeconds : 14,
      createdAt: card.createdAt,
      updatedAt: card.updatedAt,
    }
  })

  const projectedCardById = new Map(cards.map((value) => [value.id, value]))
  const reviews = workspace.reviews.map((review): ReviewEvent => {
    const legacy = legacyFrom<ReviewEvent>(envelopeById.get(review.sourceEnvelopeId || ''))
    const projectedCard = projectedCardById.get(review.cardId)
    const storedCard = cardById.get(review.cardId)
    return {
      id: review.id, cardId: review.cardId, rating: review.rating, kind: review.kind,
      reversesReviewId: review.reversesReviewId, reviewedAt: review.reviewedAt,
      durationSeconds: review.durationMilliseconds / 1000,
      deviceId: legacy.deviceId,
      rawDurationSeconds: legacy.rawDurationSeconds,
      previousDue: legacy.previousDue || (storedCard?.scheduling.strategy === 'neo-fsrs' ? storedCard.scheduling.dueAt : storedCard?.scheduling.dueAt) || projectedCard?.fsrs.due || review.reviewedAt,
      nextDue: legacy.nextDue || (storedCard?.scheduling.strategy === 'neo-fsrs' ? storedCard.scheduling.dueAt : storedCard?.scheduling.dueAt) || projectedCard?.fsrs.due || review.reviewedAt,
      previousCard: legacy.previousCard,
      previousScheduling: review.previousScheduling || legacy.previousScheduling,
      scheduler: review.scheduler,
      previousEstimatedSeconds: review.previousEstimatedSeconds ?? legacy.previousEstimatedSeconds,
      previousCardState: review.previousCardState || legacy.previousCardState,
      siblingChanges: review.siblingChanges || legacy.siblingChanges,
    }
  })

  const assets = workspace.media.map((asset): MediaAsset => {
    const source = envelopeById.get(asset.sourceEnvelopeId || '')
    const legacy = legacyFrom<MediaAsset>(source)
    return { id: asset.id, filename: asset.filename, mimeType: asset.mimeType, dataUrl: mediaUrl(asset), byteLength: asset.byteLength, hash: asset.sha256, altText: legacy.altText || '', createdAt: asset.createdAt, updatedAt: asset.updatedAt }
  })

  const settings = clientState.settings as unknown as AppData['settings']
  return {
    version: 3,
    deviceId: workspace.deviceId,
    items, cards, reviews, assets,
    goals: structuredClone(clientState.goals) as AppData['goals'],
    views: structuredClone(clientState.views) as AppData['views'],
    packs: structuredClone(clientState.packs) as AppData['packs'],
    packConflicts: structuredClone(clientState.packConflicts) as AppData['packConflicts'],
    trash: structuredClone(clientState.trash) as AppData['trash'],
    settings,
    updatedAt: workspace.updatedAt,
  }
}

export const refreshWorkspaceDocumentV4FromProjection = (data: AppData, previous?: WorkspaceDocumentV4) => {
  if (!previous) return appDataToWorkspaceDocumentV4(data)
  const next = structuredClone(previous)
  const workspace = next.workspace
  const now = data.updatedAt
  const profile = workspace.profiles.find((value) => value.active) || workspace.profiles[0]
  if (!profile) return appDataToWorkspaceDocumentV4(data)
  let preset = workspace.presets.find((value) => value.profileId === profile.id)
  if (!preset) {
    preset = { id: `preset:neo:${crypto.randomUUID()}`, revision: 1, createdAt: now, updatedAt: now, profileId: profile.id, name: 'Neo defaults', scheduler: 'neo-fsrs', desiredRetention: data.settings.retention, maximumIntervalDays: 36500, learningStepsMinutes: [1, 10], relearningStepsMinutes: [10], newCardsPerDay: 20, reviewsPerDay: 200, buryNewSiblings: data.settings.burySiblings, buryReviewSiblings: data.settings.burySiblings, leechThreshold: data.settings.leechThreshold, leechAction: data.settings.leechAction }
    workspace.presets.push(preset)
  }
  let neoType = workspace.noteTypes.find((value) => value.profileId === profile.id && value.name === 'Neo Basic')
  if (!neoType) {
    const typeId = `note-type:neo:${crypto.randomUUID()}`
    const fieldIds = [`field:neo-front:${crypto.randomUUID()}`, `field:neo-back:${crypto.randomUUID()}`, `field:neo-context:${crypto.randomUUID()}`]
    const templateId = `template:neo-forward:${crypto.randomUUID()}`
    workspace.fields.push(
      { id: fieldIds[0], revision: 1, createdAt: now, updatedAt: now, noteTypeId: typeId, name: 'Front', ordinal: 0, rtl: false, sticky: false },
      { id: fieldIds[1], revision: 1, createdAt: now, updatedAt: now, noteTypeId: typeId, name: 'Back', ordinal: 1, rtl: false, sticky: false },
      { id: fieldIds[2], revision: 1, createdAt: now, updatedAt: now, noteTypeId: typeId, name: 'Context', ordinal: 2, rtl: false, sticky: false },
    )
    workspace.templates.push({ id: templateId, revision: 1, createdAt: now, updatedAt: now, noteTypeId: typeId, name: 'Forward', ordinal: 0, questionFormat: '{{Front}}', answerFormat: '{{FrontSide}}<hr>{{Back}}' })
    neoType = { id: typeId, revision: 1, createdAt: now, updatedAt: now, profileId: profile.id, name: 'Neo Basic', fieldIds, templateIds: [templateId], css: '.card { font-family: system-ui, sans-serif; }', kind: 'standard' }
    workspace.noteTypes.push(neoType)
  }
  const envelopeById = new Map(workspace.sourceEnvelopes.map((value) => [value.id, value]))
  const syncLegacy = (entity: { id: string; profileId?: string; sourceEnvelopeId?: string }, legacy: Record<string, unknown>) => {
    let envelope = entity.sourceEnvelopeId ? envelopeById.get(entity.sourceEnvelopeId) : undefined
    if (!envelope) {
      envelope = { id: `source:neo-v3:${entity.id}`, revision: 1, createdAt: now, updatedAt: now, profileId: entity.profileId || profile.id, format: 'neo-v3', sourceId: entity.id, schemaVersion: '3', opaque: { legacy: structuredClone(legacy) } }
      while (envelopeById.has(envelope.id)) envelope.id = `source:neo-v3:${entity.id}:${crypto.randomUUID()}`
      workspace.sourceEnvelopes.push(envelope)
      envelopeById.set(envelope.id, envelope)
      entity.sourceEnvelopeId = envelope.id
      return
    }
    const nextOpaque = { ...envelope.opaque, legacy: structuredClone(legacy) }
    if (JSON.stringify(nextOpaque) !== JSON.stringify(envelope.opaque)) {
      envelope.opaque = nextOpaque
      envelope.revision += 1
      envelope.updatedAt = now
    }
  }
  const mutate = <T extends { revision: number; updatedAt: string }>(entity: T, update: () => void, updatedAt: string) => {
    const revision = entity.revision
    const previousUpdatedAt = entity.updatedAt
    const before = JSON.stringify(entity)
    update()
    entity.revision = revision
    entity.updatedAt = previousUpdatedAt
    if (JSON.stringify(entity) !== before) {
      entity.revision = revision + 1
      entity.updatedAt = updatedAt
      return true
    }
    return false
  }
  const decksByProfileAndName = new Map(workspace.decks.map((value) => [`${value.profileId}\u0000${value.name}`, value]))
  const deckFor = (name: string, profileId = profile.id) => {
    const key = `${profileId}\u0000${name}`
    let deck = decksByProfileAndName.get(key)
    if (!deck) {
      const profilePreset = workspace.presets.find((value) => value.profileId === profileId) || preset!
      deck = { id: `deck:neo:${crypto.randomUUID()}`, revision: 1, createdAt: now, updatedAt: now, profileId, name, presetId: profilePreset.id }
      workspace.decks.push(deck)
      decksByProfileAndName.set(key, deck)
    }
    return deck
  }
  const itemsById = new Map(data.items.map((value) => [value.id, value]))
  const notesById = new Map(workspace.notes.map((value) => [value.id, value]))
  const cardsById = new Map(workspace.cards.map((value) => [value.id, value]))
  const mediaById = new Map(workspace.media.map((value) => [value.id, value]))
  const typeById = new Map(workspace.noteTypes.map((value) => [value.id, value]))
  const tombstones = new Map((next.clientState.tombstones || []).map((value) => [`${value.kind}:${value.id}`, value]))
  const trashDeletedAt = new Map<string, string>()
  for (const entry of data.trash) {
    trashDeletedAt.set(`note:${entry.item.id}`, entry.deletedAt)
    for (const card of entry.cards) trashDeletedAt.set(`card:${card.id}`, entry.deletedAt)
  }
  const sourceNoteIds = new Set(data.items.map((value) => value.id))
  for (const note of workspace.notes) {
    const key = `note:${note.id}`
    if (sourceNoteIds.has(note.id)) tombstones.delete(key)
    else tombstones.set(key, { kind: 'note', id: note.id, deletedAt: trashDeletedAt.get(key) || tombstones.get(key)?.deletedAt || now })
  }
  for (const item of data.items) {
    let note = notesById.get(item.id)
    const created = !note
    if (!note) {
      note = { id: item.id, revision: 1, createdAt: item.createdAt, updatedAt: item.updatedAt, profileId: profile.id, noteTypeId: neoType.id, fields: {}, tags: [], marked: false }
      workspace.notes.push(note)
      notesById.set(note.id, note)
    }
    const type = typeById.get(note.noteTypeId) || neoType
    const fields = type.fieldIds
    const updateNote = () => {
      if (item.noteModel?.noteTypeId === type.id) {
        const allowed = new Set(fields)
        note!.fields = Object.fromEntries(item.noteModel!.fields.filter((field) => allowed.has(field.id)).map((field) => [field.id, field.value]))
      } else {
        note!.fields = Object.fromEntries(fields.map((fieldId, index) => [fieldId, index === 0 ? item.prompt : index === 1 ? item.answer : index === 2 ? item.context : note!.fields[fieldId] || '']))
      }
      note!.tags = [...item.tags]
    }
    if (created) updateNote(); else mutate(note, updateNote, item.updatedAt)
    syncLegacy(note, { source: item.source, citations: item.citations, mediaIds: item.mediaIds, occlusions: item.occlusions, provenance: item.provenance, extensionData: item.extensionData })
  }
  const cardIds = new Set(data.cards.map((value) => value.id))
  for (const card of workspace.cards) {
    const key = `card:${card.id}`
    if (cardIds.has(card.id)) tombstones.delete(key)
    else tombstones.set(key, { kind: 'card', id: card.id, deletedAt: trashDeletedAt.get(key) || tombstones.get(key)?.deletedAt || now })
  }
  for (const card of data.cards) {
    const item = itemsById.get(card.itemId)
    if (!item) continue
    let entity = cardsById.get(card.id)
    const created = !entity
    if (!entity) {
      const template = workspace.templates.find((value) => value.noteTypeId === neoType!.id)!
      entity = { id: card.id, revision: 1, createdAt: card.createdAt, updatedAt: card.updatedAt, profileId: profile.id, noteId: item.id, templateId: template.id, deckId: deckFor(item.collection).id, presetId: preset.id, ordinal: template.ordinal, flags: card.flags || 0, suspended: card.suspended, scheduling: { strategy: 'neo-fsrs', queue: card.fsrs.reps ? 'review' : 'new', dueAt: card.fsrs.due, stability: card.fsrs.stability, difficulty: card.fsrs.difficulty, elapsedDays: card.fsrs.elapsed_days, scheduledDays: card.fsrs.scheduled_days, reps: card.fsrs.reps, lapses: card.fsrs.lapses, state: card.fsrs.state, lastReviewAt: card.fsrs.last_review } }
      workspace.cards.push(entity)
      cardsById.set(entity.id, entity)
    }
    const updateCard = () => {
      entity!.noteId = item.id
      const cardDeck = deckFor(card.deckName || item.collection, entity!.profileId)
      entity!.deckId = cardDeck.id
      entity!.presetId = cardDeck.presetId
      entity!.suspended = card.suspended
      entity!.buriedUntil = card.buriedUntil
      entity!.buriedBy = card.buriedBy
      entity!.flags = card.flags || 0
      entity!.leech = card.leech
      entity!.scheduling = card.scheduling?.strategy === 'anki'
        ? structuredClone(card.scheduling)
        : { strategy: 'neo-fsrs', queue: card.scheduling?.queue || (card.fsrs.reps ? 'review' : 'new'), dueAt: card.fsrs.due, stability: card.fsrs.stability, difficulty: card.fsrs.difficulty, elapsedDays: card.fsrs.elapsed_days, scheduledDays: card.fsrs.scheduled_days, reps: card.fsrs.reps, lapses: card.fsrs.lapses, state: card.fsrs.state, lastReviewAt: card.fsrs.last_review, continuityOverrideDueAt: card.scheduling?.strategy === 'neo-fsrs' ? card.scheduling.continuityOverrideDueAt : undefined }
    }
    if (created) updateCard(); else mutate(entity, updateCard, card.updatedAt)
    syncLegacy(entity, { variant: card.variant, occlusionId: card.occlusionId, promptData: card.promptData, estimatedSeconds: card.estimatedSeconds, leech: card.leech })
  }
  const existingReviews = new Set(workspace.reviews.map((value) => value.id))
  for (const review of data.reviews) if (!existingReviews.has(review.id)) {
    const currentCard = cardsById.get(review.cardId)
    const entity = { id: review.id, revision: 1, createdAt: review.reviewedAt, updatedAt: review.reviewedAt, profileId: profile.id, cardId: review.cardId, kind: review.kind || 'review' as const, rating: review.rating, reviewedAt: review.reviewedAt, durationMilliseconds: Math.max(0, Math.round(review.durationSeconds * 1000)), intervalBefore: review.previousCard?.scheduled_days || 0, intervalAfter: Math.max(0, Math.round((Date.parse(review.nextDue) - Date.parse(review.reviewedAt)) / 86_400_000)), scheduler: review.scheduler || 'neo-fsrs' as const, reversesReviewId: review.reversesReviewId, previousScheduling: review.previousScheduling ? structuredClone(review.previousScheduling) : undefined, nextScheduling: currentCard ? structuredClone(currentCard.scheduling) : undefined, previousEstimatedSeconds: review.previousEstimatedSeconds, previousCardState: review.previousCardState ? structuredClone(review.previousCardState) : undefined, siblingChanges: review.siblingChanges ? structuredClone(review.siblingChanges) : undefined, sourceEnvelopeId: undefined }
    workspace.reviews.push(entity)
    syncLegacy(entity, { deviceId: review.deviceId, rawDurationSeconds: review.rawDurationSeconds, previousDue: review.previousDue, nextDue: review.nextDue, previousCard: review.previousCard })
  }
  const mediaIds = new Set(data.assets.map((value) => value.id))
  workspace.media = workspace.media.filter((value) => mediaIds.has(value.id))
  for (const asset of data.assets) {
    let entity = mediaById.get(asset.id)
    if (entity) mutate(entity, () => { entity!.filename = asset.filename; entity!.mimeType = asset.mimeType; entity!.byteLength = asset.byteLength; entity!.sha256 = asset.hash; entity!.storageKey = asset.hash }, asset.updatedAt)
    else { entity = { id: asset.id, revision: 1, createdAt: asset.createdAt, updatedAt: asset.updatedAt, profileId: profile.id, filename: asset.filename, mimeType: asset.mimeType, byteLength: asset.byteLength, sha256: asset.hash, storageKey: asset.hash }; workspace.media.push(entity); mediaById.set(entity.id, entity) }
    syncLegacy(entity, { altText: asset.altText })
  }
  const previousSettings = previous.clientState.settings as Partial<AppData['settings']>
  const schedulingSettingsChanged = previousSettings.retention !== data.settings.retention
    || previousSettings.burySiblings !== data.settings.burySiblings
    || previousSettings.leechThreshold !== data.settings.leechThreshold
    || previousSettings.leechAction !== data.settings.leechAction
  const contentChanged = schedulingSettingsChanged && mutate(preset, () => {
    preset!.desiredRetention = data.settings.retention
    preset!.buryNewSiblings = data.settings.burySiblings
    preset!.buryReviewSiblings = data.settings.burySiblings
    preset!.leechThreshold = data.settings.leechThreshold
    preset!.leechAction = data.settings.leechAction
  }, now)
  // Preserve host-owned namespaced settings (for example synchronized SDK v2
  // extension configuration) while refreshing the public v3 projection fields.
  const clientState = { settings: { ...structuredClone(next.clientState.settings), ...structuredClone(data.settings) } as unknown as Record<string, unknown>, goals: structuredClone(data.goals), views: structuredClone(data.views), packs: structuredClone(data.packs), packConflicts: structuredClone(data.packConflicts), trash: structuredClone(data.trash), tombstones: [...tombstones.values()].sort((left, right) => `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`)) }
  const workspaceChanged = contentChanged || JSON.stringify(workspace) !== JSON.stringify(previous.workspace) || JSON.stringify(clientState) !== JSON.stringify(previous.clientState)
  if (workspaceChanged) { workspace.updatedAt = now; workspace.revision = previous.workspace.revision + 1 }
  next.clientState = clientState
  return createWorkspaceDocumentV4(workspace, next.clientState)
}
