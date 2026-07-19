export type EntityId = string
export type IsoTimestamp = string
export type SourceFormat = 'neo-v3' | 'neo-v4' | 'anki-apkg' | 'anki-colpkg'
export type SchedulerKind = 'anki' | 'neo-fsrs'
export type CardQueue = 'new' | 'learn' | 'review' | 'relearn' | 'preview'
export type ReviewRating = 1 | 2 | 3 | 4

export interface VersionedEntity {
  id: EntityId
  revision: number
  createdAt: IsoTimestamp
  updatedAt: IsoTimestamp
}

export interface WorkspaceProfile extends VersionedEntity {
  name: string
  active: boolean
  sourceEnvelopeId?: EntityId
}

export interface NoteType extends VersionedEntity {
  profileId: EntityId
  name: string
  fieldIds: EntityId[]
  templateIds: EntityId[]
  css: string
  kind: 'standard' | 'cloze'
  sourceEnvelopeId?: EntityId
}

export interface FieldDefinition extends VersionedEntity {
  noteTypeId: EntityId
  name: string
  ordinal: number
  rtl: boolean
  sticky: boolean
  font?: string
  fontSize?: number
}

export interface CardTemplate extends VersionedEntity {
  noteTypeId: EntityId
  name: string
  ordinal: number
  questionFormat: string
  answerFormat: string
  browserQuestionFormat?: string
  browserAnswerFormat?: string
  deckOverrideId?: EntityId
}

export interface Deck extends VersionedEntity {
  profileId: EntityId
  name: string
  parentDeckId?: EntityId
  presetId: EntityId
  sourceEnvelopeId?: EntityId
}

export interface DeckPreset extends VersionedEntity {
  profileId: EntityId
  name: string
  scheduler: SchedulerKind
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
  sourceEnvelopeId?: EntityId
}

export interface Note extends VersionedEntity {
  profileId: EntityId
  noteTypeId: EntityId
  fields: Record<EntityId, string>
  tags: string[]
  marked: boolean
  sourceEnvelopeId?: EntityId
}

export interface AnkiSchedulingState {
  strategy: 'anki'
  queue: CardQueue
  due: number
  intervalDays: number
  easeFactor: number
  repetitions: number
  lapses: number
  remainingSteps: number
  originalDue?: number
  originalDeckId?: EntityId
  /** Exact eligibility instant derived from source queue semantics. */
  dueAt?: IsoTimestamp
  mod: number
  /** Native Anki FSRS memory state, when present in the card data column. */
  stability?: number
  difficulty?: number
  desiredRetention?: number
  decay?: number
  lastReviewAt?: IsoTimestamp
}

export interface NeoFsrsSchedulingState {
  strategy: 'neo-fsrs'
  queue: CardQueue
  dueAt: IsoTimestamp
  stability: number
  difficulty: number
  elapsedDays: number
  scheduledDays: number
  reps: number
  lapses: number
  state: number
  lastReviewAt?: IsoTimestamp
  continuityOverrideDueAt?: IsoTimestamp
}

export type SchedulingState = AnkiSchedulingState | NeoFsrsSchedulingState

export interface FilteredDeckMembership {
  deckId: EntityId
  originalDeckId: EntityId
  originalDue: number
  reschedule: boolean
}

export interface Card extends VersionedEntity {
  profileId: EntityId
  noteId: EntityId
  templateId: EntityId
  deckId: EntityId
  presetId: EntityId
  ordinal: number
  clozeOrdinal?: number
  flags: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7
  suspended: boolean
  leech?: boolean
  buriedUntil?: IsoTimestamp
  buriedBy?: 'user' | 'scheduler'
  filteredDeck?: FilteredDeckMembership
  scheduling: SchedulingState
  sourceEnvelopeId?: EntityId
}

export interface ReviewEvent extends VersionedEntity {
  profileId: EntityId
  cardId: EntityId
  kind: 'review' | 'preview' | 'migration' | 'reversal'
  rating: ReviewRating
  reviewedAt: IsoTimestamp
  durationMilliseconds: number
  intervalBefore: number
  intervalAfter: number
  easeFactor?: number
  scheduler: SchedulerKind
  reversesReviewId?: EntityId
  /** Exact pre/post state makes append-only undo durable across restarts. */
  previousScheduling?: SchedulingState
  nextScheduling?: SchedulingState
  previousEstimatedSeconds?: number
  previousCardState?: { suspended: boolean; buriedUntil?: IsoTimestamp; buriedBy?: 'user' | 'scheduler'; flags?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7; leech?: boolean }
  siblingChanges?: Array<{ cardId: EntityId; previousBuriedUntil?: IsoTimestamp; previousBuriedBy?: 'user' | 'scheduler' }>
  sourceEnvelopeId?: EntityId
}

export interface MediaAsset extends VersionedEntity {
  profileId: EntityId
  filename: string
  mimeType: string
  byteLength: number
  sha256: string
  storageKey: string
  sourceEnvelopeId?: EntityId
}

/** Extension-owned, inert metadata attached to a core entity without granting content mutation. */
export interface ExtensionRecord extends VersionedEntity {
  profileId: EntityId
  extensionId: string
  targetKind: 'note' | 'card' | 'media'
  targetId: EntityId
  value: unknown
}

/** Bounded, inert source data retained solely for rollback and round-trip export. */
export interface SourceEnvelope extends VersionedEntity {
  profileId: EntityId
  format: SourceFormat
  sourceId: string
  schemaVersion: string
  sha256?: string
  opaque: Record<string, unknown>
}

export interface WorkspaceV4 {
  version: 4
  workspaceId: EntityId
  revision: number
  deviceId: string
  createdAt: IsoTimestamp
  updatedAt: IsoTimestamp
  profiles: WorkspaceProfile[]
  noteTypes: NoteType[]
  fields: FieldDefinition[]
  templates: CardTemplate[]
  decks: Deck[]
  presets: DeckPreset[]
  notes: Note[]
  cards: Card[]
  reviews: ReviewEvent[]
  media: MediaAsset[]
  extensionRecords: ExtensionRecord[]
  sourceEnvelopes: SourceEnvelope[]
}

/** Durable v4 payload. Content/scheduling authority lives only in `workspace`. */
export interface WorkspaceDocumentV4 {
  format: 'neo-anki-workspace'
  schemaVersion: 4
  workspace: WorkspaceV4
  clientState: {
    settings: Record<string, unknown>
    goals: unknown[]
    views: unknown[]
    packs: unknown[]
    packConflicts: unknown[]
    trash: unknown[]
    /** Hidden entity identities retained so append-only reviews can reference Trash safely. */
    tombstones?: Array<{ kind: 'note' | 'card'; id: EntityId; deletedAt: IsoTimestamp }>
  }
}

export type WorkspaceEntityKind = 'profile' | 'noteType' | 'field' | 'template' | 'deck' | 'preset' | 'note' | 'card' | 'review' | 'media' | 'extensionRecord' | 'sourceEnvelope'
export type WorkspaceEntity = WorkspaceProfile | NoteType | FieldDefinition | CardTemplate | Deck | DeckPreset | Note | Card | ReviewEvent | MediaAsset | ExtensionRecord | SourceEnvelope

export interface WorkspacePatchOperationV2 {
  op: 'create' | 'update' | 'delete'
  kind: WorkspaceEntityKind
  id: EntityId
  expectedRevision?: number
  value?: WorkspaceEntity
}

export interface WorkspacePatchV2 {
  version: 2
  idempotencyKey: string
  expectedWorkspaceRevision: number
  owner: { type: 'core' } | { type: 'extension'; extensionId: string; scopes: string[] }
  operations: WorkspacePatchOperationV2[]
}

export type MigrationDisposition = 'preserved' | 'transformed' | 'reset' | 'unsupported' | 'refused'
export interface MigrationFidelityRecord {
  path: string
  disposition: MigrationDisposition
  count: number
  detail: string
  requiresAcceptance: boolean
}

export interface ImportPreflight {
  sourceFormat: SourceFormat
  sourceSha256: string
  operation: 'additive' | 'new-profile' | 'replace-profile'
  inventory: Record<string, number>
  fidelity: MigrationFidelityRecord[]
  projectedDueNow?: number
  warnings: string[]
  canCommit: boolean
}

export interface ImportPlan {
  id: string
  preflight: ImportPreflight
  targetProfileId?: EntityId
  acceptedPaths: string[]
  checkpointId: string
  sourceArchiveStorageKey: string
}

export interface ImportCommitResult {
  planId: string
  workspaceRevision: number
  profileId: EntityId
  counts: Record<string, number>
  rollbackCheckpointId: string
  verificationRequired: boolean
}

export interface ExportCompatibilityReport {
  target: 'apkg' | 'colpkg'
  targetAnkiVersion: string
  fidelity: MigrationFidelityRecord[]
  canExport: boolean
}

export interface KnowledgeItemProjection {
  noteId: EntityId
  cardId: EntityId
  prompt: string
  answer: string
  deckName: string
  tags: string[]
  suspended: boolean
  dueAt?: IsoTimestamp
}
