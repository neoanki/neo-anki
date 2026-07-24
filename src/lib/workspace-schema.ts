import { z } from 'zod'

// Neo Anki ships with a strict CSP. Disable Zod's optional `new Function`
// optimization before any schema is constructed so Firefox does not emit a
// CSP violation while Zod probes for eval support.
z.config({ jitless: true })
import type { AppData, KnowledgeItem, PracticeCard } from '../types.js'

const id = z.string().trim().min(1).max(240)
const text = z.string()
const timestamp = z.string().refine((value) => Number.isFinite(Date.parse(value)), 'Expected an ISO date or timestamp.')
const optionalTimestamp = timestamp.optional()
const finiteNumber = z.number().finite()

const citationSchema = z.object({
  id,
  title: text,
  url: text.optional(),
  quote: text.optional(),
  accessedAt: text.optional(),
}).passthrough()

const occlusionSchema = z.object({
  id,
  x: finiteNumber,
  y: finiteNumber,
  width: finiteNumber,
  height: finiteNumber,
  label: text.optional(),
}).passthrough()

const provenanceSchema = z.object({
  packId: id,
  sourceItemId: id,
  packVersion: text,
}).passthrough()

export const knowledgeItemSchema = z.object({
  id,
  prompt: text,
  answer: text,
  context: text,
  collection: text,
  tags: z.array(text),
  source: text.optional(),
  citations: z.array(citationSchema),
  mediaIds: z.array(id),
  occlusions: z.array(occlusionSchema),
  provenance: provenanceSchema.optional(),
  contentModel: z.object({ contentTypeId: id, contentTypeName: text, fields: z.array(z.object({ id, name: text, ordinal: z.number().int().nonnegative(), value: text })) }).optional(),
  extensionData: z.record(z.string(), z.unknown()).optional(),
  createdAt: timestamp,
  updatedAt: timestamp,
}).passthrough()

const storedFsrsSchema = z.object({
  due: timestamp,
  last_review: optionalTimestamp,
  stability: finiteNumber,
  difficulty: finiteNumber,
  elapsed_days: finiteNumber,
  scheduled_days: finiteNumber,
  reps: z.number().int().nonnegative(),
  lapses: z.number().int().nonnegative(),
  state: z.number().int().min(0).max(3),
  learning_steps: z.number().int().nonnegative().optional(),
}).passthrough()

const cardQueueSchema = z.enum(['new', 'learn', 'review', 'relearn', 'preview'])
const neoFsrsSchedulingSchema = z.object({
  strategy: z.literal('neo-fsrs'), queue: cardQueueSchema, dueAt: timestamp,
  stability: finiteNumber.nonnegative(), difficulty: finiteNumber.min(0).max(10), elapsedDays: finiteNumber.nonnegative(),
  scheduledDays: finiteNumber.nonnegative(), reps: z.number().int().nonnegative(), lapses: z.number().int().nonnegative(),
  state: z.number().int().min(0).max(3), lastReviewAt: optionalTimestamp, continuityOverrideDueAt: optionalTimestamp,
}).passthrough()
const cardSchedulingSchema = neoFsrsSchedulingSchema
const cardRenderingSchema = z.object({
  templateId: id,
  templateName: text,
  prompt: z.object({ id, label: text, value: text }),
  answer: z.object({ id, label: text, value: text }),
  supporting: z.array(z.object({ id, label: text, value: text })),
  responseMode: z.enum(['reveal', 'type']),
}).passthrough()

export const practiceCardSchema = z.object({
  id,
  itemId: id,
  deckName: text.optional(),
  presetId: id.optional(),
  schedulerOptions: z.object({
    desiredRetention: finiteNumber.min(0.7).max(0.99), maximumIntervalDays: finiteNumber.positive(),
    learningStepsMinutes: z.array(finiteNumber.positive()), relearningStepsMinutes: z.array(finiteNumber.positive()),
    newCardsPerDay: z.number().int().nonnegative(), reviewsPerDay: z.number().int().nonnegative(),
    buryNewSiblings: z.boolean(), buryReviewSiblings: z.boolean(), leechThreshold: z.number().int().positive(), leechAction: z.enum(['flag', 'suspend']),
  }).optional(),
  variant: id,
  occlusionId: id.optional(),
  promptData: z.record(z.string(), z.unknown()).optional(),
  suspended: z.boolean(),
  buriedUntil: optionalTimestamp,
  buriedBy: z.enum(['user', 'scheduler']).optional(),
  flags: z.number().int().min(0).max(7).optional(),
  leech: z.boolean().optional(),
  fsrs: storedFsrsSchema,
  scheduling: cardSchedulingSchema.optional(),
  rendering: cardRenderingSchema.optional(),
  estimatedSeconds: finiteNumber.nonnegative(),
  createdAt: timestamp,
  updatedAt: timestamp,
}).passthrough()

export const reviewEventSchema = z.object({
  id,
  deviceId: id.optional(),
  cardId: id,
  rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  kind: z.enum(['review', 'preview', 'migration', 'reversal']).optional(),
  reversesReviewId: id.optional(),
  reviewedAt: timestamp,
  durationSeconds: finiteNumber.nonnegative(),
  rawDurationSeconds: finiteNumber.nonnegative().optional(),
  previousDue: timestamp,
  nextDue: timestamp,
  previousCard: storedFsrsSchema.optional(),
  previousScheduling: cardSchedulingSchema.optional(),
  previousEstimatedSeconds: finiteNumber.nonnegative().optional(),
  previousCardState: z.object({ suspended: z.boolean(), buriedUntil: optionalTimestamp, buriedBy: z.enum(['user', 'scheduler']).optional(), flags: z.number().int().min(0).max(7).optional(), leech: z.boolean().optional() }).optional(),
  siblingChanges: z.array(z.object({ cardId: id, previousBuriedUntil: optionalTimestamp, previousBuriedBy: z.enum(['user', 'scheduler']).optional() })).optional(),
}).passthrough()

export const mediaAssetSchema = z.object({
  id,
  filename: text,
  mimeType: text,
  dataUrl: text,
  byteLength: z.number().int().nonnegative(),
  hash: text,
  altText: text,
  createdAt: timestamp,
  updatedAt: timestamp,
}).passthrough()

const viewFilterSchema = z.object({
  query: text,
  collections: z.array(text),
  tags: z.array(text),
  states: z.array(z.enum(['new', 'due', 'review', 'suspended'])),
}).passthrough()

export const savedViewSchema = z.object({
  id,
  name: text,
  filter: viewFilterSchema,
  sort: z.enum(['updated', 'created', 'due', 'difficulty']),
  createdAt: timestamp,
  updatedAt: timestamp,
}).passthrough()

export const learningGoalSchema = z.object({
  id,
  name: text,
  description: text,
  filter: viewFilterSchema,
  deadline: text.optional(),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  active: z.boolean(),
  color: text,
  createdAt: timestamp,
  updatedAt: timestamp,
}).passthrough()

const packManifestItemSchema = z.object({
  sourceId: id,
  prompt: text,
  answer: text,
  context: text,
  collection: text,
  tags: z.array(text),
  citations: z.array(citationSchema.omit({ id: true })).optional(),
  cards: z.array(z.object({ id, variant: id, promptData: z.record(z.string(), z.unknown()).optional(), occlusionId: id.optional() })).optional(),
  variants: z.array(id).optional(),
}).passthrough()

export const packSubscriptionSchema = z.object({
  id,
  packId: id,
  name: text,
  description: text,
  author: text,
  installedVersion: text,
  license: text,
  sourceUrl: text.optional(),
  itemMap: z.record(z.string(), z.string()),
  baseItems: z.record(z.string(), packManifestItemSchema),
  installedAt: timestamp,
  updatedAt: timestamp,
}).passthrough()

export const packConflictSchema = z.object({
  id,
  packId: id,
  sourceItemId: id,
  itemId: id,
  field: text,
  baseValue: z.unknown(),
  localValue: z.unknown(),
  upstreamValue: z.unknown(),
  resolution: z.enum(['local', 'upstream']).optional(),
  createdAt: timestamp,
}).passthrough()

export const trashEntrySchema = z.object({
  id,
  item: knowledgeItemSchema,
  cards: z.array(practiceCardSchema),
  deletedAt: timestamp,
}).passthrough()

export const userSettingsSchema = z.object({
  dailyMinutes: finiteNumber.min(1).max(24 * 60),
  retention: finiteNumber.min(0.7).max(0.99),
  theme: z.enum(['light', 'dark']),
  onboardingComplete: z.boolean(),
  recoveryStrategy: id,
  burySiblings: z.boolean().default(true),
  leechThreshold: z.number().int().min(1).max(100).default(8),
  leechAction: z.enum(['flag', 'suspend']).default('flag'),
}).passthrough()

export const workspaceSchema = z.object({
  version: z.literal(3),
  deviceId: id,
  items: z.array(knowledgeItemSchema),
  cards: z.array(practiceCardSchema),
  reviews: z.array(reviewEventSchema),
  assets: z.array(mediaAssetSchema),
  goals: z.array(learningGoalSchema),
  views: z.array(savedViewSchema),
  packs: z.array(packSubscriptionSchema),
  packConflicts: z.array(packConflictSchema),
  trash: z.array(trashEntrySchema),
  settings: userSettingsSchema,
  updatedAt: timestamp,
}).passthrough()

const issueSummary = (error: z.ZodError) => error.issues.slice(0, 5).map((issue) => `${issue.path.join('.') || 'workspace'}: ${issue.message}`).join('; ')

export interface WorkspaceInvariantIssue {
  path: string
  message: string
}

const MAX_INVARIANT_ISSUES = 20

const duplicateValues = (values: string[]) => {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value)
    seen.add(value)
  }
  return [...duplicates]
}

/**
 * Validates relationships that a shape schema cannot express. Keep this function
 * synchronous and deterministic so every ingress boundary can use the same rules.
 */
export const collectWorkspaceInvariantIssues = (data: AppData): WorkspaceInvariantIssue[] => {
  const issues: WorkspaceInvariantIssue[] = []
  const add = (path: string, message: string) => {
    if (issues.length < MAX_INVARIANT_ISSUES) issues.push({ path, message })
  }
  const unique = (path: string, values: string[]) => duplicateValues(values).forEach((value) => add(path, `Duplicate id ${value}.`))

  unique('items', data.items.map((value) => value.id))
  unique('cards', data.cards.map((value) => value.id))
  unique('reviews', data.reviews.map((value) => value.id))
  unique('assets', data.assets.map((value) => value.id))
  unique('goals', data.goals.map((value) => value.id))
  unique('views', data.views.map((value) => value.id))
  unique('packs', data.packs.map((value) => value.id))
  unique('packConflicts', data.packConflicts.map((value) => value.id))
  unique('trash', data.trash.map((value) => value.id))

  const itemIds = new Set(data.items.map((value) => value.id))
  const cardIds = new Set(data.cards.map((value) => value.id))
  const assetIds = new Set(data.assets.map((value) => value.id))
  const packIds = new Set(data.packs.map((value) => value.packId))
  const trashItemIds = new Set(data.trash.map((value) => value.item.id))
  const reviewById = new Map(data.reviews.map((value) => [value.id, value]))
  const reversedReviewIds = new Set<string>()

  data.items.forEach((item, index) => {
    unique(`items.${index}.mediaIds`, item.mediaIds)
    unique(`items.${index}.occlusions`, item.occlusions.map((value) => value.id))
    unique(`items.${index}.citations`, item.citations.map((value) => value.id))
    item.mediaIds.forEach((assetId) => { if (!assetIds.has(assetId)) add(`items.${index}.mediaIds`, `Unknown media asset ${assetId}.`) })
    item.occlusions.forEach((occlusion, occlusionIndex) => {
      if (occlusion.width <= 0 || occlusion.height <= 0) add(`items.${index}.occlusions.${occlusionIndex}`, 'Occlusion dimensions must be positive.')
      if (occlusion.x < 0 || occlusion.y < 0 || occlusion.x + occlusion.width > 1 || occlusion.y + occlusion.height > 1) add(`items.${index}.occlusions.${occlusionIndex}`, 'Occlusion coordinates must remain inside the normalized image bounds.')
    })
  })

  data.cards.forEach((card, index) => {
    if (!itemIds.has(card.itemId)) add(`cards.${index}.itemId`, `Unknown knowledge item ${card.itemId}.`)
    if (card.occlusionId) {
      const item = data.items.find((candidate) => candidate.id === card.itemId)
      if (!item?.occlusions.some((candidate) => candidate.id === card.occlusionId)) add(`cards.${index}.occlusionId`, `Unknown occlusion ${card.occlusionId}.`)
    }
    if (card.fsrs.stability < 0 || card.fsrs.difficulty < 0 || card.fsrs.elapsed_days < 0 || card.fsrs.scheduled_days < 0) add(`cards.${index}.fsrs`, 'FSRS values cannot be negative.')
  })

  data.packs.forEach((pack, index) => {
    unique(`packs.${index}.itemMap`, Object.values(pack.itemMap))
    for (const [sourceId, itemId] of Object.entries(pack.itemMap)) {
      if (!pack.baseItems[sourceId]) add(`packs.${index}.itemMap.${sourceId}`, 'Pack mapping has no base item.')
      if (!itemIds.has(itemId)) add(`packs.${index}.itemMap.${sourceId}`, `Unknown knowledge item ${itemId}.`)
    }
  })

  data.packConflicts.forEach((conflict, index) => {
    if (!packIds.has(conflict.packId)) add(`packConflicts.${index}.packId`, `Unknown pack ${conflict.packId}.`)
    if (!itemIds.has(conflict.itemId)) add(`packConflicts.${index}.itemId`, `Unknown knowledge item ${conflict.itemId}.`)
  })

  data.reviews.forEach((review, index) => {
    if (review.kind === 'reversal') {
      if (!review.reversesReviewId) add(`reviews.${index}.reversesReviewId`, 'A reversal must name the review it reverses.')
      else {
        const target = reviewById.get(review.reversesReviewId)
        if (!target) add(`reviews.${index}.reversesReviewId`, `Unknown review ${review.reversesReviewId}.`)
        else {
          if (target.kind === 'reversal') add(`reviews.${index}.reversesReviewId`, 'A reversal cannot reverse another reversal.')
          if (target.cardId !== review.cardId) add(`reviews.${index}.reversesReviewId`, 'A reversal must reference a review for the same card.')
        }
        if (reversedReviewIds.has(review.reversesReviewId)) add(`reviews.${index}.reversesReviewId`, 'A review can be reversed only once.')
        reversedReviewIds.add(review.reversesReviewId)
      }
    } else if (review.reversesReviewId) add(`reviews.${index}.reversesReviewId`, 'Only reversal events may name a reversed review.')
  })

  data.trash.forEach((entry, index) => {
    if (itemIds.has(entry.item.id)) add(`trash.${index}.item.id`, 'A trashed item cannot also be live.')
    unique(`trash.${index}.cards`, entry.cards.map((value) => value.id))
    entry.cards.forEach((card, cardIndex) => {
      if (card.itemId !== entry.item.id) add(`trash.${index}.cards.${cardIndex}.itemId`, 'A trashed card must belong to its trashed item.')
      if (cardIds.has(card.id)) add(`trash.${index}.cards.${cardIndex}.id`, 'A trashed card cannot also be live.')
    })
  })
  if (duplicateValues([...itemIds, ...trashItemIds]).length) add('trash', 'Live and trashed item identifiers must not overlap.')

  // Review events intentionally survive permanent card deletion; their cardId is
  // historical provenance and is therefore not required to reference a live row.
  return issues
}

export const validateWorkspaceInvariants = (data: AppData): AppData => {
  const issues = collectWorkspaceInvariantIssues(data)
  if (issues.length) throw new Error(`Workspace invariants are invalid. ${issues.slice(0, 5).map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`)
  return data
}

export const parseWorkspaceData = (input: unknown): AppData => {
  const result = workspaceSchema.safeParse(input)
  if (!result.success) throw new Error(`Workspace data is invalid. ${issueSummary(result.error)}`)
  return validateWorkspaceInvariants(result.data as AppData)
}

export type LegacyWorkspaceData = Partial<AppData> & {
  version?: number
  items?: Array<Partial<KnowledgeItem> & Pick<KnowledgeItem, 'id' | 'prompt' | 'answer' | 'collection' | 'createdAt' | 'updatedAt'> & { noteModel?: { noteTypeId: string; noteTypeName: string; fields: Array<{ id: string; name: string; ordinal: number; value: string }> } }>
  cards?: Array<Partial<PracticeCard> & Pick<PracticeCard, 'id' | 'itemId' | 'variant' | 'suspended' | 'fsrs' | 'estimatedSeconds'>>
}

export const migrateWorkspaceData = (input: LegacyWorkspaceData): AppData => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Workspace data must be an object.')
  if (typeof input.version === 'number' && input.version > 3) throw new Error(`This workspace requires Neo Anki data version ${input.version}.`)
  const now = new Date().toISOString()
  const items = (input.items || []).map((item) => {
    const legacyNoteModel = (item as typeof item & { noteModel?: { noteTypeId: string; noteTypeName: string; fields: Array<{ id: string; name: string; ordinal: number; value: string }> } }).noteModel
    return {
    id: item.id,
    prompt: item.prompt,
    answer: item.answer,
    context: item.context || '',
    collection: item.collection,
    tags: item.tags || [],
    source: item.source,
    citations: item.citations || (item.source ? [{ id: crypto.randomUUID(), title: item.source, url: item.source }] : []),
    mediaIds: item.mediaIds || [],
    occlusions: item.occlusions || [],
    provenance: item.provenance,
    contentModel: item.contentModel || (legacyNoteModel ? {
      contentTypeId: legacyNoteModel.noteTypeId,
      contentTypeName: legacyNoteModel.noteTypeName,
      fields: legacyNoteModel.fields,
    } : undefined),
    extensionData: item.extensionData,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }})
  const cards = (input.cards || []).map((card) => ({
    id: card.id,
    itemId: card.itemId,
    deckName: card.deckName,
    presetId: card.presetId,
    schedulerOptions: card.schedulerOptions,
    variant: card.variant,
    occlusionId: card.occlusionId,
    promptData: card.promptData,
    suspended: card.suspended,
    buriedUntil: card.buriedUntil,
    buriedBy: card.buriedBy,
    flags: card.flags,
    leech: card.leech,
    fsrs: card.fsrs,
    scheduling: card.scheduling,
    rendering: card.rendering,
    estimatedSeconds: card.estimatedSeconds,
    createdAt: card.createdAt || now,
    updatedAt: card.updatedAt || card.fsrs.last_review || now,
  }))
  return parseWorkspaceData({
    version: 3,
    deviceId: input.deviceId || crypto.randomUUID(),
    items,
    cards,
    reviews: input.reviews || [],
    assets: input.assets || [],
    goals: input.goals || [],
    views: input.views || [],
    packs: input.packs || [],
    packConflicts: input.packConflicts || [],
    trash: input.trash || [],
    settings: {
      ...input.settings,
      dailyMinutes: input.settings?.dailyMinutes ?? 30,
      retention: input.settings?.retention ?? 0.9,
      theme: input.settings?.theme ?? 'light',
      onboardingComplete: input.settings?.onboardingComplete ?? false,
      recoveryStrategy: input.settings?.recoveryStrategy ?? 'risk',
      burySiblings: input.settings?.burySiblings ?? true,
      leechThreshold: input.settings?.leechThreshold ?? 8,
      leechAction: input.settings?.leechAction ?? 'flag',
    },
    updatedAt: input.updatedAt || now,
  })
}
