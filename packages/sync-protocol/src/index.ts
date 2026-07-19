export type SyncEntityKind = 'profile' | 'noteType' | 'field' | 'template' | 'deck' | 'preset' | 'note' | 'card' | 'review' | 'media' | 'extensionRecord' | 'sourceEnvelope' | 'clientState'
export interface HybridLogicalTimestamp { wallTime: number; counter: number; actorId: string }
export interface DecryptedEntityOperation {
  action: 'upsert' | 'delete' | 'restore'
  entityKind: SyncEntityKind
  entityId: string
  fields?: Record<string, unknown>
  fieldsDeleted?: string[]
  /** Previous values observed by the editor, encrypted with the operation, for meaningful concurrent-edit detection. */
  fieldBases?: Record<string, { present: boolean; value?: unknown }>
  /** Canonical concurrent-edit records explicitly resolved by the user. */
  resolvesConflicts?: string[]
  tagsAdded?: string[]
  tagsRemoved?: string[]
}
export interface SyncFieldConflict {
  id: string
  entityKind: SyncEntityKind
  entityId: string
  field: string
  base: { present: boolean; value?: unknown }
  existing: { present: boolean; value?: unknown }
  incoming: { present: boolean; value?: unknown }
  winner: 'existing' | 'incoming'
  incomingActorId: string
  incomingSequence: number
  detectedAt: string
}
export interface EncryptedEntityOperation {
  protocol: 1; actorId: string; sequence: number; timestamp: HybridLogicalTimestamp; idempotencyKey: string
  entityKind: SyncEntityKind; entityId: string; action: DecryptedEntityOperation['action']
  nonce: string; ciphertext: string; signature: string
}
export interface EncryptedSnapshot { protocol: 1; workspaceId: string; through: Record<string, number>; nonce: string; ciphertext: string; sha256: string }
export interface EncryptedSnapshotManifest {
  protocol: 1
  format: 'chunked-v1'
  snapshotId: string
  workspaceId: string
  through: Record<string, number>
  sha256: string
  plaintextBytes: number
  chunkBytes: number
  chunkCount: number
}
export interface EncryptedSnapshotChunk { protocol: 1; snapshotId: string; index: number; nonce: string; ciphertext: string; plaintextBytes: number }
export interface EncryptedMediaDescriptor { id: string; sha256: string; byteLength: number; chunkBytes: number; completedChunks: number[] }
export interface EncryptedMediaManifest { protocol: 1; format: 'chunked-v1'; mediaId: string; uploadId: string; plaintextBytes: number; chunkBytes: number; chunkCount: number }

export interface DeviceSigningKeys { publicKey: CryptoKey; privateKey: CryptoKey }
export interface PortableAccountKey { version: 1; algorithm: 'AES-GCM-256'; key: string }
export interface EncryptedMediaChunk { protocol: 1; mediaId: string; uploadId: string; index: number; nonce: string; ciphertext: string; plaintextBytes: number }

const MAX_OPERATION_BYTES = 8 * 1024 * 1024
const MAX_FIELDS = 2_000
const MAX_TAGS = 10_000
const MAX_CONFLICT_RESOLUTIONS = 100
const ACTOR_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
const base64ToBytes = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
const webCryptoBytes = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}
const additionalData = (header: Omit<EncryptedEntityOperation, 'nonce' | 'ciphertext' | 'signature'>) => new TextEncoder().encode(JSON.stringify(header))
const operationSigningBytes = (operation: Omit<EncryptedEntityOperation, 'signature'>) => new TextEncoder().encode(JSON.stringify(operation))
const snapshotAdditionalData = (snapshot: Pick<EncryptedSnapshot, 'protocol' | 'workspaceId' | 'through' | 'sha256'>) => new TextEncoder().encode(JSON.stringify(snapshot))
const snapshotChunkAdditionalData = (manifest: EncryptedSnapshotManifest, index: number, plaintextBytes: number) => new TextEncoder().encode(JSON.stringify({ ...manifest, index, plaintextBytes }))
const mediaAdditionalData = (mediaId: string, uploadId: string, index: number, plaintextBytes: number) => new TextEncoder().encode(JSON.stringify({ protocol: 1, mediaId, uploadId, index, plaintextBytes }))

const assertId = (value: string, label: string) => { if (!value || value.length > 256 || [...value].some((character) => { const code = character.codePointAt(0) || 0; return code < 32 || code === 127 })) throw new Error(`${label} is invalid.`) }
const assertConflictId = (value: string) => { if (!value || value.length > 4096 || [...value].some((character) => { const code = character.codePointAt(0) || 0; return code < 32 || code === 127 })) throw new Error('Sync conflict id is invalid.') }
const assertActorId = (value: string, label: string) => { if (!ACTOR_ID.test(value)) throw new Error(`${label} is invalid.`) }
const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength

export const validateDecryptedOperation = (operation: DecryptedEntityOperation) => {
  assertId(operation.entityId, 'Sync entity id')
  if (!['upsert', 'delete', 'restore'].includes(operation.action)) throw new Error('Sync operation action is invalid.')
  if (operation.action === 'delete' && (operation.fields || operation.fieldsDeleted || operation.fieldBases || operation.tagsAdded || operation.tagsRemoved || operation.resolvesConflicts)) throw new Error('Delete operations cannot carry fields, tags, or conflict resolutions.')
  if (Object.keys(operation.fields || {}).length + (operation.fieldsDeleted?.length || 0) > MAX_FIELDS) throw new Error(`A sync operation may update at most ${MAX_FIELDS} fields.`)
  if (new Set(operation.fieldsDeleted || []).size !== (operation.fieldsDeleted?.length || 0) || (operation.fieldsDeleted || []).some((field) => !field || field.length > 500 || field in (operation.fields || {}))) throw new Error('Deleted sync fields are invalid or duplicated.')
  const changedFieldNames = new Set([...Object.keys(operation.fields || {}), ...(operation.fieldsDeleted || [])])
  if (Object.keys(operation.fieldBases || {}).some((field) => !changedFieldNames.has(field))) throw new Error('Sync field bases may describe only changed fields.')
  for (const [field, base] of Object.entries(operation.fieldBases || {})) if (!field || field.length > 500 || !base || typeof base.present !== 'boolean' || (!base.present && 'value' in base)) throw new Error('Sync field base is invalid.')
  if ((operation.tagsAdded?.length || 0) + (operation.tagsRemoved?.length || 0) > MAX_TAGS) throw new Error(`A sync operation may change at most ${MAX_TAGS} tags.`)
  for (const tag of [...(operation.tagsAdded || []), ...(operation.tagsRemoved || [])]) if (!tag || tag.length > 500) throw new Error('Sync tags must contain 1–500 characters.')
  if (new Set(operation.tagsAdded || []).size !== (operation.tagsAdded?.length || 0) || new Set(operation.tagsRemoved || []).size !== (operation.tagsRemoved?.length || 0)) throw new Error('Sync tag operations cannot contain duplicates.')
  if ((operation.tagsAdded || []).some((tag) => operation.tagsRemoved?.includes(tag))) throw new Error('A sync operation cannot add and remove the same tag.')
  if ((operation.resolvesConflicts?.length || 0) > MAX_CONFLICT_RESOLUTIONS || new Set(operation.resolvesConflicts || []).size !== (operation.resolvesConflicts?.length || 0)) throw new Error(`A sync operation may resolve at most ${MAX_CONFLICT_RESOLUTIONS} unique conflicts.`)
  for (const id of operation.resolvesConflicts || []) assertConflictId(id)
  if (jsonBytes(operation) > MAX_OPERATION_BYTES) throw new Error('Decrypted sync operation exceeds 8 MiB.')
  return operation
}

export const validateEncryptedOperation = (operation: EncryptedEntityOperation, requireSignature = true) => {
  if (operation.protocol !== 1) throw new Error('Unsupported sync protocol version.')
  assertActorId(operation.actorId, 'Sync actor id'); assertId(operation.entityId, 'Sync entity id'); assertActorId(operation.idempotencyKey, 'Sync idempotency key')
  if (!Number.isSafeInteger(operation.sequence) || operation.sequence < 1) throw new Error('Sync sequence must be a positive safe integer.')
  if (!Number.isSafeInteger(operation.timestamp.wallTime) || operation.timestamp.wallTime < 0 || !Number.isSafeInteger(operation.timestamp.counter) || operation.timestamp.counter < 0 || operation.timestamp.actorId !== operation.actorId) throw new Error('Sync hybrid timestamp is invalid.')
  if (requireSignature && !operation.signature) throw new Error('Sync operation is not signed.')
  if (base64ToBytes(operation.nonce).byteLength !== 12) throw new Error('Sync operation nonce is invalid.')
  if (jsonBytes(operation) > MAX_OPERATION_BYTES * 2) throw new Error('Encrypted sync operation exceeds its transport limit.')
  return operation
}

export const compareHybridTimestamp = (left: HybridLogicalTimestamp, right: HybridLogicalTimestamp) => left.wallTime - right.wallTime || left.counter - right.counter || left.actorId.localeCompare(right.actorId)

export class HybridLogicalClock {
  private last: HybridLogicalTimestamp
  constructor(readonly actorId: string, initialWallTime = 0) { this.last = { wallTime: initialWallTime, counter: 0, actorId } }
  tick(now = Date.now()) {
    this.last = now > this.last.wallTime ? { wallTime: now, counter: 0, actorId: this.actorId } : { wallTime: this.last.wallTime, counter: this.last.counter + 1, actorId: this.actorId }
    return { ...this.last }
  }
  receive(remote: HybridLogicalTimestamp, now = Date.now()) {
    if (remote.wallTime > now + 24 * 60 * 60 * 1000) throw new Error('Remote sync clock is more than 24 hours in the future.')
    const wallTime = Math.max(now, this.last.wallTime, remote.wallTime)
    const counter = wallTime === this.last.wallTime && wallTime === remote.wallTime ? Math.max(this.last.counter, remote.counter) + 1 : wallTime === this.last.wallTime ? this.last.counter + 1 : wallTime === remote.wallTime ? remote.counter + 1 : 0
    this.last = { wallTime, counter, actorId: this.actorId }; return { ...this.last }
  }
}

export const generateAccountMasterKey = () => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
export const generateDeviceSigningKeys = () => crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as Promise<DeviceSigningKeys>
export const exportAccountMasterKey = async (key: CryptoKey): Promise<PortableAccountKey> => ({ version: 1, algorithm: 'AES-GCM-256', key: bytesToBase64(new Uint8Array(await crypto.subtle.exportKey('raw', key))) })
export const importAccountMasterKey = (portable: PortableAccountKey, extractable = true) => {
  if (portable.version !== 1 || portable.algorithm !== 'AES-GCM-256' || base64ToBytes(portable.key).byteLength !== 32) throw new Error('Recovery key is invalid.')
  return crypto.subtle.importKey('raw', base64ToBytes(portable.key), { name: 'AES-GCM', length: 256 }, extractable, ['encrypt', 'decrypt'])
}

export const encryptOperation = async (key: CryptoKey, header: Omit<EncryptedEntityOperation, 'nonce' | 'ciphertext' | 'signature'>, operation: DecryptedEntityOperation): Promise<EncryptedEntityOperation> => {
  validateDecryptedOperation(operation)
  if (header.entityId !== operation.entityId || header.entityKind !== operation.entityKind || header.action !== operation.action) throw new Error('Encrypted operation header does not match its payload.')
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(JSON.stringify(operation))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: additionalData(header) }, key, plaintext))
  return { ...header, nonce: bytesToBase64(nonce), ciphertext: bytesToBase64(ciphertext), signature: '' }
}

export const signEncryptedOperation = async (privateKey: CryptoKey, operation: EncryptedEntityOperation): Promise<EncryptedEntityOperation> => {
  const { signature: _signature, ...unsigned } = operation
  const signature = await crypto.subtle.sign({ name: 'Ed25519' }, privateKey, operationSigningBytes(unsigned))
  return { ...operation, signature: bytesToBase64(new Uint8Array(signature)) }
}

export const verifyEncryptedOperation = async (publicKey: CryptoKey, operation: EncryptedEntityOperation) => {
  validateEncryptedOperation(operation)
  const { signature, ...unsigned } = operation
  return crypto.subtle.verify({ name: 'Ed25519' }, publicKey, base64ToBytes(signature), operationSigningBytes(unsigned))
}

export const encryptAndSignOperation = async (accountKey: CryptoKey, privateKey: CryptoKey, header: Omit<EncryptedEntityOperation, 'nonce' | 'ciphertext' | 'signature'>, operation: DecryptedEntityOperation) => signEncryptedOperation(privateKey, await encryptOperation(accountKey, header, operation))

export const decryptOperation = async (key: CryptoKey, encrypted: EncryptedEntityOperation): Promise<DecryptedEntityOperation> => {
  validateEncryptedOperation(encrypted, false)
  const { nonce, ciphertext, signature: _signature, ...header } = encrypted
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(nonce), additionalData: additionalData(header) }, key, base64ToBytes(ciphertext))
  const operation = JSON.parse(new TextDecoder().decode(plaintext)) as DecryptedEntityOperation
  if (operation.entityId !== encrypted.entityId || operation.entityKind !== encrypted.entityKind || operation.action !== encrypted.action) throw new Error('Decrypted operation does not match its authenticated header.')
  return validateDecryptedOperation(operation)
}

export const encryptSnapshot = async (key: CryptoKey, workspaceId: string, through: Record<string, number>, plaintext: Uint8Array): Promise<EncryptedSnapshot> => {
  assertId(workspaceId, 'Workspace id')
  const sha256 = bytesToBase64(new Uint8Array(await crypto.subtle.digest('SHA-256', webCryptoBytes(plaintext))))
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const header = { protocol: 1 as const, workspaceId, through: Object.fromEntries(Object.entries(through).sort(([a], [b]) => a.localeCompare(b))), sha256 }
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: snapshotAdditionalData(header) }, key, webCryptoBytes(plaintext))
  return { ...header, nonce: bytesToBase64(nonce), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) }
}

export const decryptSnapshot = async (key: CryptoKey, snapshot: EncryptedSnapshot) => {
  if (snapshot.protocol !== 1) throw new Error('Unsupported encrypted snapshot version.')
  const header = { protocol: snapshot.protocol, workspaceId: snapshot.workspaceId, through: snapshot.through, sha256: snapshot.sha256 }
  const plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(snapshot.nonce), additionalData: snapshotAdditionalData(header) }, key, base64ToBytes(snapshot.ciphertext)))
  const digest = bytesToBase64(new Uint8Array(await crypto.subtle.digest('SHA-256', plaintext)))
  if (digest !== snapshot.sha256) throw new Error('Encrypted snapshot digest does not match its plaintext.')
  return plaintext
}

export const SNAPSHOT_CHUNK_BYTES = 1024 * 1024

export const encryptSnapshotChunks = async (key: CryptoKey, workspaceId: string, through: Record<string, number>, plaintext: Uint8Array, chunkBytes = SNAPSHOT_CHUNK_BYTES): Promise<{ manifest: EncryptedSnapshotManifest; chunks: EncryptedSnapshotChunk[] }> => {
  assertId(workspaceId, 'Workspace id')
  if (plaintext.byteLength < 1 || plaintext.byteLength > 512 * 1024 * 1024) throw new Error('Encrypted snapshot plaintext must contain 1 byte–512 MiB.')
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 64 * 1024 || chunkBytes > 4 * 1024 * 1024) throw new Error('Encrypted snapshot chunk size must be between 64 KiB and 4 MiB.')
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', webCryptoBytes(plaintext)))
  const sha256 = bytesToBase64(digest)
  const sortedThrough = Object.fromEntries(Object.entries(through).sort(([a], [b]) => a.localeCompare(b)))
  const identityDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ workspaceId, through: sortedThrough, sha256, plaintextBytes: plaintext.byteLength, chunkBytes }))))
  // Prefix the base64url digest so every content-derived id satisfies the
  // service identifier grammar, including digests whose first character is
  // otherwise "-" or "_".
  const snapshotId = `snapshot-${bytesToBase64(identityDigest).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`
  const manifest: EncryptedSnapshotManifest = {
    protocol: 1,
    format: 'chunked-v1',
    snapshotId,
    workspaceId,
    through: sortedThrough,
    sha256,
    plaintextBytes: plaintext.byteLength,
    chunkBytes,
    chunkCount: Math.ceil(plaintext.byteLength / chunkBytes),
  }
  const chunks: EncryptedSnapshotChunk[] = []
  for (let index = 0; index < manifest.chunkCount; index += 1) {
    const part = plaintext.slice(index * chunkBytes, Math.min(plaintext.byteLength, (index + 1) * chunkBytes))
    const nonce = crypto.getRandomValues(new Uint8Array(12))
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: snapshotChunkAdditionalData(manifest, index, part.byteLength) }, key, part)
    chunks.push({ protocol: 1, snapshotId, index, nonce: bytesToBase64(nonce), ciphertext: bytesToBase64(new Uint8Array(ciphertext)), plaintextBytes: part.byteLength })
  }
  return { manifest, chunks }
}

export const decryptSnapshotChunks = async (key: CryptoKey, manifest: EncryptedSnapshotManifest, chunks: EncryptedSnapshotChunk[]) => {
  assertId(manifest.workspaceId, 'Workspace id'); assertActorId(manifest.snapshotId, 'Snapshot id')
  for (const [actorId, sequence] of Object.entries(manifest.through || {})) if (!ACTOR_ID.test(actorId) || !Number.isSafeInteger(sequence) || sequence < 0) throw new Error('Encrypted snapshot cursor is invalid.')
  if (manifest.protocol !== 1 || manifest.format !== 'chunked-v1' || typeof manifest.sha256 !== 'string' || base64ToBytes(manifest.sha256).byteLength !== 32 || !Number.isSafeInteger(manifest.plaintextBytes) || manifest.plaintextBytes < 1 || manifest.plaintextBytes > 512 * 1024 * 1024 || !Number.isSafeInteger(manifest.chunkBytes) || manifest.chunkBytes < 64 * 1024 || manifest.chunkBytes > 4 * 1024 * 1024 || !Number.isSafeInteger(manifest.chunkCount) || manifest.chunkCount !== Math.ceil(manifest.plaintextBytes / manifest.chunkBytes) || chunks.length !== manifest.chunkCount) throw new Error('Encrypted snapshot manifest is invalid or incomplete.')
  const output = new Uint8Array(manifest.plaintextBytes)
  let offset = 0
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]
    const expectedBytes = Math.min(manifest.chunkBytes, manifest.plaintextBytes - index * manifest.chunkBytes)
    if (chunk.protocol !== 1 || chunk.snapshotId !== manifest.snapshotId || chunk.index !== index || chunk.plaintextBytes !== expectedBytes || base64ToBytes(chunk.nonce).byteLength !== 12) throw new Error(`Encrypted snapshot chunk ${index} is invalid.`)
    const part = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(chunk.nonce), additionalData: snapshotChunkAdditionalData(manifest, index, chunk.plaintextBytes) }, key, base64ToBytes(chunk.ciphertext)))
    if (part.byteLength !== expectedBytes) throw new Error(`Encrypted snapshot chunk ${index} length is invalid.`)
    output.set(part, offset); offset += part.byteLength
  }
  const digest = bytesToBase64(new Uint8Array(await crypto.subtle.digest('SHA-256', output)))
  const identityDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ workspaceId: manifest.workspaceId, through: manifest.through, sha256: manifest.sha256, plaintextBytes: manifest.plaintextBytes, chunkBytes: manifest.chunkBytes }))))
  const digestId = bytesToBase64(identityDigest).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  // Accept already-stored pre-prefix manifests when their digest happened to
  // begin with a service-safe character; all new manifests use the prefix.
  if (digest !== manifest.sha256 || (manifest.snapshotId !== `snapshot-${digestId}` && manifest.snapshotId !== digestId)) throw new Error('Encrypted snapshot digest does not match its manifest.')
  return output
}

export const encryptMediaChunk = async (key: CryptoKey, mediaId: string, index: number, plaintext: Uint8Array, uploadId = mediaId): Promise<EncryptedMediaChunk> => {
  assertId(mediaId, 'Media id'); assertActorId(uploadId, 'Media upload id')
  if (!Number.isSafeInteger(index) || index < 0 || plaintext.byteLength > 4 * 1024 * 1024) throw new Error('Encrypted media chunks must be numbered and no larger than 4 MiB.')
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: mediaAdditionalData(mediaId, uploadId, index, plaintext.byteLength) }, key, webCryptoBytes(plaintext))
  return { protocol: 1, mediaId, uploadId, index, nonce: bytesToBase64(nonce), ciphertext: bytesToBase64(new Uint8Array(ciphertext)), plaintextBytes: plaintext.byteLength }
}

export const decryptMediaChunk = async (key: CryptoKey, chunk: EncryptedMediaChunk) => {
  if (chunk.protocol !== 1 || chunk.plaintextBytes > 4 * 1024 * 1024) throw new Error('Encrypted media chunk is invalid.')
  assertActorId(chunk.uploadId, 'Media upload id')
  const plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(chunk.nonce), additionalData: mediaAdditionalData(chunk.mediaId, chunk.uploadId, chunk.index, chunk.plaintextBytes) }, key, base64ToBytes(chunk.ciphertext)))
  if (plaintext.byteLength !== chunk.plaintextBytes) throw new Error('Encrypted media chunk length is invalid.')
  return plaintext
}

interface LedgerEntity { fields: Record<string, unknown>; fieldTimestamps: Record<string, HybridLogicalTimestamp>; tags: Set<string>; tagTimestamps: Record<string, HybridLogicalTimestamp>; tombstone?: HybridLogicalTimestamp }
const conflictDigest = (value: string) => {
  let first = 1779033703; let second = 3144134277; let third = 1013904242; let fourth = 2773480762
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    first = second ^ Math.imul(first ^ code, 597399067); second = third ^ Math.imul(second ^ code, 2869860233)
    third = fourth ^ Math.imul(third ^ code, 951274213); fourth = first ^ Math.imul(fourth ^ code, 2716044179)
  }
  first = Math.imul(third ^ (first >>> 18), 597399067); second = Math.imul(fourth ^ (second >>> 22), 2869860233)
  third = Math.imul(first ^ (third >>> 17), 951274213); fourth = Math.imul(second ^ (fourth >>> 19), 2716044179)
  return [first ^ second ^ third ^ fourth, second ^ first, third ^ first, fourth ^ first].map((part) => (part >>> 0).toString(16).padStart(8, '0')).join('')
}
export class OperationLedger {
  private entities = new Map<string, LedgerEntity>()
  private sequences = new Map<string, number>()
  private applied = new Set<string>()
  private conflictRecords = new Map<string, SyncFieldConflict>()
  private resolvedConflicts = new Set<string>()
  apply(envelope: Pick<EncryptedEntityOperation, 'actorId' | 'sequence' | 'timestamp' | 'idempotencyKey'>, operation: DecryptedEntityOperation) {
    validateDecryptedOperation(operation)
    if (this.applied.has(envelope.idempotencyKey)) return { applied: false, reason: 'duplicate' as const }
    const lastSequence = this.sequences.get(envelope.actorId) || 0
    if (!Number.isSafeInteger(envelope.sequence) || envelope.sequence <= lastSequence) throw new Error(`Non-monotonic sequence for actor ${envelope.actorId}.`)
    const key = `${operation.entityKind}:${operation.entityId}`
    const entity = this.entities.get(key) || { fields: {}, fieldTimestamps: {}, tags: new Set<string>(), tagTimestamps: {} }
    if (operation.entityKind === 'review' && this.entities.has(key)) throw new Error('Review entities are append-only and cannot be mutated.')
    if (operation.entityKind === 'review' && operation.action !== 'upsert') throw new Error('Review entities cannot be deleted or restored; append a reversal review instead.')
    this.sequences.set(envelope.actorId, envelope.sequence); this.applied.add(envelope.idempotencyKey)
    if (operation.action === 'delete') {
      if (!entity.tombstone || compareHybridTimestamp(envelope.timestamp, entity.tombstone) > 0) entity.tombstone = envelope.timestamp
      this.entities.set(key, entity); return { applied: true, reason: 'deleted' as const }
    }
    if (entity.tombstone) {
      if (operation.action !== 'restore' || compareHybridTimestamp(envelope.timestamp, entity.tombstone) <= 0) return { applied: false, reason: 'delete-wins' as const }
      entity.tombstone = undefined
    }
    for (const conflictId of operation.resolvesConflicts || []) { this.resolvedConflicts.add(conflictId); this.conflictRecords.delete(conflictId) }
    const detectConflict = (field: string, incoming: { present: boolean; value?: unknown }) => {
      if (['revision', 'updatedAt', 'createdAt', 'workspaceRevision', 'deviceId'].includes(field)) return
      const base = operation.fieldBases?.[field]; const previous = entity.fieldTimestamps[field]
      if (!base || !previous || previous.actorId === envelope.actorId) return
      const existing = { present: Object.prototype.hasOwnProperty.call(entity.fields, field), ...(Object.prototype.hasOwnProperty.call(entity.fields, field) ? { value: structuredClone(entity.fields[field]) } : {}) }
      const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([name, entry]) => [name, canonical(entry)])) : value
      const equivalent = (left: { present: boolean; value?: unknown }, right: { present: boolean; value?: unknown }) => left.present === right.present && (!left.present || JSON.stringify(canonical(left.value)) === JSON.stringify(canonical(right.value)))
      if (equivalent(base, existing) || equivalent(existing, incoming)) return
      const alternatives = [JSON.stringify(canonical(existing)), JSON.stringify(canonical(incoming))].sort()
      const id = `conflict:${conflictDigest(JSON.stringify(canonical({ entityKind: operation.entityKind, entityId: operation.entityId, field, base, alternatives })))}`
      if (this.resolvedConflicts.has(id)) return
      const safeWallTime = Math.min(envelope.timestamp.wallTime, 8_640_000_000_000_000)
      this.conflictRecords.set(id, { id, entityKind: operation.entityKind, entityId: operation.entityId, field, base: structuredClone(base), existing, incoming: structuredClone(incoming), winner: compareHybridTimestamp(envelope.timestamp, previous) > 0 ? 'incoming' : 'existing', incomingActorId: envelope.actorId, incomingSequence: envelope.sequence, detectedAt: new Date(safeWallTime).toISOString() })
    }
    for (const [field, value] of Object.entries(operation.fields || {})) {
      detectConflict(field, { present: true, value })
      const previous = entity.fieldTimestamps[field]
      if (!previous || compareHybridTimestamp(envelope.timestamp, previous) > 0) { entity.fields[field] = structuredClone(value); entity.fieldTimestamps[field] = envelope.timestamp }
    }
    for (const field of operation.fieldsDeleted || []) {
      detectConflict(field, { present: false })
      const previous = entity.fieldTimestamps[field]
      if (!previous || compareHybridTimestamp(envelope.timestamp, previous) > 0) { delete entity.fields[field]; entity.fieldTimestamps[field] = envelope.timestamp }
    }
    for (const tag of operation.tagsAdded || []) { const previous = entity.tagTimestamps[tag]; if (!previous || compareHybridTimestamp(envelope.timestamp, previous) > 0) { entity.tags.add(tag); entity.tagTimestamps[tag] = envelope.timestamp } }
    for (const tag of operation.tagsRemoved || []) { const previous = entity.tagTimestamps[tag]; if (!previous || compareHybridTimestamp(envelope.timestamp, previous) > 0) { entity.tags.delete(tag); entity.tagTimestamps[tag] = envelope.timestamp } }
    this.entities.set(key, entity); return { applied: true, reason: operation.action as 'upsert' | 'restore' }
  }
  read(kind: SyncEntityKind, id: string) {
    const entity = this.entities.get(`${kind}:${id}`)
    if (!entity || entity.tombstone) return null
    return Object.keys(entity.tagTimestamps).length ? { ...structuredClone(entity.fields), tags: [...entity.tags].sort() } : structuredClone(entity.fields)
  }
  hasTombstone(kind: SyncEntityKind, id: string) { return Boolean(this.entities.get(`${kind}:${id}`)?.tombstone) }
  clone() {
    const copy = new OperationLedger()
    copy.entities = new Map([...this.entities].map(([key, entity]) => [key, {
      fields: structuredClone(entity.fields), fieldTimestamps: structuredClone(entity.fieldTimestamps),
      tags: new Set(entity.tags), tagTimestamps: structuredClone(entity.tagTimestamps), tombstone: entity.tombstone ? structuredClone(entity.tombstone) : undefined,
    }]))
    copy.sequences = new Map(this.sequences)
    copy.applied = new Set(this.applied)
    copy.conflictRecords = new Map([...this.conflictRecords].map(([key, value]) => [key, structuredClone(value)]))
    copy.resolvedConflicts = new Set(this.resolvedConflicts)
    return copy
  }
  entries(kind?: SyncEntityKind) {
    const prefix = kind ? `${kind}:` : ''
    return [...this.entities.entries()].filter(([key]) => key.startsWith(prefix)).map(([key, entity]) => {
      const separator = key.indexOf(':')
      const value = Object.keys(entity.tagTimestamps).length ? { ...structuredClone(entity.fields), tags: [...entity.tags].sort() } : structuredClone(entity.fields)
      return { kind: key.slice(0, separator) as SyncEntityKind, id: key.slice(separator + 1), deleted: Boolean(entity.tombstone), value: entity.tombstone ? null : value }
    }).sort((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id))
  }
  conflicts() { return [...this.conflictRecords.values()].map((value) => structuredClone(value)) }
}
