import type { Card as FSRSCard } from 'ts-fsrs'

export type Route = string
export type Theme = 'light' | 'dark'
export type PromptVariant = string
export type ReviewRating = 1 | 2 | 3
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
  createdAt: string
  updatedAt: string
}

export interface StoredFSRSCard extends Omit<FSRSCard, 'due' | 'last_review'> {
  due: string
  last_review?: string
}

export interface PracticeCard {
  id: string
  itemId: string
  variant: PromptVariant
  occlusionId?: string
  suspended: boolean
  fsrs: StoredFSRSCard
  estimatedSeconds: number
  createdAt: string
  updatedAt: string
}

export interface ReviewEvent {
  id: string
  cardId: string
  rating: ReviewRating
  reviewedAt: string
  durationSeconds: number
  previousDue: string
  nextDue: string
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
  field: keyof Pick<KnowledgeItem, 'prompt' | 'answer' | 'context' | 'collection' | 'tags' | 'citations'> | '$delete'
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
}

export interface AppData {
  version: 2
  deviceId: string
  items: KnowledgeItem[]
  cards: PracticeCard[]
  reviews: ReviewEvent[]
  assets: MediaAsset[]
  goals: LearningGoal[]
  views: SavedView[]
  packs: PackSubscription[]
  packConflicts: PackConflict[]
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
}
