import type { Card as FSRSCard } from 'ts-fsrs'

export type Route = string
export type Theme = 'light' | 'dark'
export type PromptVariant = string
export type ReviewRating = 1 | 2 | 3 | 4
export type ReviewEventKind = 'review' | 'preview' | 'migration' | 'reversal'
export type RecoveryStrategy = string
export type SessionIntent = 'balanced' | 'focus' | 'urgent'
export type CardStateFilter = 'new' | 'due' | 'review' | 'suspended'
export type ViewSort = 'updated' | 'created' | 'due' | 'difficulty'

export interface Citation {
  id: string
  title: string
  url?: string
  quote?: string
  accessedAt?: string
}

export interface MediaAsset {
  id: string
  filename: string
  mimeType: string
  dataUrl: string
  byteLength: number
  hash: string
  altText: string
  createdAt: string
  updatedAt: string
}

export interface OcclusionRect {
  id: string
  x: number
  y: number
  width: number
  height: number
  label?: string
}

export interface ItemProvenance {
  packId: string
  sourceItemId: string
  packVersion: string
}

export interface NoteModelProjection {
  noteTypeId: string
  noteTypeName: string
  fields: Array<{ id: string; name: string; ordinal: number; value: string }>
}

export interface KnowledgeItem {
  id: string
  prompt: string
  answer: string
  context: string
  collection: string
  tags: string[]
  source?: string
  citations: Citation[]
  mediaIds: string[]
  occlusions: OcclusionRect[]
  provenance?: ItemProvenance
  /** Editable named-field projection of the authoritative Workspace v4 note. */
  noteModel?: NoteModelProjection
  /** Namespaced, extension-owned metadata. Extensions must only write their own manifest id. */
  extensionData?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface TrashEntry {
  id: string
  item: KnowledgeItem
  cards: PracticeCard[]
  deletedAt: string
}

export interface StoredFSRSCard extends Omit<FSRSCard, 'due' | 'last_review'> {
  due: string
  last_review?: string
}

/**
 * Scheduler authority carried by the temporary v3/UI projection. This is not
 * a second persisted model: Workspace v4 remains authoritative, and the
 * adapter uses this value to avoid silently replacing imported Anki state
 * during an unrelated UI save.
 */
export interface AnkiCardScheduling {
  strategy: 'anki'
  queue: 'new' | 'learn' | 'review' | 'relearn' | 'preview'
  due: number
  dueAt?: string
  intervalDays: number
  easeFactor: number
  repetitions: number
  lapses: number
  remainingSteps: number
  originalDue?: number
  originalDeckId?: string
  mod: number
  stability?: number
  difficulty?: number
  desiredRetention?: number
  decay?: number
  lastReviewAt?: string
}

export interface NeoFsrsCardScheduling {
  strategy: 'neo-fsrs'
  queue: 'new' | 'learn' | 'review' | 'relearn' | 'preview'
  dueAt: string
  stability: number
  difficulty: number
  elapsedDays: number
  scheduledDays: number
  reps: number
  lapses: number
  state: number
  lastReviewAt?: string
  continuityOverrideDueAt?: string
}

export type CardScheduling = AnkiCardScheduling | NeoFsrsCardScheduling

export interface CardRenderingProjection {
  questionHtml: string
  answerHtml: string
  css: string
  cssRef?: string
  typedAnswer?: { fieldName: string; expected: string }
  source: 'anki-template' | 'neo-native'
}

export interface PracticeCard {
  id: string
  itemId: string
  /** Card-level deck name; siblings may intentionally differ. */
  deckName?: string
  presetId?: string
  schedulerOptions?: {
    desiredRetention: number
    maximumIntervalDays: number
    learningStepsMinutes: number[]
    relearningStepsMinutes: number[]
    newCardsPerDay: number
    reviewsPerDay: number
    buryNewSiblings: boolean
    buryReviewSiblings: boolean
    leechThreshold: number
    leechAction: 'flag' | 'suspend'
  }
  variant: PromptVariant
  occlusionId?: string
  promptData?: Record<string, unknown>
  suspended: boolean
  buriedUntil?: string
  buriedBy?: 'user' | 'scheduler'
  flags?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7
  leech?: boolean
  fsrs: StoredFSRSCard
  /** Exact scheduler state projected from the authoritative v4 card. */
  scheduling?: CardScheduling
  /** Sandboxed, derived rendering view; never persisted as content authority. */
  rendering?: CardRenderingProjection
  estimatedSeconds: number
  createdAt: string
  updatedAt: string
}

export interface ReviewEvent {
  id: string
  /** Originating local device; used only to scope the persisted undo command stack. */
  deviceId?: string
  cardId: string
  rating: ReviewRating
  kind?: ReviewEventKind
  reversesReviewId?: string
  reviewedAt: string
  durationSeconds: number
  rawDurationSeconds?: number
  previousDue: string
  nextDue: string
  previousCard?: StoredFSRSCard
  previousScheduling?: CardScheduling
  scheduler?: 'anki' | 'neo-fsrs'
  previousEstimatedSeconds?: number
  previousCardState?: { suspended: boolean; buriedUntil?: string; buriedBy?: 'user' | 'scheduler'; flags?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7; leech?: boolean }
  siblingChanges?: Array<{ cardId: string; previousBuriedUntil?: string; previousBuriedBy?: 'user' | 'scheduler' }>
}

export interface SavedViewFilter {
  query: string
  collections: string[]
  tags: string[]
  states: CardStateFilter[]
}

export interface SavedView {
  id: string
  name: string
  filter: SavedViewFilter
  sort: ViewSort
  createdAt: string
  updatedAt: string
}

export interface LearningGoal {
  id: string
  name: string
  description: string
  filter: SavedViewFilter
  deadline?: string
  priority: 1 | 2 | 3
  active: boolean
  color: string
  createdAt: string
  updatedAt: string
}

export interface PackManifestItem {
  sourceId: string
  prompt: string
  answer: string
  context: string
  collection: string
  tags: string[]
  citations?: Omit<Citation, 'id'>[]
  cards?: Array<{ id: string; variant: PromptVariant; promptData?: Record<string, unknown>; occlusionId?: string }>
  /** @deprecated Use cards for stable per-card identities and cloze ordinals. */
  variants?: PromptVariant[]
}

export interface PackManifest {
  format: 'neo-anki-pack'
  schemaVersion: 1
  id: string
  name: string
  description: string
  author: string
  version: string
  license: string
  sourceUrl?: string
  items: PackManifestItem[]
}

export type PackPatchChange =
  | { type: 'add'; item: PackManifestItem }
  | { type: 'update'; sourceId: string; item: Partial<Omit<PackManifestItem, 'sourceId'>> }
  | { type: 'delete'; sourceId: string }

export interface PackPatch {
  format: 'neo-anki-patch'
  schemaVersion: 1
  packId: string
  fromVersion: string
  toVersion: string
  changelog: string
  changes: PackPatchChange[]
}

export interface PackSubscription {
  id: string
  packId: string
  name: string
  description: string
  author: string
  installedVersion: string
  license: string
  sourceUrl?: string
  itemMap: Record<string, string>
  baseItems: Record<string, PackManifestItem>
  installedAt: string
  updatedAt: string
}

export interface PackConflict {
  id: string
  packId: string
  sourceItemId: string
  itemId: string
  field: keyof Pick<KnowledgeItem, 'prompt' | 'answer' | 'context' | 'collection' | 'tags' | 'citations'> | '$delete' | '$variants'
  baseValue: unknown
  localValue: unknown
  upstreamValue: unknown
  resolution?: 'local' | 'upstream'
  createdAt: string
}

export interface UserSettings {
  dailyMinutes: number
  retention: number
  theme: Theme
  onboardingComplete: boolean
  recoveryStrategy: RecoveryStrategy
  burySiblings: boolean
  leechThreshold: number
  leechAction: 'flag' | 'suspend'
}

export interface AppData {
  version: 3
  deviceId: string
  items: KnowledgeItem[]
  cards: PracticeCard[]
  /** Deduplicated card CSS keyed by authoritative note-type id. */
  renderingStyles?: Record<string, string>
  reviews: ReviewEvent[]
  assets: MediaAsset[]
  goals: LearningGoal[]
  views: SavedView[]
  packs: PackSubscription[]
  packConflicts: PackConflict[]
  trash: TrashEntry[]
  settings: UserSettings
  updatedAt: string
}

export interface CreateKnowledgeInput {
  prompt: string
  answer: string
  context: string
  collection: string
  tags: string[]
  citations: Omit<Citation, 'id'>[]
  assets: MediaAsset[]
  occlusions: OcclusionRect[]
  variants: PromptVariant[]
}

export interface PlannedCard {
  card: PracticeCard
  reason: 'due' | 'new'
  estimatedSeconds: number
  signalIds: string[]
}

export interface ForecastDay {
  date: string
  label: string
  reviewMinutes: number
  plannedMinutes: number
}

export interface SignalBreakdown {
  signalId: string
  name: string
  count: number
}

export interface DailyPlan {
  budgetSeconds: number
  spentSeconds: number
  remainingSeconds: number
  reviewSeconds: number
  newSeconds: number
  bufferSeconds: number
  dueTotal: number
  duePlanned: number
  newPlanned: number
  deferred: number
  averageReviewSeconds: number
  queue: PlannedCard[]
  forecast: ForecastDay[]
  signalBreakdown: SignalBreakdown[]
  status: 'comfortable' | 'full' | 'recovery'
  recoveryStrategy: RecoveryStrategy
}

export interface SessionRequest {
  minutes: number
  intent: SessionIntent
  focusCollection?: string
  kind?: 'daily' | 'custom'
  /** False means ratings are recorded as practice but scheduling is unchanged. */
  reschedule?: boolean
}

export interface SessionCard extends PlannedCard {
  blockId: string
  blockIndex: number
  contextKey: string
}

export interface SessionBlock {
  id: string
  contextKey: string
  estimatedSeconds: number
  cards: SessionCard[]
}

export interface StudySession {
  request: SessionRequest
  budgetSeconds: number
  plannedSeconds: number
  queue: SessionCard[]
  blocks: SessionBlock[]
  omitted: number
}

export interface ImportSummary {
  source: string
  items: KnowledgeItem[]
  cards: PracticeCard[]
  assets: MediaAsset[]
  warnings: string[]
  /** Workspace v4 import graph. Present only after a lossless compatibility preflight. */
  workspaceDocumentV4?: unknown
  /** Byte-bearing media payloads keyed to the v4 media entity ids. */
  workspaceV4Media?: MediaAsset[]
  workspaceV4SourceArchive?: Uint8Array
  preflight?: {
    operation: 'additive' | 'new-profile' | 'replace-profile'
    sourceSha256?: string
    inventory: Record<string, number>
    fidelity: Array<{
      path: string
      disposition: 'preserved' | 'transformed' | 'reset' | 'unsupported' | 'refused'
      count: number
      detail: string
      requiresAcceptance: boolean
    }>
    projectedDueNow?: number
    warnings?: string[]
    canCommit: boolean
  }
}
