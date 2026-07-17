import { z } from 'zod'
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

export const practiceCardSchema = z.object({
  id,
  itemId: id,
  variant: id,
  occlusionId: id.optional(),
  suspended: z.boolean(),
  fsrs: storedFsrsSchema,
  estimatedSeconds: finiteNumber.nonnegative(),
  createdAt: timestamp,
  updatedAt: timestamp,
}).passthrough()

export const reviewEventSchema = z.object({
  id,
  cardId: id,
  rating: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  reviewedAt: timestamp,
  durationSeconds: finiteNumber.nonnegative(),
  previousDue: timestamp,
  nextDue: timestamp,
  previousCard: storedFsrsSchema.optional(),
  previousEstimatedSeconds: finiteNumber.nonnegative().optional(),
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

export const parseWorkspaceData = (input: unknown): AppData => {
  const result = workspaceSchema.safeParse(input)
  if (!result.success) throw new Error(`Workspace data is invalid. ${issueSummary(result.error)}`)
  return result.data as AppData
}

export type LegacyWorkspaceData = Partial<AppData> & {
  version?: number
  items?: Array<Partial<KnowledgeItem> & Pick<KnowledgeItem, 'id' | 'prompt' | 'answer' | 'collection' | 'createdAt' | 'updatedAt'>>
  cards?: Array<Partial<PracticeCard> & Pick<PracticeCard, 'id' | 'itemId' | 'variant' | 'suspended' | 'fsrs' | 'estimatedSeconds'>>
}

export const migrateWorkspaceData = (input: LegacyWorkspaceData): AppData => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Workspace data must be an object.')
  if (typeof input.version === 'number' && input.version > 3) throw new Error(`This workspace requires Neo Anki data version ${input.version}.`)
  const now = new Date().toISOString()
  const items = (input.items || []).map((item) => ({
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
    extensionData: item.extensionData,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }))
  const cards = (input.cards || []).map((card) => ({
    id: card.id,
    itemId: card.itemId,
    variant: card.variant,
    occlusionId: card.occlusionId,
    suspended: card.suspended,
    fsrs: card.fsrs,
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
      dailyMinutes: input.settings?.dailyMinutes ?? 30,
      retention: input.settings?.retention ?? 0.9,
      theme: input.settings?.theme ?? 'light',
      onboardingComplete: input.settings?.onboardingComplete ?? false,
      recoveryStrategy: input.settings?.recoveryStrategy ?? 'risk',
    },
    updatedAt: input.updatedAt || now,
  })
}
