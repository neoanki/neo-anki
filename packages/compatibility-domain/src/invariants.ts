import type { Card, ExtensionRecord, ReviewEvent, SchedulingState, SourceEnvelope, VersionedEntity, WorkspaceV4 } from './types.js'

export interface WorkspaceV4InvariantIssue { path: string; message: string }

const MAX_SOURCE_ENVELOPE_BYTES = 1024 * 1024
const MAX_SOURCE_ENVELOPES = 500_000
const MAX_TOTAL_SOURCE_ENVELOPE_BYTES = 128 * 1024 * 1024
const MAX_EXTENSION_RECORD_BYTES = 256 * 1024
const MAX_EXTENSION_RECORDS = 500_000

const iso = (value: string) => Number.isFinite(Date.parse(value))
const unique = <T extends VersionedEntity>(label: string, values: T[], issues: WorkspaceV4InvariantIssue[]) => {
  const seen = new Set<string>()
  values.forEach((value, index) => {
    if (seen.has(value.id)) issues.push({ path: `${label}[${index}].id`, message: `Duplicate ${label} id ${value.id}.` })
    seen.add(value.id)
    if (!Number.isInteger(value.revision) || value.revision < 1) issues.push({ path: `${label}[${index}].revision`, message: 'Entity revisions must be positive integers.' })
    if (!iso(value.createdAt) || !iso(value.updatedAt)) issues.push({ path: `${label}[${index}]`, message: 'Entity timestamps must be valid ISO timestamps.' })
  })
  return seen
}

const requireRef = (ids: Set<string>, id: string | undefined, path: string, label: string, issues: WorkspaceV4InvariantIssue[]) => {
  if (id && !ids.has(id)) issues.push({ path, message: `Missing ${label} ${id}.` })
}

const validateSchedulingState = (scheduling: SchedulingState, path: string, issues: WorkspaceV4InvariantIssue[]) => {
  if (!iso(scheduling.dueAt) || (scheduling.lastReviewAt && !iso(scheduling.lastReviewAt))) issues.push({ path, message: 'FSRS scheduling timestamps are invalid.' })
  if (![scheduling.stability, scheduling.difficulty, scheduling.elapsedDays, scheduling.scheduledDays, scheduling.reps, scheduling.lapses].every((value) => Number.isFinite(value) && value >= 0)) issues.push({ path, message: 'FSRS values must be finite and non-negative.' })
  if (scheduling.difficulty > 10) issues.push({ path: `${path}.difficulty`, message: 'FSRS difficulty must not exceed 10.' })
}

const validateScheduling = (card: Card, index: number, issues: WorkspaceV4InvariantIssue[]) => {
  validateSchedulingState(card.scheduling, `cards[${index}].scheduling`, issues)
  if (!Number.isInteger(card.flags) || card.flags < 0 || card.flags > 7) issues.push({ path: `cards[${index}].flags`, message: 'Card flag must be an integer from 0 through 7.' })
  if (card.buriedUntil && !iso(card.buriedUntil)) issues.push({ path: `cards[${index}].buriedUntil`, message: 'Card bury timestamp is invalid.' })
  if (card.buriedBy && !card.buriedUntil) issues.push({ path: `cards[${index}].buriedBy`, message: 'A bury source requires a bury timestamp.' })
}

const validateReview = (review: ReviewEvent, index: number, reviewsById: Map<string, ReviewEvent>, reversedReviewIds: Set<string>, cardIds: Set<string>, issues: WorkspaceV4InvariantIssue[]) => {
  if (!iso(review.reviewedAt)) issues.push({ path: `reviews[${index}].reviewedAt`, message: 'Review timestamp is invalid.' })
  if (!Number.isFinite(review.durationMilliseconds) || review.durationMilliseconds < 0) issues.push({ path: `reviews[${index}].durationMilliseconds`, message: 'Review duration must be finite and non-negative.' })
  if (review.kind === 'reversal') {
    const path = `reviews[${index}].reversesReviewId`
    if (!review.reversesReviewId) issues.push({ path, message: 'A reversal must name the review it reverses.' })
    else {
      const target = reviewsById.get(review.reversesReviewId)
      if (!target) issues.push({ path, message: `Missing review event ${review.reversesReviewId}.` })
      else {
        if (target.kind === 'reversal') issues.push({ path, message: 'A reversal cannot reverse another reversal.' })
        if (target.cardId !== review.cardId) issues.push({ path, message: 'A reversal must reference a review for the same card.' })
      }
      if (reversedReviewIds.has(review.reversesReviewId)) issues.push({ path, message: 'A review can be reversed only once.' })
      reversedReviewIds.add(review.reversesReviewId)
    }
  }
  if (review.kind !== 'reversal' && review.reversesReviewId) issues.push({ path: `reviews[${index}].reversesReviewId`, message: 'Only reversal events may point to a reversed review.' })
  if (review.previousEstimatedSeconds !== undefined && (!Number.isFinite(review.previousEstimatedSeconds) || review.previousEstimatedSeconds < 0)) issues.push({ path: `reviews[${index}].previousEstimatedSeconds`, message: 'Previous estimate must be finite and non-negative.' })
  if (review.previousCardState?.buriedUntil && !iso(review.previousCardState.buriedUntil)) issues.push({ path: `reviews[${index}].previousCardState.buriedUntil`, message: 'Previous bury timestamp is invalid.' })
  review.siblingChanges?.forEach((change, siblingIndex) => {
    requireRef(cardIds, change.cardId, `reviews[${index}].siblingChanges[${siblingIndex}].cardId`, 'sibling card', issues)
    if (change.previousBuriedUntil && !iso(change.previousBuriedUntil)) issues.push({ path: `reviews[${index}].siblingChanges[${siblingIndex}].previousBuriedUntil`, message: 'Previous sibling bury timestamp is invalid.' })
  })
  if (review.previousScheduling) validateSchedulingState(review.previousScheduling, `reviews[${index}].previousScheduling`, issues)
  if (review.nextScheduling) validateSchedulingState(review.nextScheduling, `reviews[${index}].nextScheduling`, issues)
}

const validateEnvelope = (envelope: SourceEnvelope, index: number, issues: WorkspaceV4InvariantIssue[]) => {
  let bytes = Number.POSITIVE_INFINITY
  try { bytes = new TextEncoder().encode(JSON.stringify(envelope.opaque)).byteLength } catch { /* reported below */ }
  if (bytes > MAX_SOURCE_ENVELOPE_BYTES) issues.push({ path: `sourceEnvelopes[${index}].opaque`, message: 'Opaque source metadata exceeds 1 MiB or is not serializable.' })
  if (['__proto__', 'prototype', 'constructor'].some((key) => Object.prototype.hasOwnProperty.call(envelope.opaque, key))) issues.push({ path: `sourceEnvelopes[${index}].opaque`, message: 'Unsafe opaque metadata key.' })
}

const validateExtensionRecord = (record: ExtensionRecord, index: number, noteIds: Set<string>, cardIds: Set<string>, mediaIds: Set<string>, issues: WorkspaceV4InvariantIssue[]) => {
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(record.extensionId)) issues.push({ path: `extensionRecords[${index}].extensionId`, message: 'Extension id must use reverse-domain notation.' })
  const targets = record.targetKind === 'note' ? noteIds : record.targetKind === 'card' ? cardIds : mediaIds
  requireRef(targets, record.targetId, `extensionRecords[${index}].targetId`, record.targetKind, issues)
  let bytes = Number.POSITIVE_INFINITY
  try { bytes = new TextEncoder().encode(JSON.stringify(record.value)).byteLength } catch { /* invalid */ }
  if (bytes > MAX_EXTENSION_RECORD_BYTES) issues.push({ path: `extensionRecords[${index}].value`, message: 'Extension record exceeds 256 KiB or is not serializable.' })
}

export const collectWorkspaceV4InvariantIssues = (workspace: WorkspaceV4): WorkspaceV4InvariantIssue[] => {
  const issues: WorkspaceV4InvariantIssue[] = []
  const collectionNames = ['profiles', 'noteTypes', 'fields', 'templates', 'decks', 'presets', 'notes', 'cards', 'reviews', 'media', 'extensionRecords', 'sourceEnvelopes'] as const
  if (!workspace || typeof workspace !== 'object') return [{ path: 'workspace', message: 'Workspace must be an object.' }]
  const malformedCollection = collectionNames.find((name) => !Array.isArray(workspace[name]))
  if (malformedCollection) return [{ path: malformedCollection, message: `${malformedCollection} must be an array.` }]
  for (const name of collectionNames) {
    const malformedIndex = workspace[name].findIndex((value) => !value || typeof value !== 'object' || typeof (value as { id?: unknown }).id !== 'string')
    if (malformedIndex >= 0) return [{ path: `${name}[${malformedIndex}]`, message: 'Entity must be an object with a string id.' }]
  }
  if (workspace.version !== 4) issues.push({ path: 'version', message: 'Workspace version must be 4.' })
  if (!Number.isInteger(workspace.revision) || workspace.revision < 1) issues.push({ path: 'revision', message: 'Workspace revision must be a positive integer.' })
  if (workspace.sourceEnvelopes.length > MAX_SOURCE_ENVELOPES) issues.push({ path: 'sourceEnvelopes', message: `No more than ${MAX_SOURCE_ENVELOPES} source envelopes are allowed.` })
  let totalEnvelopeBytes = 0
  for (const envelope of workspace.sourceEnvelopes) {
    try { totalEnvelopeBytes += new TextEncoder().encode(JSON.stringify(envelope.opaque)).byteLength } catch { totalEnvelopeBytes = Number.POSITIVE_INFINITY; break }
  }
  if (totalEnvelopeBytes > MAX_TOTAL_SOURCE_ENVELOPE_BYTES) issues.push({ path: 'sourceEnvelopes', message: 'Combined opaque source metadata exceeds 128 MiB or is not serializable.' })
  if (workspace.extensionRecords.length > MAX_EXTENSION_RECORDS) issues.push({ path: 'extensionRecords', message: `No more than ${MAX_EXTENSION_RECORDS} extension records are allowed.` })
  const profileIds = unique('profiles', workspace.profiles, issues)
  const noteTypeIds = unique('noteTypes', workspace.noteTypes, issues)
  const fieldIds = unique('fields', workspace.fields, issues)
  const templateIds = unique('templates', workspace.templates, issues)
  const deckIds = unique('decks', workspace.decks, issues)
  const presetIds = unique('presets', workspace.presets, issues)
  const noteIds = unique('notes', workspace.notes, issues)
  const cardIds = unique('cards', workspace.cards, issues)
  unique('reviews', workspace.reviews, issues)
  const mediaIds = unique('media', workspace.media, issues)
  unique('extensionRecords', workspace.extensionRecords, issues)
  const envelopeIds = unique('sourceEnvelopes', workspace.sourceEnvelopes, issues)
  const envelope = (value: { sourceEnvelopeId?: string }, path: string) => requireRef(envelopeIds, value.sourceEnvelopeId, path, 'source envelope', issues)
  const fieldsByNoteType = new Map<string, typeof workspace.fields>()
  const templatesByNoteType = new Map<string, typeof workspace.templates>()
  for (const field of workspace.fields) { const values = fieldsByNoteType.get(field.noteTypeId); if (values) values.push(field); else fieldsByNoteType.set(field.noteTypeId, [field]) }
  for (const template of workspace.templates) { const values = templatesByNoteType.get(template.noteTypeId); if (values) values.push(template); else templatesByNoteType.set(template.noteTypeId, [template]) }
  const noteById = new Map(workspace.notes.map((value) => [value.id, value]))
  const deckById = new Map(workspace.decks.map((value) => [value.id, value]))
  const presetById = new Map(workspace.presets.map((value) => [value.id, value]))
  const templateById = new Map(workspace.templates.map((value) => [value.id, value]))
  const reviewsById = new Map(workspace.reviews.map((value) => [value.id, value]))
  const reversedReviewIds = new Set<string>()

  workspace.noteTypes.forEach((value, index) => {
    requireRef(profileIds, value.profileId, `noteTypes[${index}].profileId`, 'profile', issues)
    value.fieldIds.forEach((id, ordinal) => requireRef(fieldIds, id, `noteTypes[${index}].fieldIds[${ordinal}]`, 'field', issues))
    value.templateIds.forEach((id, ordinal) => requireRef(templateIds, id, `noteTypes[${index}].templateIds[${ordinal}]`, 'template', issues))
    if (new Set(value.fieldIds).size !== value.fieldIds.length) issues.push({ path: `noteTypes[${index}].fieldIds`, message: 'Note type field ids must be unique.' })
    if (new Set(value.templateIds).size !== value.templateIds.length) issues.push({ path: `noteTypes[${index}].templateIds`, message: 'Note type template ids must be unique.' })
    const ownedFields = fieldsByNoteType.get(value.id) || []
    const ownedTemplates = templatesByNoteType.get(value.id) || []
    if (ownedFields.some((field) => !value.fieldIds.includes(field.id)) || value.fieldIds.some((id) => !ownedFields.some((field) => field.id === id))) issues.push({ path: `noteTypes[${index}].fieldIds`, message: 'Note type and field ownership must be reciprocal.' })
    if (ownedTemplates.some((template) => !value.templateIds.includes(template.id)) || value.templateIds.some((id) => !ownedTemplates.some((template) => template.id === id))) issues.push({ path: `noteTypes[${index}].templateIds`, message: 'Note type and template ownership must be reciprocal.' })
    if (new Set(ownedFields.map((field) => field.ordinal)).size !== ownedFields.length) issues.push({ path: `noteTypes[${index}].fieldIds`, message: 'Field ordinals must be unique within a note type.' })
    if (new Set(ownedTemplates.map((template) => template.ordinal)).size !== ownedTemplates.length) issues.push({ path: `noteTypes[${index}].templateIds`, message: 'Template ordinals must be unique within a note type.' })
    if (!value.name.trim()) issues.push({ path: `noteTypes[${index}].name`, message: 'Content type name is required.' })
    envelope(value, `noteTypes[${index}].sourceEnvelopeId`)
  })
  workspace.fields.forEach((value, index) => {
    requireRef(noteTypeIds, value.noteTypeId, `fields[${index}].noteTypeId`, 'note type', issues)
    if (!value.name.trim()) issues.push({ path: `fields[${index}].name`, message: 'Field name is required.' })
  })
  workspace.templates.forEach((value, index) => {
    requireRef(noteTypeIds, value.noteTypeId, `templates[${index}].noteTypeId`, 'note type', issues)
    requireRef(fieldIds, value.promptFieldId, `templates[${index}].promptFieldId`, 'prompt field', issues)
    requireRef(fieldIds, value.answerFieldId, `templates[${index}].answerFieldId`, 'answer field', issues)
    value.supportingFieldIds.forEach((id, fieldIndex) => requireRef(fieldIds, id, `templates[${index}].supportingFieldIds[${fieldIndex}]`, 'supporting field', issues))
    if (new Set(value.supportingFieldIds).size !== value.supportingFieldIds.length || value.supportingFieldIds.some((id) => id === value.promptFieldId || id === value.answerFieldId)) issues.push({ path: `templates[${index}]`, message: 'Supporting template fields must be unique.' })
    const ownedFieldIds = new Set((fieldsByNoteType.get(value.noteTypeId) || []).map((field) => field.id))
    if (![value.promptFieldId, value.answerFieldId, ...value.supportingFieldIds].every((id) => ownedFieldIds.has(id))) issues.push({ path: `templates[${index}]`, message: 'Every template field must belong to its content type.' })
    if (value.promptFieldId === value.answerFieldId) issues.push({ path: `templates[${index}]`, message: 'Prompt and answer must use different fields.' })
    if (!value.name.trim()) issues.push({ path: `templates[${index}].name`, message: 'Template name is required.' })
    requireRef(deckIds, value.deckOverrideId, `templates[${index}].deckOverrideId`, 'deck', issues)
  })
  workspace.decks.forEach((value, index) => {
    requireRef(profileIds, value.profileId, `decks[${index}].profileId`, 'profile', issues)
    requireRef(deckIds, value.parentDeckId, `decks[${index}].parentDeckId`, 'parent deck', issues)
    requireRef(presetIds, value.presetId, `decks[${index}].presetId`, 'preset', issues)
    envelope(value, `decks[${index}].sourceEnvelopeId`)
  })
  workspace.presets.forEach((value, index) => {
    requireRef(profileIds, value.profileId, `presets[${index}].profileId`, 'profile', issues)
    if (!(value.desiredRetention > 0 && value.desiredRetention < 1)) issues.push({ path: `presets[${index}].desiredRetention`, message: 'Desired retention must be between 0 and 1.' })
    for (const [path, values] of [['learningStepsMinutes', value.learningStepsMinutes], ['relearningStepsMinutes', value.relearningStepsMinutes]] as const) if (values.some((step) => !Number.isFinite(step) || step <= 0)) issues.push({ path: `presets[${index}].${path}`, message: 'Learning steps must be finite positive minutes.' })
    envelope(value, `presets[${index}].sourceEnvelopeId`)
  })
  workspace.notes.forEach((value, index) => {
    requireRef(profileIds, value.profileId, `notes[${index}].profileId`, 'profile', issues)
    requireRef(noteTypeIds, value.noteTypeId, `notes[${index}].noteTypeId`, 'note type', issues)
    Object.keys(value.fields).forEach((id) => requireRef(fieldIds, id, `notes[${index}].fields.${id}`, 'field', issues))
    envelope(value, `notes[${index}].sourceEnvelopeId`)
  })
  workspace.cards.forEach((value, index) => {
    requireRef(profileIds, value.profileId, `cards[${index}].profileId`, 'profile', issues)
    requireRef(noteIds, value.noteId, `cards[${index}].noteId`, 'note', issues)
    requireRef(templateIds, value.templateId, `cards[${index}].templateId`, 'template', issues)
    requireRef(deckIds, value.deckId, `cards[${index}].deckId`, 'deck', issues)
    requireRef(presetIds, value.presetId, `cards[${index}].presetId`, 'preset', issues)
    const note = noteById.get(value.noteId)
    const deck = deckById.get(value.deckId)
    const preset = presetById.get(value.presetId)
    const template = templateById.get(value.templateId)
    if ([note?.profileId, deck?.profileId, preset?.profileId].some((owner) => owner && owner !== value.profileId)) issues.push({ path: `cards[${index}]`, message: 'Card, note, deck, and preset must belong to the same profile.' })
    if (note && template && template.noteTypeId !== note.noteTypeId) issues.push({ path: `cards[${index}].templateId`, message: 'Card template must belong to the note type.' })
    if (template && value.ordinal !== template.ordinal && value.deletionOrdinal === undefined) issues.push({ path: `cards[${index}].ordinal`, message: 'Standard card ordinal must match its template ordinal.' })
    validateScheduling(value, index, issues); envelope(value, `cards[${index}].sourceEnvelopeId`)
  })
  workspace.reviews.forEach((value, index) => {
    requireRef(profileIds, value.profileId, `reviews[${index}].profileId`, 'profile', issues)
    requireRef(cardIds, value.cardId, `reviews[${index}].cardId`, 'card', issues)
    validateReview(value, index, reviewsById, reversedReviewIds, cardIds, issues); envelope(value, `reviews[${index}].sourceEnvelopeId`)
  })
  workspace.media.forEach((value, index) => {
    requireRef(profileIds, value.profileId, `media[${index}].profileId`, 'profile', issues)
    if (!/^[a-f\d]{64}$/i.test(value.sha256)) issues.push({ path: `media[${index}].sha256`, message: 'Media SHA-256 must contain 64 hexadecimal characters.' })
    if (!Number.isSafeInteger(value.byteLength) || value.byteLength < 0) issues.push({ path: `media[${index}].byteLength`, message: 'Media byte length must be a non-negative safe integer.' })
    envelope(value, `media[${index}].sourceEnvelopeId`)
  })
  workspace.extensionRecords.forEach((value, index) => {
    requireRef(profileIds, value.profileId, `extensionRecords[${index}].profileId`, 'profile', issues)
    validateExtensionRecord(value, index, noteIds, cardIds, mediaIds, issues)
  })
  workspace.sourceEnvelopes.forEach((value, index) => { requireRef(profileIds, value.profileId, `sourceEnvelopes[${index}].profileId`, 'profile', issues); validateEnvelope(value, index, issues) })
  if (workspace.profiles.filter((value) => value.active).length !== 1) issues.push({ path: 'profiles', message: 'Exactly one workspace profile must be active.' })
  for (const deck of workspace.decks) {
    const visited = new Set<string>(); let cursor: typeof deck | undefined = deck
    while (cursor?.parentDeckId) {
      if (visited.has(cursor.id)) { issues.push({ path: `decks.${deck.id}.parentDeckId`, message: 'Deck hierarchy must not contain a cycle.' }); break }
      visited.add(cursor.id); cursor = deckById.get(cursor.parentDeckId)
    }
  }
  return issues
}

export const validateWorkspaceV4Invariants = (workspace: WorkspaceV4): WorkspaceV4 => {
  const issues = collectWorkspaceV4InvariantIssues(workspace)
  if (issues.length) throw new Error(`Workspace v4 invariant violation: ${issues.slice(0, 8).map((issue) => `${issue.path}: ${issue.message}`).join(' ')}`)
  return workspace
}
