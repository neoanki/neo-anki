import {
  createWorkspaceDocumentV4,
  parseWorkspaceDocumentV4,
  type WorkspaceDocumentV4,
  type WorkspaceEntity,
  type WorkspaceEntityKind,
} from '@neo-anki/compatibility-domain'
import {
  decryptOperation,
  decryptMediaChunk,
  decryptSnapshot,
  decryptSnapshotChunks,
  encryptAndSignOperation,
  encryptMediaChunk,
  encryptSnapshot,
  encryptSnapshotChunks,
  HybridLogicalClock,
  OperationLedger,
  verifyEncryptedOperation,
  type DecryptedEntityOperation,
  type EncryptedEntityOperation,
  type EncryptedSnapshot,
  type EncryptedSnapshotChunk,
  type EncryptedSnapshotManifest,
  type EncryptedMediaChunk,
  type EncryptedMediaManifest,
  type HybridLogicalTimestamp,
  type SyncEntityKind,
  type SyncFieldConflict,
} from '@neo-anki/sync-protocol'

type EntityCollectionKey = 'profiles' | 'noteTypes' | 'fields' | 'templates' | 'decks' | 'presets' | 'notes' | 'cards' | 'reviews' | 'media' | 'extensionRecords' | 'sourceEnvelopes'
const entityCollections: Array<[WorkspaceEntityKind, EntityCollectionKey]> = [
  ['profile', 'profiles'], ['noteType', 'noteTypes'], ['field', 'fields'], ['template', 'templates'], ['deck', 'decks'], ['preset', 'presets'],
  ['note', 'notes'], ['card', 'cards'], ['review', 'reviews'], ['media', 'media'], ['extensionRecord', 'extensionRecords'], ['sourceEnvelope', 'sourceEnvelopes'],
]
const entityKey = (kind: string, id: string) => `${kind}:${id}`
const stableValue = (value: unknown): unknown => Array.isArray(value) ? value.map(stableValue) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, stableValue(entry)])) : value
const same = (left: unknown, right: unknown) => JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right))
const sameEntity = (left: WorkspaceEntity | undefined, right: WorkspaceEntity, kind: WorkspaceEntityKind) => {
  if (!left) return false
  if (kind !== 'note') return same(left, right)
  const normalized = (value: WorkspaceEntity) => ({ ...value, tags: [...((value as WorkspaceEntity & { tags?: string[] }).tags || [])].sort() })
  return same(normalized(left), normalized(right))
}
const canonicalClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const clientStateFields = (clientState: WorkspaceDocumentV4['clientState']) => ({
  settings: canonicalClone(clientState.settings),
  goals: canonicalClone(clientState.goals),
  views: canonicalClone(clientState.views),
  packs: canonicalClone(clientState.packs),
  packConflicts: canonicalClone(clientState.packConflicts),
  trash: canonicalClone(clientState.trash),
  tombstones: canonicalClone(clientState.tombstones || []),
})
const fieldsWithoutTags = (entity: WorkspaceEntity, kind?: WorkspaceEntityKind) => {
  const value = canonicalClone(entity) as WorkspaceEntity & { tags?: string[] }
  delete value.tags
  if (kind === 'note' && 'fields' in value) {
    const namedFields = (value as WorkspaceEntity & { fields: Record<string, string> }).fields
    delete (value as unknown as { fields?: unknown }).fields
    for (const [fieldId, fieldValue] of Object.entries(namedFields)) (value as unknown as Record<string, unknown>)[`$field:${fieldId}`] = fieldValue
  }
  return value as unknown as Record<string, unknown>
}
const changedFields = (before: Record<string, unknown> | undefined, after: Record<string, unknown>) => ({
  fields: Object.fromEntries(Object.entries(after).filter(([key, value]) => !before || !same(before[key], value))),
  deleted: before ? Object.keys(before).filter((key) => !(key in after)) : [],
  bases: Object.fromEntries([...Object.entries(after).filter(([key, value]) => !before || !same(before[key], value)).map(([key]) => [key, before && Object.prototype.hasOwnProperty.call(before, key) ? { present: true, value: canonicalClone(before[key]) } : { present: false }]), ...(before ? Object.keys(before).filter((key) => !(key in after)).map((key) => [key, { present: true, value: canonicalClone(before[key]) }] as const) : [])]),
})

export interface LocalSyncOperation { header: { protocol: 1; actorId: string; sequence: number; timestamp: HybridLogicalTimestamp; idempotencyKey: string; entityKind: SyncEntityKind; entityId: string; action: DecryptedEntityOperation['action'] }; operation: DecryptedEntityOperation }
export interface EncryptedSyncTransport {
  push(operations: EncryptedEntityOperation[]): Promise<Record<string, number>>
  pull(after: Record<string, number>, limit?: number): Promise<{ operations: EncryptedEntityOperation[]; cursor: Record<string, number>; compactionFloor?: Record<string, number>; latestSnapshot?: EncryptedSnapshot; latestSnapshotManifest?: EncryptedSnapshotManifest }>
  /** Called only after the returned cursor has been authenticated, applied, and persisted in memory. */
  acknowledge?(cursor: Record<string, number>): Promise<void>
  devicePublicKey(actorId: string): Promise<CryptoKey>
  putSnapshot?(snapshot: EncryptedSnapshot): Promise<void>
  putSnapshotChunk?(chunk: EncryptedSnapshotChunk): Promise<void>
  commitSnapshotManifest?(manifest: EncryptedSnapshotManifest): Promise<void>
  getSnapshotChunk?(snapshotId: string, index: number): Promise<EncryptedSnapshotChunk | null>
}
export interface PortableSyncClientState { version: 1; nextSequence: number; cursor: Record<string, number>; outbox: EncryptedEntityOperation[]; snapshotCursor?: Record<string, number>; conflicts?: SyncFieldConflict[] }
export interface EncryptedMediaTransport {
  putMediaChunk(chunk: EncryptedMediaChunk): Promise<void>
  commitMediaManifest(manifest: EncryptedMediaManifest): Promise<void>
  getMediaChunk(mediaId: string, index: number): Promise<EncryptedMediaChunk | null>
}
export interface SyncMediaInput { id: string; sha256: string; byteLength: number; bytes: Uint8Array }
const SYNC_MEDIA_CHUNK_BYTES = 1024 * 1024
const hex = (bytes: Uint8Array) => [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')

const collectionForKind = Object.fromEntries(entityCollections) as Record<WorkspaceEntityKind, EntityCollectionKey>

/** Applies a user's explicit conflict choice to a fresh Workspace v4 revision. */
export const applySyncConflictResolution = (input: WorkspaceDocumentV4, conflict: SyncFieldConflict, choice: 'existing' | 'incoming') => {
  const document = structuredClone(input); const selected = conflict[choice]; const now = new Date().toISOString()
  if (conflict.entityKind === 'clientState') {
    if (conflict.field === 'clientState') {
      if (!selected.present || !selected.value || typeof selected.value !== 'object') throw new Error('Synchronized client settings cannot be removed.')
      document.clientState = structuredClone(selected.value) as WorkspaceDocumentV4['clientState']
    } else if (['settings', 'goals', 'views', 'packs', 'packConflicts', 'trash', 'tombstones'].includes(conflict.field)) {
      if (!selected.present) throw new Error(`Synchronized client state ${conflict.field} cannot be removed.`)
      ;(document.clientState as unknown as Record<string, unknown>)[conflict.field] = structuredClone(selected.value)
    } else if (['deviceId', 'createdAt', 'updatedAt', 'workspaceRevision'].includes(conflict.field)) {
      if (!selected.present) throw new Error('Required workspace metadata cannot be removed.')
      const target = conflict.field === 'workspaceRevision' ? 'revision' : conflict.field
      ;(document.workspace as unknown as Record<string, unknown>)[target] = structuredClone(selected.value)
    } else throw new Error(`Unsupported synchronized metadata conflict ${conflict.field}.`)
  } else {
    const collection = collectionForKind[conflict.entityKind as WorkspaceEntityKind]
    if (!collection) throw new Error(`Unsupported synchronized conflict kind ${conflict.entityKind}.`)
    const entity = (document.workspace[collection] as unknown as WorkspaceEntity[]).find((value) => value.id === conflict.entityId) as WorkspaceEntity & { fields?: Record<string, string>; revision: number; updatedAt: string } | undefined
    if (!entity) throw new Error('The conflicted entity no longer exists.')
    if (conflict.entityKind === 'note' && conflict.field.startsWith('$field:')) {
      const fieldId = conflict.field.slice(7); if (!fieldId) throw new Error('The conflicted note field is invalid.')
      if (selected.present) entity.fields![fieldId] = String(selected.value ?? ''); else delete entity.fields![fieldId]
    } else {
      if (['id', 'profileId', 'createdAt'].includes(conflict.field)) throw new Error('Immutable entity identity cannot be resolved through sync UI.')
      if (selected.present) (entity as unknown as Record<string, unknown>)[conflict.field] = structuredClone(selected.value)
      else delete (entity as unknown as Record<string, unknown>)[conflict.field]
    }
    entity.revision += 1; entity.updatedAt = now
  }
  document.workspace.revision += 1; document.workspace.updatedAt = now
  return parseWorkspaceDocumentV4(document)
}

export const uploadEncryptedMedia = async (key: CryptoKey, transport: EncryptedMediaTransport, media: SyncMediaInput) => {
  if (media.bytes.byteLength !== media.byteLength || hex(new Uint8Array(await crypto.subtle.digest('SHA-256', media.bytes))) !== media.sha256) throw new Error(`Media ${media.id} failed its local integrity check before sync.`)
  const chunks = Math.ceil(media.byteLength / SYNC_MEDIA_CHUNK_BYTES)
  const identity = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ mediaId: media.id, sha256: media.sha256, byteLength: media.byteLength, chunkBytes: SYNC_MEDIA_CHUNK_BYTES }))))
  let binary = ''; for (const byte of identity) binary += String.fromCharCode(byte)
  // Keep content-derived upload ids inside the service identifier grammar even
  // when the base64url digest would otherwise start with "-" or "_".
  const uploadId = `upload-${btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')}`
  for (let index = 0; index < chunks; index += 1) await transport.putMediaChunk(await encryptMediaChunk(key, media.id, index, media.bytes.slice(index * SYNC_MEDIA_CHUNK_BYTES, (index + 1) * SYNC_MEDIA_CHUNK_BYTES), uploadId))
  await transport.commitMediaManifest({ protocol: 1, format: 'chunked-v1', mediaId: media.id, uploadId, plaintextBytes: media.byteLength, chunkBytes: SYNC_MEDIA_CHUNK_BYTES, chunkCount: chunks })
  return chunks
}

export const downloadEncryptedMedia = async (key: CryptoKey, transport: EncryptedMediaTransport, descriptor: Omit<SyncMediaInput, 'bytes'>) => {
  const chunks = Math.ceil(descriptor.byteLength / SYNC_MEDIA_CHUNK_BYTES); const output = new Uint8Array(descriptor.byteLength); let offset = 0
  for (let index = 0; index < chunks; index += 1) {
    const encrypted = await transport.getMediaChunk(descriptor.id, index)
    if (!encrypted) throw new Error(`Media ${descriptor.id} is incomplete at chunk ${index}.`)
    const bytes = await decryptMediaChunk(key, encrypted); if (offset + bytes.byteLength > output.byteLength) throw new Error(`Media ${descriptor.id} exceeds its declared length.`)
    output.set(bytes, offset); offset += bytes.byteLength
  }
  if (offset !== descriptor.byteLength || hex(new Uint8Array(await crypto.subtle.digest('SHA-256', output))) !== descriptor.sha256) throw new Error(`Media ${descriptor.id} failed its downloaded integrity check.`)
  return output
}

/** Converts a Workspace v4 graph to entity operations and rebuilds only after a complete batch, so referential invariants are never checked mid-transaction. */
export class WorkspaceSyncReplica {
  private ledger = new OperationLedger()
  private ids = new Set<string>()
  private bootstrapSequence = 0

  constructor(document: WorkspaceDocumentV4) { this.seed(document) }

  private applyBootstrap(operation: DecryptedEntityOperation, updatedAt: string) {
    this.bootstrapSequence += 1
    this.ledger.apply({ actorId: 'bootstrap', sequence: this.bootstrapSequence, timestamp: { wallTime: Math.max(0, Date.parse(updatedAt) || 0), counter: this.bootstrapSequence, actorId: 'bootstrap' }, idempotencyKey: `bootstrap:${this.bootstrapSequence}` }, operation)
    this.ids.add(entityKey(operation.entityKind, operation.entityId))
  }

  private seed(document: WorkspaceDocumentV4) {
    for (const [kind, collection] of entityCollections) for (const entity of document.workspace[collection] as unknown as WorkspaceEntity[]) {
      const note = kind === 'note' ? entity as WorkspaceEntity & { tags: string[] } : undefined
      this.applyBootstrap({ action: 'upsert', entityKind: kind, entityId: entity.id, fields: fieldsWithoutTags(entity, kind), tagsAdded: note?.tags }, entity.updatedAt)
    }
    this.applyBootstrap({ action: 'upsert', entityKind: 'clientState', entityId: document.workspace.workspaceId, fields: {
      ...clientStateFields(document.clientState), workspaceRevision: document.workspace.revision, deviceId: document.workspace.deviceId,
      createdAt: document.workspace.createdAt, updatedAt: document.workspace.updatedAt,
    } }, document.workspace.updatedAt)
  }

  createLocalOperations(next: WorkspaceDocumentV4, actorId: string, firstSequence: number, clock: Pick<HybridLogicalClock, 'tick'>, resolvesConflicts: string[] = []): LocalSyncOperation[] {
    const previous = this.document()
    const result: LocalSyncOperation[] = []
    let sequence = firstSequence
    const append = (operation: DecryptedEntityOperation) => {
      const timestamp = clock.tick()
      const header = { protocol: 1 as const, actorId, sequence, timestamp, idempotencyKey: `${actorId}:${sequence}`, entityKind: operation.entityKind, entityId: operation.entityId, action: operation.action }
      result.push({ header, operation }); sequence += 1
    }
    for (const [kind, collection] of entityCollections) {
      const before = new Map((previous.workspace[collection] as unknown as WorkspaceEntity[]).map((entity) => [entity.id, entity]))
      const after = new Map((next.workspace[collection] as unknown as WorkspaceEntity[]).map((entity) => [entity.id, entity]))
      for (const [id, entity] of after) {
        const old = before.get(id)
        if (sameEntity(old, entity, kind)) continue
        const newFields = fieldsWithoutTags(entity, kind)
        const oldFields = old ? fieldsWithoutTags(old, kind) : undefined
        const changes = changedFields(oldFields, newFields)
        const operation: DecryptedEntityOperation = { action: !old && this.ledger.hasTombstone(kind, id) ? 'restore' : 'upsert', entityKind: kind, entityId: id, fields: changes.fields, fieldsDeleted: changes.deleted, fieldBases: changes.bases }
        if (kind === 'note') {
          const oldTags = new Set((old as WorkspaceEntity & { tags?: string[] } | undefined)?.tags || [])
          const newTags = new Set((entity as WorkspaceEntity & { tags?: string[] }).tags || [])
          operation.tagsAdded = [...newTags].filter((tag) => !oldTags.has(tag)); operation.tagsRemoved = [...oldTags].filter((tag) => !newTags.has(tag))
        }
        append(operation)
      }
      for (const id of before.keys()) if (!after.has(id)) append({ action: 'delete', entityKind: kind, entityId: id })
    }
    const oldMeta = { ...clientStateFields(previous.clientState), workspaceRevision: previous.workspace.revision, deviceId: previous.workspace.deviceId, createdAt: previous.workspace.createdAt, updatedAt: previous.workspace.updatedAt }
    const newMeta = { ...clientStateFields(next.clientState), workspaceRevision: next.workspace.revision, deviceId: next.workspace.deviceId, createdAt: next.workspace.createdAt, updatedAt: next.workspace.updatedAt }
    if (!same(oldMeta, newMeta)) { const changes = changedFields(oldMeta, newMeta); append({ action: 'upsert', entityKind: 'clientState', entityId: next.workspace.workspaceId, fields: changes.fields, fieldsDeleted: changes.deleted, fieldBases: changes.bases }) }
    if (resolvesConflicts.length) {
      if (result.length) result[0].operation.resolvesConflicts = [...resolvesConflicts]
      else append({ action: 'upsert', entityKind: 'clientState', entityId: next.workspace.workspaceId, fields: {}, resolvesConflicts: [...resolvesConflicts] })
    }
    return result
  }

  applyBatch(values: Array<{ envelope: Pick<EncryptedEntityOperation, 'actorId' | 'sequence' | 'timestamp' | 'idempotencyKey'>; operation: DecryptedEntityOperation }>) {
    const previous = this.ledger
    const staged = previous.clone()
    const stagedIds = new Set(this.ids)
    this.ledger = staged
    try {
    for (const value of values) {
      this.ledger.apply(value.envelope, value.operation)
      stagedIds.add(entityKey(value.operation.entityKind, value.operation.entityId))
    }
      const document = this.document()
      this.ids = stagedIds
      return document
    } catch (error) {
      this.ledger = previous
      throw error
    }
  }

  conflicts() { return this.ledger.conflicts() }

  document(): WorkspaceDocumentV4 {
    const state = this.ledger.entries('clientState').find((entry) => !entry.deleted)?.value as ({ clientState?: WorkspaceDocumentV4['clientState']; workspaceRevision: number; deviceId: string; createdAt: string; updatedAt: string } & Partial<WorkspaceDocumentV4['clientState']>) | undefined
    if (!state) throw new Error('Synchronized workspace metadata is missing.')
    const collections = Object.fromEntries(entityCollections.map(([kind, key]) => [key, this.ledger.entries(kind).filter((entry) => !entry.deleted).map((entry) => {
      const value = structuredClone(entry.value || {}) as Record<string, unknown>
      if (kind === 'note') {
        const namedFields = Object.fromEntries(Object.entries(value).filter(([name]) => name.startsWith('$field:')).map(([name, fieldValue]) => [name.slice(7), fieldValue]))
        for (const name of Object.keys(value)) if (name.startsWith('$field:')) delete value[name]
        value.fields = namedFields
        if (!Array.isArray(value.tags)) value.tags = []
      }
      return value
    })])) as unknown as Pick<WorkspaceDocumentV4['workspace'], EntityCollectionKey>
    collections.reviews.sort((left, right) => Date.parse(left.reviewedAt) - Date.parse(right.reviewedAt) || left.id.localeCompare(right.id))
    const clientEntry = this.ledger.entries('clientState').find((entry) => entry.id && !entry.deleted)
    const workspaceId = clientEntry?.id
    if (!workspaceId) throw new Error('Synchronized workspace id is missing.')
    const clientState = state.clientState || {
      settings: state.settings || {}, goals: state.goals || [], views: state.views || [], packs: state.packs || [],
      packConflicts: state.packConflicts || [], trash: state.trash || [], tombstones: state.tombstones || [],
    }
    return createWorkspaceDocumentV4({ version: 4, workspaceId, revision: Number(state.workspaceRevision), deviceId: String(state.deviceId), createdAt: String(state.createdAt), updatedAt: String(state.updatedAt), ...collections }, structuredClone(clientState))
  }
}

/** Durable offline outbox + authenticated pull loop. Persist `state()` beside the local encrypted key material after every capture/sync. */
export class EncryptedWorkspaceSyncClient {
  replica: WorkspaceSyncReplica
  private clock: HybridLogicalClock
  private nextSequence: number
  private cursor: Record<string, number>
  private outbox: EncryptedEntityOperation[]
  private snapshotCursor?: Record<string, number>
  private conflicts: SyncFieldConflict[]

  constructor(
    document: WorkspaceDocumentV4,
    readonly actorId: string,
    private readonly accountKey: CryptoKey,
    private readonly signingPrivateKey: CryptoKey,
    private readonly transport: EncryptedSyncTransport,
    state: PortableSyncClientState = { version: 1, nextSequence: 1, cursor: {}, outbox: [] },
  ) {
    if (state.version !== 1 || !Number.isSafeInteger(state.nextSequence) || state.nextSequence < 1) throw new Error('Persisted sync client state is invalid.')
    this.replica = new WorkspaceSyncReplica(document); this.clock = new HybridLogicalClock(actorId); this.nextSequence = state.nextSequence
    this.cursor = structuredClone(state.cursor); this.outbox = structuredClone(state.outbox); this.snapshotCursor = structuredClone(state.snapshotCursor); this.conflicts = structuredClone(state.conflicts || [])
  }

  async capture(document: WorkspaceDocumentV4, resolvesConflicts: string[] = []) {
    const local = this.replica.createLocalOperations(document, this.actorId, this.nextSequence, this.clock, resolvesConflicts)
    const encrypted: EncryptedEntityOperation[] = []
    for (const value of local) encrypted.push(await encryptAndSignOperation(this.accountKey, this.signingPrivateKey, value.header, value.operation))
    this.replica.applyBatch(local.map(({ header, operation }) => ({ envelope: header, operation })))
    if (resolvesConflicts.length) { const resolved = new Set(resolvesConflicts); this.conflicts = this.conflicts.filter((value) => !resolved.has(value.id)) }
    this.nextSequence += local.length; this.outbox.push(...encrypted)
    return encrypted.length
  }

  async synchronize(limit = 10_000) {
    let sent = 0
    while (sent < this.outbox.length) {
      const batch = this.outbox.slice(sent, sent + 2_000)
      await this.transport.push(batch)
      sent += batch.length
    }
    if (sent) this.outbox.splice(0, sent)
    let received = 0
    let pullCursor = structuredClone(this.cursor)
    let workingReplica = this.replica
    const pending: Array<{ envelope: EncryptedEntityOperation; operation: DecryptedEntityOperation }> = []
    while (true) {
      const page = await this.transport.pull(pullCursor, limit)
      const manifest = page.latestSnapshotManifest
      const behindCompaction = Object.entries(page.compactionFloor || {}).some(([actorId, sequence]) => (pullCursor[actorId] || 0) < sequence)
      if ((!Object.keys(pullCursor).length || behindCompaction) && (manifest || page.latestSnapshot)) {
        let snapshotBytes: Uint8Array
        let snapshotWorkspaceId: string
        let snapshotThrough: Record<string, number>
        if (manifest) {
          if (!this.transport.getSnapshotChunk) throw new Error('Sync transport cannot download chunked bootstrap snapshots.')
          const chunks: EncryptedSnapshotChunk[] = []
          for (let index = 0; index < manifest.chunkCount; index += 1) {
            const chunk = await this.transport.getSnapshotChunk(manifest.snapshotId, index)
            if (!chunk) throw new Error(`Encrypted bootstrap snapshot is incomplete at chunk ${index}.`)
            chunks.push(chunk)
          }
          snapshotBytes = await decryptSnapshotChunks(this.accountKey, manifest, chunks); snapshotWorkspaceId = manifest.workspaceId; snapshotThrough = manifest.through
        } else {
          snapshotBytes = await decryptSnapshot(this.accountKey, page.latestSnapshot!); snapshotWorkspaceId = page.latestSnapshot!.workspaceId; snapshotThrough = page.latestSnapshot!.through
        }
        const snapshotDocument = parseWorkspaceDocumentV4(JSON.parse(new TextDecoder().decode(snapshotBytes)))
        if (snapshotDocument.workspace.workspaceId !== snapshotWorkspaceId) throw new Error('Encrypted bootstrap snapshot belongs to another workspace.')
        workingReplica = new WorkspaceSyncReplica(snapshotDocument)
        pullCursor = structuredClone(snapshotThrough)
        pending.length = 0
      } else if (behindCompaction) {
        throw new Error('The sync operation history was compacted, but no encrypted bootstrap snapshot is available.')
      }
      const decrypted: Array<{ envelope: EncryptedEntityOperation; operation: DecryptedEntityOperation }> = []
      for (const envelope of page.operations) {
        if (envelope.sequence <= (pullCursor[envelope.actorId] || 0)) continue
        const publicKey = await this.transport.devicePublicKey(envelope.actorId)
        if (!await verifyEncryptedOperation(publicKey, envelope)) throw new Error(`Sync operation ${envelope.idempotencyKey} failed device signature verification.`)
        decrypted.push({ envelope, operation: await decryptOperation(this.accountKey, envelope) })
        this.clock.receive(envelope.timestamp)
      }
      pending.push(...decrypted)
      for (const [actorId, sequence] of Object.entries(page.cursor)) pullCursor[actorId] = Math.max(pullCursor[actorId] || 0, sequence)
      received += decrypted.length
      if (page.operations.length < limit) break
    }
    if (pending.length) workingReplica.applyBatch(pending)
    this.replica = workingReplica
    this.cursor = pullCursor
    if (pending.length) {
      const resolved = new Set(pending.flatMap(({ operation }) => operation.resolvesConflicts || [])); if (resolved.size) this.conflicts = this.conflicts.filter((value) => !resolved.has(value.id))
      const known = new Set(this.conflicts.map((value) => value.id)); for (const conflict of this.replica.conflicts()) if (!known.has(conflict.id)) this.conflicts.push(conflict)
    }
    const document = this.replica.document()
    if ((this.transport.putSnapshot || (this.transport.putSnapshotChunk && this.transport.commitSnapshotManifest)) && (sent || received || !this.snapshotCursor)) {
      const plaintext = new TextEncoder().encode(JSON.stringify(document))
      if (this.transport.putSnapshotChunk && this.transport.commitSnapshotManifest) {
        const snapshot = await encryptSnapshotChunks(this.accountKey, document.workspace.workspaceId, this.cursor, plaintext)
        for (const chunk of snapshot.chunks) await this.transport.putSnapshotChunk(chunk)
        await this.transport.commitSnapshotManifest(snapshot.manifest)
      } else {
        await this.transport.putSnapshot!(await encryptSnapshot(this.accountKey, document.workspace.workspaceId, this.cursor, plaintext))
      }
      this.snapshotCursor = structuredClone(this.cursor)
    }
    return { sent, received, document }
  }

  /** Invoke after state() and the synchronized document have been durably stored by the host. */
  async acknowledge() { await this.transport.acknowledge?.(this.cursor) }

  conflictRecords() { return structuredClone(this.conflicts) }
  dismissConflict(id: string) { this.conflicts = this.conflicts.filter((value) => value.id !== id) }

  state(): PortableSyncClientState { return { version: 1, nextSequence: this.nextSequence, cursor: structuredClone(this.cursor), outbox: structuredClone(this.outbox), snapshotCursor: structuredClone(this.snapshotCursor), conflicts: structuredClone(this.conflicts) } }
}
