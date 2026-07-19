import { createWorkspaceDocumentV4, parseWorkspaceDocumentV4, type Card, type CardTemplate, type ReviewRating, type WorkspaceDocumentV4, type WorkspaceV4 } from '@neo-anki/compatibility-domain'
import { createEmptyCard, fsrs, Rating, State, type Card as FsrsCard, type FSRSHistory, type Grade, type Steps } from 'ts-fsrs'

const id = (prefix: string) => `${prefix}:${crypto.randomUUID()}`
export const createEmptyWorkspace = (): WorkspaceDocumentV4 => {
  const now = new Date().toISOString(); const profileId = id('profile'); const noteTypeId = id('note-type'); const frontId = id('field'); const backId = id('field'); const templateId = id('template'); const presetId = id('preset'); const deckId = id('deck')
  const workspace: WorkspaceV4 = {
    version: 4, workspaceId: id('workspace'), revision: 1, deviceId: id('mobile'), createdAt: now, updatedAt: now,
    profiles: [{ id: profileId, revision: 1, createdAt: now, updatedAt: now, name: 'My collection', active: true }],
    noteTypes: [{ id: noteTypeId, revision: 1, createdAt: now, updatedAt: now, profileId, name: 'Neo Basic', fieldIds: [frontId, backId], templateIds: [templateId], css: '.card { font-family: system-ui, sans-serif; }', kind: 'standard' }],
    fields: [{ id: frontId, revision: 1, createdAt: now, updatedAt: now, noteTypeId, name: 'Front', ordinal: 0, rtl: false, sticky: false }, { id: backId, revision: 1, createdAt: now, updatedAt: now, noteTypeId, name: 'Back', ordinal: 1, rtl: false, sticky: false }],
    templates: [{ id: templateId, revision: 1, createdAt: now, updatedAt: now, noteTypeId, name: 'Forward', ordinal: 0, questionFormat: '{{Front}}', answerFormat: '{{FrontSide}}\n\n{{Back}}' }],
    presets: [{ id: presetId, revision: 1, createdAt: now, updatedAt: now, profileId, name: 'Neo defaults', scheduler: 'neo-fsrs', desiredRetention: .9, maximumIntervalDays: 36_500, learningStepsMinutes: [1, 10], relearningStepsMinutes: [10], newCardsPerDay: 20, reviewsPerDay: 200, buryNewSiblings: true, buryReviewSiblings: true, leechThreshold: 8, leechAction: 'flag' }],
    decks: [{ id: deckId, revision: 1, createdAt: now, updatedAt: now, profileId, name: 'Default', presetId }],
    notes: [], cards: [], reviews: [], media: [], extensionRecords: [], sourceEnvelopes: [],
  }
  return createWorkspaceDocumentV4(workspace, { settings: { theme: 'system' }, goals: [], views: [], packs: [], packConflicts: [], trash: [] })
}

export const dueAt = (card: Card) => card.scheduling.strategy === 'neo-fsrs' ? card.scheduling.dueAt : card.scheduling.dueAt || new Date(card.scheduling.due * 1000).toISOString()
export const dueCards = (document: WorkspaceDocumentV4, now = new Date()) => {
  const start = new Date(now); start.setHours(0, 0, 0, 0)
  const reversed = new Set(document.workspace.reviews.filter((review) => review.kind === 'reversal' && review.reversesReviewId).map((review) => review.reversesReviewId!))
  const studied = new Map<string, { new: number; review: number }>()
  for (const review of document.workspace.reviews) {
    if (review.kind !== 'review' || reversed.has(review.id) || Date.parse(review.reviewedAt) < start.getTime()) continue
    const card = document.workspace.cards.find((candidate) => candidate.id === review.cardId); if (!card) continue
    const count = studied.get(card.presetId) || { new: 0, review: 0 }
    if (review.previousScheduling?.queue === 'new') count.new += 1
    else if (review.previousScheduling?.queue === 'review' || (!review.previousScheduling && card.scheduling.queue === 'review')) count.review += 1
    studied.set(card.presetId, count)
  }
  const selected = new Map<string, { new: number; review: number }>()
  return document.workspace.cards
    .filter((card) => !card.suspended && (!card.buriedUntil || Date.parse(card.buriedUntil) <= now.getTime()) && (card.scheduling.queue === 'new' || Date.parse(dueAt(card)) <= now.getTime()))
    .sort((left, right) => {
      const priority = (card: Card) => card.scheduling.queue === 'learn' || card.scheduling.queue === 'relearn' ? 0 : card.scheduling.queue === 'review' ? 1 : 2
      return priority(left) - priority(right) || Date.parse(dueAt(left)) - Date.parse(dueAt(right)) || left.id.localeCompare(right.id)
    })
    .filter((card) => {
      if (card.scheduling.queue === 'learn' || card.scheduling.queue === 'relearn') return true
      const preset = document.workspace.presets.find((value) => value.id === card.presetId); if (!preset) return false
      const already = studied.get(card.presetId) || { new: 0, review: 0 }; const accepted = selected.get(card.presetId) || { new: 0, review: 0 }
      const kind = card.scheduling.queue === 'new' ? 'new' : 'review'; const limit = kind === 'new' ? preset.newCardsPerDay : preset.reviewsPerDay
      if (already[kind] + accepted[kind] >= limit) return false
      accepted[kind] += 1; selected.set(card.presetId, accepted); return true
    })
}
const fieldNameValue = (document: WorkspaceDocumentV4, card: Card) => {
  const note = document.workspace.notes.find((value) => value.id === card.noteId); const type = note && document.workspace.noteTypes.find((value) => value.id === note.noteTypeId)
  return Object.fromEntries((type?.fieldIds || []).map((fieldId) => [document.workspace.fields.find((value) => value.id === fieldId)?.name || fieldId, note?.fields[fieldId] || '']))
}
const render = (format: string, values: Record<string, string>, front = '') => format.replaceAll('{{FrontSide}}', front).replace(/{{(?:type:)?([^}]+)}}/g, (_match, name: string) => values[name.trim()] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
export const cardText = (document: WorkspaceDocumentV4, card: Card) => { const template = document.workspace.templates.find((value) => value.id === card.templateId); const values = fieldNameValue(document, card); const prompt = render(template?.questionFormat || '{{Front}}', values); return { prompt, answer: render(template?.answerFormat || '{{Back}}', values, prompt) } }

const fsrsCard = (document: WorkspaceDocumentV4, card: Card, preset: WorkspaceDocumentV4['workspace']['presets'][number]): FsrsCard => {
  if (card.scheduling.strategy === 'neo-fsrs') return { due: new Date(card.scheduling.dueAt), stability: card.scheduling.stability, difficulty: card.scheduling.difficulty, elapsed_days: card.scheduling.elapsedDays, scheduled_days: card.scheduling.scheduledDays, reps: card.scheduling.reps, lapses: card.scheduling.lapses, state: card.scheduling.state as State, learning_steps: 0, last_review: card.scheduling.lastReviewAt ? new Date(card.scheduling.lastReviewAt) : undefined }
  const exactDue = card.scheduling.dueAt || new Date(Math.max(0, card.scheduling.due) * 1000).toISOString()
  const state = card.scheduling.queue === 'new' ? State.New : card.scheduling.queue === 'review' ? State.Review : card.scheduling.queue === 'relearn' ? State.Relearning : State.Learning
  if (card.scheduling.stability && card.scheduling.difficulty !== undefined) return { due: new Date(exactDue), stability: card.scheduling.stability, difficulty: card.scheduling.difficulty, elapsed_days: card.scheduling.intervalDays, scheduled_days: card.scheduling.intervalDays, reps: card.scheduling.repetitions, lapses: card.scheduling.lapses, state, learning_steps: card.scheduling.remainingSteps, last_review: card.scheduling.lastReviewAt ? new Date(card.scheduling.lastReviewAt) : undefined }
  const history: FSRSHistory[] = document.workspace.reviews.filter((review) => review.cardId === card.id && review.kind === 'review' && review.scheduler === 'anki').sort((left, right) => left.reviewedAt.localeCompare(right.reviewedAt)).map((review) => ({ rating: grade(review.rating), review: review.reviewedAt }))
  if (!history.length) return { ...createEmptyCard(new Date(exactDue)), due: new Date(exactDue), scheduled_days: card.scheduling.intervalDays, reps: card.scheduling.repetitions, lapses: card.scheduling.lapses, state, learning_steps: card.scheduling.remainingSteps, last_review: card.scheduling.lastReviewAt ? new Date(card.scheduling.lastReviewAt) : undefined }
  const converter = fsrs({ request_retention: card.scheduling.desiredRetention || preset.desiredRetention, maximum_interval: preset.maximumIntervalDays, learning_steps: preset.learningStepsMinutes.map((value) => `${value}m`) as Steps, relearning_steps: preset.relearningStepsMinutes.map((value) => `${value}m`) as Steps, enable_fuzz: false, enable_short_term: true })
  const replayed = converter.reschedule(createEmptyCard(new Date(history[0]!.review!)), history, { now: exactDue }).collections.at(-1)?.card
  return replayed ? { ...replayed, due: new Date(exactDue), scheduled_days: card.scheduling.intervalDays || replayed.scheduled_days, reps: Math.max(card.scheduling.repetitions, replayed.reps), lapses: Math.max(card.scheduling.lapses, replayed.lapses), state, learning_steps: card.scheduling.remainingSteps, last_review: card.scheduling.lastReviewAt ? new Date(card.scheduling.lastReviewAt) : replayed.last_review } : createEmptyCard(new Date(exactDue))
}
const grade = (rating: ReviewRating): Grade => rating === 1 ? Rating.Again : rating === 2 ? Rating.Hard : rating === 3 ? Rating.Good : Rating.Easy
export const reviewCard = (input: WorkspaceDocumentV4, cardId: string, rating: ReviewRating, durationMilliseconds: number, now = new Date()) => {
  const document = parseWorkspaceDocumentV4(input); const card = document.workspace.cards.find((value) => value.id === cardId); if (!card) throw new Error('Card no longer exists.')
  const preset = document.workspace.presets.find((value) => value.id === card.presetId); if (!preset) throw new Error('Card preset is missing.')
  const before = structuredClone(card.scheduling); const previousState = { suspended: card.suspended, buriedUntil: card.buriedUntil, buriedBy: card.buriedBy, flags: card.flags, leech: card.leech }; const scheduler = fsrs({ request_retention: card.scheduling.strategy === 'anki' ? card.scheduling.desiredRetention || preset.desiredRetention : preset.desiredRetention, maximum_interval: preset.maximumIntervalDays, learning_steps: preset.learningStepsMinutes.map((value) => `${value}m`) as Steps, relearning_steps: preset.relearningStepsMinutes.map((value) => `${value}m`) as Steps, enable_fuzz: false, enable_short_term: true })
  const result = scheduler.next(fsrsCard(document, card, preset), now, grade(rating)); const next = result.card
  card.scheduling = { strategy: 'neo-fsrs', queue: next.state === State.New ? 'new' : next.state === State.Learning ? 'learn' : next.state === State.Relearning ? 'relearn' : 'review', dueAt: next.due.toISOString(), stability: next.stability, difficulty: next.difficulty, elapsedDays: next.elapsed_days, scheduledDays: next.scheduled_days, reps: next.reps, lapses: next.lapses, state: next.state, lastReviewAt: next.last_review?.toISOString() }
  const timestamp = now.toISOString(); const tomorrow = new Date(now); tomorrow.setHours(24, 0, 0, 0); const burySiblings = before.queue === 'new' ? preset.buryNewSiblings : preset.buryReviewSiblings
  const siblingChanges = burySiblings ? document.workspace.cards.filter((candidate) => candidate.noteId === card.noteId && candidate.id !== card.id && candidate.buriedUntil !== tomorrow.toISOString()).map((candidate) => ({ cardId: candidate.id, previousBuriedUntil: candidate.buriedUntil, previousBuriedBy: candidate.buriedBy })) : []
  for (const change of siblingChanges) { const sibling = document.workspace.cards.find((candidate) => candidate.id === change.cardId)!; sibling.buriedUntil = tomorrow.toISOString(); sibling.buriedBy = 'scheduler'; sibling.updatedAt = timestamp; sibling.revision += 1 }
  const isLeech = rating === 1 && next.lapses >= preset.leechThreshold; if (isLeech) { card.leech = true; if (preset.leechAction === 'suspend') card.suspended = true; else if (!card.flags) card.flags = 1 }
  card.updatedAt = timestamp; card.revision += 1
  document.workspace.reviews.push({ id: id('review'), revision: 1, createdAt: timestamp, updatedAt: timestamp, profileId: card.profileId, cardId, kind: 'review', rating, reviewedAt: timestamp, durationMilliseconds: Math.max(0, Math.min(3_600_000, durationMilliseconds)), intervalBefore: before.strategy === 'neo-fsrs' ? before.scheduledDays : before.intervalDays, intervalAfter: next.scheduled_days, scheduler: 'neo-fsrs', previousScheduling: before, nextScheduling: structuredClone(card.scheduling), previousCardState: previousState, siblingChanges })
  document.workspace.revision += 1; document.workspace.updatedAt = timestamp
  return createWorkspaceDocumentV4(document.workspace, document.clientState)
}

export const latestReversibleReview = (document: WorkspaceDocumentV4) => {
  const reversed = new Set(document.workspace.reviews.filter((review) => review.kind === 'reversal' && review.reversesReviewId).map((review) => review.reversesReviewId!))
  return [...document.workspace.reviews].reverse().find((review) => review.kind === 'review' && !reversed.has(review.id) && review.previousScheduling)
}

export const undoLastReview = (input: WorkspaceDocumentV4, now = new Date()) => {
  const document = parseWorkspaceDocumentV4(input); const review = latestReversibleReview(document); if (!review?.previousScheduling) throw new Error('There is no review to undo.')
  const card = document.workspace.cards.find((value) => value.id === review.cardId); if (!card) throw new Error('The reviewed card no longer exists.')
  const currentScheduling = structuredClone(card.scheduling); const timestamp = now.toISOString()
  card.scheduling = structuredClone(review.previousScheduling); card.suspended = review.previousCardState?.suspended ?? card.suspended; card.buriedUntil = review.previousCardState?.buriedUntil; card.buriedBy = review.previousCardState?.buriedBy; card.flags = review.previousCardState?.flags ?? card.flags; card.leech = review.previousCardState?.leech; card.updatedAt = timestamp; card.revision += 1
  for (const change of review.siblingChanges || []) { const sibling = document.workspace.cards.find((value) => value.id === change.cardId); if (!sibling) continue; sibling.buriedUntil = change.previousBuriedUntil; sibling.buriedBy = change.previousBuriedBy; sibling.updatedAt = timestamp; sibling.revision += 1 }
  document.workspace.reviews.push({ id: id('reversal'), revision: 1, createdAt: timestamp, updatedAt: timestamp, profileId: card.profileId, cardId: card.id, kind: 'reversal', rating: review.rating, reviewedAt: timestamp, durationMilliseconds: 0, intervalBefore: review.intervalAfter, intervalAfter: review.intervalBefore, scheduler: 'neo-fsrs', reversesReviewId: review.id, previousScheduling: currentScheduling, nextScheduling: structuredClone(card.scheduling) })
  document.workspace.revision += 1; document.workspace.updatedAt = timestamp
  return createWorkspaceDocumentV4(document.workspace, document.clientState)
}

export const addNote = (input: WorkspaceDocumentV4, noteTypeId: string, deckId: string, fields: Record<string, string>, tags: string[] = []) => {
  const document = parseWorkspaceDocumentV4(input); const type = document.workspace.noteTypes.find((value) => value.id === noteTypeId); const profile = type && document.workspace.profiles.find((value) => value.id === type.profileId); const deck = document.workspace.decks.find((value) => value.id === deckId && value.profileId === profile?.id)
  if (!profile || !type || !deck) throw new Error('The selected note type or deck is no longer available.')
  const templates = type.templateIds.map((templateId) => document.workspace.templates.find((value) => value.id === templateId)).filter((value): value is CardTemplate => Boolean(value))
  if (!templates.length) throw new Error('The selected note type has no card templates.')
  const normalizedFields = Object.fromEntries(type.fieldIds.map((fieldId) => [fieldId, fields[fieldId]?.trim() || '']))
  if (!Object.values(normalizedFields).some(Boolean)) throw new Error('Enter at least one field before adding the note.')
  const clozeOrdinals = [...new Set(Object.values(normalizedFields).flatMap((value) => [...value.matchAll(/{{c(\d+)::/gi)].map((match) => Number(match[1]))).filter((value) => Number.isSafeInteger(value) && value > 0))].sort((a, b) => a - b)
  if (type.kind === 'cloze' && !clozeOrdinals.length) throw new Error('A cloze note needs at least one {{c1::deletion}}.')
  const now = new Date().toISOString(); const noteId = id('note')
  document.workspace.notes.unshift({ id: noteId, revision: 1, createdAt: now, updatedAt: now, profileId: profile.id, noteTypeId: type.id, fields: normalizedFields, tags: [...new Set(tags.map((value) => value.trim()).filter(Boolean))], marked: false })
  const seeds = type.kind === 'cloze' ? clozeOrdinals.map((clozeOrdinal) => ({ template: templates[0]!, clozeOrdinal })) : templates.map((template) => ({ template, clozeOrdinal: undefined }))
  for (const [ordinal, seed] of seeds.entries()) {
    const targetDeck = document.workspace.decks.find((value) => value.id === seed.template.deckOverrideId) || deck
    document.workspace.cards.unshift({ id: id('card'), revision: 1, createdAt: now, updatedAt: now, profileId: profile.id, noteId, templateId: seed.template.id, deckId: targetDeck.id, presetId: targetDeck.presetId, ordinal: type.kind === 'cloze' ? (seed.clozeOrdinal || 1) - 1 : seed.template.ordinal ?? ordinal, clozeOrdinal: seed.clozeOrdinal, flags: 0, suspended: false, leech: false, scheduling: { strategy: 'neo-fsrs', queue: 'new', dueAt: now, stability: 0, difficulty: 0, elapsedDays: 0, scheduledDays: 0, reps: 0, lapses: 0, state: State.New } })
  }
  document.workspace.revision += 1; document.workspace.updatedAt = now; return createWorkspaceDocumentV4(document.workspace, document.clientState)
}

export const addBasicNote = (input: WorkspaceDocumentV4, front: string, back: string, deckId?: string) => {
  const type = input.workspace.noteTypes.find((value) => value.name === 'Neo Basic') || input.workspace.noteTypes[0]; const deck = input.workspace.decks.find((value) => value.id === deckId) || input.workspace.decks[0]
  if (!type || !deck) throw new Error('Default mobile note setup is missing.')
  return addNote(input, type.id, deck.id, { [type.fieldIds[0]!]: front, [type.fieldIds[1]!]: back })
}
