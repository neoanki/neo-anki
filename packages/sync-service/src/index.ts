import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  validateEncryptedOperation,
  verifyEncryptedOperation,
  type EncryptedEntityOperation,
  type EncryptedMediaChunk,
  type EncryptedMediaManifest,
  type EncryptedSnapshot,
  type EncryptedSnapshotChunk,
  type EncryptedSnapshotManifest,
} from '@neo-anki/sync-protocol'

const MAX_PUSH_OPERATIONS = 2_000
const MAX_PULL_OPERATIONS = 10_000
const MAX_SNAPSHOT_BYTES = 512 * 1024 * 1024
const MAX_LEGACY_SNAPSHOT_BYTES = 16 * 1024 * 1024
const MAX_SNAPSHOT_CHUNK_BYTES = 6 * 1024 * 1024
const MAX_MEDIA_CHUNK_BYTES = 6 * 1024 * 1024
const MAX_DEVICES_PER_WORKSPACE = 50
const MAX_ACCOUNTS = 100_000
const MAX_OPERATIONS_PER_WORKSPACE = 10_000_000
const MAX_SNAPSHOTS_PER_WORKSPACE = 5
const MAX_SNAPSHOT_IDS_PER_WORKSPACE = 12
const MAX_ENCRYPTED_SNAPSHOT_BYTES_PER_WORKSPACE = 3 * 1024 * 1024 * 1024
const MAX_ENCRYPTED_MEDIA_BYTES_PER_WORKSPACE = 20 * 1024 * 1024 * 1024
const MAX_MEDIA_UPLOAD_IDS_PER_WORKSPACE = 2_000
const MEDIA_DELETE_GRACE_MILLISECONDS = 30 * 24 * 60 * 60 * 1000
const STAGED_UPLOAD_GRACE_MILLISECONDS = 24 * 60 * 60 * 1000
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/

const assertId = (value: string, label: string) => { if (!IDENTIFIER.test(value)) throw new Error(`${label} is invalid.`) }
const digestToken = (token: string) => createHash('sha256').update(token).digest('hex')
const equalDigest = (left: string, right: string) => { const a = Buffer.from(left, 'hex'); const b = Buffer.from(right, 'hex'); return a.byteLength === b.byteLength && timingSafeEqual(a, b) }
const byteLength = (value: unknown) => Buffer.byteLength(JSON.stringify(value))
const parsed = <T>(value: unknown): T => JSON.parse(String(value)) as T
const assertPublicKey = (value: JsonWebKey) => { if (value?.kty !== 'OKP' || value.crv !== 'Ed25519' || typeof value.x !== 'string' || value.x.length < 40 || value.x.length > 100 || value.d !== undefined) throw new Error('Device public key must be a public-only Ed25519 JWK.') }
const validBase64 = (value: unknown, expectedBytes?: number) => typeof value === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(value) && value.length % 4 === 0 && (expectedBytes === undefined || Buffer.from(value, 'base64').byteLength === expectedBytes)

export interface DeviceSession { accountId: string; workspaceId: string; actorId: string; token: string; recoveryToken?: string }
export interface PullCursor { [actorId: string]: number }
export interface SyncPullResult {
  operations: EncryptedEntityOperation[]
  cursor: PullCursor
  /** Operations at or below this cursor have been replaced by a committed encrypted snapshot. */
  compactionFloor: PullCursor
  latestSnapshot?: EncryptedSnapshot
  latestSnapshotManifest?: EncryptedSnapshotManifest
}

interface DeviceRow { account_id: string; workspace_id: string; actor_id: string; public_key: string; revoked_at: number | null }
export interface SyncDeviceRecord { actorId: string; createdAt: string; revokedAt?: string; current: boolean }

/**
 * Reference persistence service. It stores only authenticated routing metadata,
 * ciphertext, public device keys, and encrypted blobs; collection plaintext and
 * the account master key never cross this boundary.
 */
export class EncryptedSyncService {
  readonly database: DatabaseSync

  constructor(path = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.database = new DatabaseSync(path)
    this.database.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;')
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, recovery_hash TEXT);
      CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS devices (
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        actor_id TEXT NOT NULL,
        public_key TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        revoked_at INTEGER,
        PRIMARY KEY (workspace_id, actor_id)
      );
      CREATE TABLE IF NOT EXISTS operations (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        actor_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        idempotency_key TEXT NOT NULL,
        entity_kind TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        action TEXT NOT NULL,
        wall_time INTEGER NOT NULL,
        envelope TEXT NOT NULL,
        received_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, actor_id, sequence),
        UNIQUE (workspace_id, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS operations_entity ON operations(workspace_id, entity_kind, entity_id);
      CREATE INDEX IF NOT EXISTS operations_received ON operations(workspace_id, received_at, actor_id, sequence);
      CREATE TABLE IF NOT EXISTS actor_sequences (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        actor_id TEXT NOT NULL,
        max_sequence INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, actor_id)
      );
      CREATE TABLE IF NOT EXISTS device_acknowledgements (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        actor_id TEXT NOT NULL,
        cursor TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, actor_id)
      );
      CREATE TABLE IF NOT EXISTS compaction_state (
        workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
        floor TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS snapshots (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        snapshot TEXT NOT NULL,
        byte_length INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, id)
      );
      CREATE TABLE IF NOT EXISTS snapshot_manifests (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        manifest TEXT NOT NULL,
        byte_length INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, id)
      );
      CREATE TABLE IF NOT EXISTS snapshot_chunks (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        snapshot_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        chunk TEXT NOT NULL,
        byte_length INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, snapshot_id, chunk_index)
      );
      CREATE TABLE IF NOT EXISTS media_chunks (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        media_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        chunk TEXT NOT NULL,
        byte_length INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, media_id, chunk_index)
      );
      CREATE TABLE IF NOT EXISTS media_upload_chunks (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        media_id TEXT NOT NULL,
        upload_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        chunk TEXT NOT NULL,
        byte_length INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, media_id, upload_id, chunk_index)
      );
      CREATE TABLE IF NOT EXISTS media_manifests (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        media_id TEXT NOT NULL,
        upload_id TEXT NOT NULL,
        manifest TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, media_id)
      );
      CREATE TABLE IF NOT EXISTS media_tombstones (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        media_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        wall_time INTEGER NOT NULL,
        counter INTEGER NOT NULL,
        deleted_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, media_id)
      );
      CREATE TABLE IF NOT EXISTS rate_limits (
        key_hash TEXT PRIMARY KEY,
        started_at INTEGER NOT NULL,
        count INTEGER NOT NULL
      );
    `)
    const accountColumns = this.database.prepare('PRAGMA table_info(accounts)').all() as unknown as Array<{ name: string }>
    if (!accountColumns.some((column) => column.name === 'recovery_hash')) this.database.exec('ALTER TABLE accounts ADD COLUMN recovery_hash TEXT')
    this.database.exec(`
      INSERT INTO actor_sequences(workspace_id, actor_id, max_sequence)
      SELECT workspace_id, actor_id, MAX(sequence) FROM operations GROUP BY workspace_id, actor_id
      ON CONFLICT(workspace_id, actor_id) DO UPDATE SET max_sequence=MAX(actor_sequences.max_sequence, excluded.max_sequence);
    `)
  }

  /** Shared SQLite-backed limiter so multiple service processes enforce one budget. */
  rateLimitExceeded(key: string, maximum: number, windowMilliseconds = 60_000) {
    const keyHash = digestToken(key); const now = Date.now()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const row = this.database.prepare('SELECT started_at, count FROM rate_limits WHERE key_hash=?').get(keyHash) as { started_at: number; count: number } | undefined
      let count = 1; let startedAt = now
      if (row && now - row.started_at < windowMilliseconds) { count = row.count + 1; startedAt = row.started_at }
      this.database.prepare('INSERT INTO rate_limits(key_hash, started_at, count) VALUES (?, ?, ?) ON CONFLICT(key_hash) DO UPDATE SET started_at=excluded.started_at, count=excluded.count').run(keyHash, startedAt, count)
      this.database.prepare('DELETE FROM rate_limits WHERE started_at < ?').run(now - windowMilliseconds * 2)
      this.database.exec('COMMIT')
      return count > maximum
    } catch (error) { this.database.exec('ROLLBACK'); throw error }
  }

  enrollFirstDevice(input: { accountId?: string; workspaceId?: string; actorId: string; publicKeyJwk: JsonWebKey; recoveryToken?: string }): DeviceSession {
    const accountId = input.accountId || randomUUID(); const workspaceId = input.workspaceId || randomUUID()
    assertId(accountId, 'Account id'); assertId(workspaceId, 'Workspace id'); assertId(input.actorId, 'Actor id'); assertPublicKey(input.publicKeyJwk)
    const token = randomBytes(32).toString('base64url'); const recoveryToken = input.recoveryToken || randomBytes(32).toString('base64url'); const now = Date.now()
    if (recoveryToken.length < 32 || recoveryToken.length > 500) throw new Error('Recovery authorization must contain at least 32 characters.')
    const accountCount = Number((this.database.prepare('SELECT COUNT(*) AS value FROM accounts').get() as { value: number }).value)
    if (accountCount >= MAX_ACCOUNTS) throw new Error('Service account quota is exceeded; contact the service operator.')
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare('INSERT INTO accounts(id, created_at, recovery_hash) VALUES (?, ?, ?)').run(accountId, now, digestToken(recoveryToken))
      this.database.prepare('INSERT INTO workspaces(id, account_id, created_at) VALUES (?, ?, ?)').run(workspaceId, accountId, now)
      this.database.prepare('INSERT INTO devices(account_id, workspace_id, actor_id, public_key, token_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(accountId, workspaceId, input.actorId, JSON.stringify(input.publicKeyJwk), digestToken(token), now)
      this.database.exec('COMMIT')
    } catch (error) { this.database.exec('ROLLBACK'); throw error }
    return { accountId, workspaceId, actorId: input.actorId, token, recoveryToken }
  }

  enrollDevice(authorizingToken: string, input: { actorId: string; publicKeyJwk: JsonWebKey }): DeviceSession {
    const owner = this.authorize(authorizingToken); assertId(input.actorId, 'Actor id'); assertPublicKey(input.publicKeyJwk)
    const count = Number((this.database.prepare('SELECT COUNT(*) AS value FROM devices WHERE workspace_id=?').get(owner.workspace_id) as { value: number }).value)
    if (count >= MAX_DEVICES_PER_WORKSPACE) throw new Error(`A workspace supports at most ${MAX_DEVICES_PER_WORKSPACE} device records.`)
    const token = randomBytes(32).toString('base64url')
    this.database.prepare('INSERT INTO devices(account_id, workspace_id, actor_id, public_key, token_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(owner.account_id, owner.workspace_id, input.actorId, JSON.stringify(input.publicKeyJwk), digestToken(token), Date.now())
    return { accountId: owner.account_id, workspaceId: owner.workspace_id, actorId: input.actorId, token }
  }

  recoverDevice(input: { accountId: string; workspaceId: string; recoveryToken: string; actorId: string; publicKeyJwk: JsonWebKey }): DeviceSession {
    assertId(input.accountId, 'Account id'); assertId(input.workspaceId, 'Workspace id'); assertId(input.actorId, 'Actor id'); assertPublicKey(input.publicKeyJwk)
    const account = this.database.prepare('SELECT recovery_hash FROM accounts WHERE id=?').get(input.accountId) as { recovery_hash?: string | null } | undefined
    const workspace = this.database.prepare('SELECT account_id FROM workspaces WHERE id=?').get(input.workspaceId) as { account_id?: string } | undefined
    if (!account?.recovery_hash || !equalDigest(account.recovery_hash, digestToken(input.recoveryToken)) || workspace?.account_id !== input.accountId) throw new Error('Recovery authorization is invalid.')
    const count = Number((this.database.prepare('SELECT COUNT(*) AS value FROM devices WHERE workspace_id=?').get(input.workspaceId) as { value: number }).value)
    if (count >= MAX_DEVICES_PER_WORKSPACE) throw new Error(`A workspace supports at most ${MAX_DEVICES_PER_WORKSPACE} device records.`)
    const token = randomBytes(32).toString('base64url')
    this.database.prepare('INSERT INTO devices(account_id, workspace_id, actor_id, public_key, token_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(input.accountId, input.workspaceId, input.actorId, JSON.stringify(input.publicKeyJwk), digestToken(token), Date.now())
    return { accountId: input.accountId, workspaceId: input.workspaceId, actorId: input.actorId, token }
  }

  rotateRecoveryToken(authorizingToken: string) {
    const owner = this.authorize(authorizingToken); const recoveryToken = randomBytes(32).toString('base64url')
    this.database.prepare('UPDATE accounts SET recovery_hash=? WHERE id=?').run(digestToken(recoveryToken), owner.account_id)
    return recoveryToken
  }

  revokeDevice(authorizingToken: string, actorId: string) {
    const owner = this.authorize(authorizingToken)
    if (actorId === owner.actor_id) throw new Error('Use account recovery from another device before revoking the current device.')
    const result = this.database.prepare('UPDATE devices SET revoked_at=? WHERE workspace_id=? AND actor_id=? AND revoked_at IS NULL').run(Date.now(), owner.workspace_id, actorId)
    if (!result.changes) throw new Error('Device was not found or is already revoked.')
    this.tryCompact(owner.workspace_id)
  }

  listDevices(authorizingToken: string): SyncDeviceRecord[] {
    const owner = this.authorize(authorizingToken)
    const rows = this.database.prepare('SELECT actor_id, created_at, revoked_at FROM devices WHERE workspace_id=? ORDER BY created_at, actor_id').all(owner.workspace_id) as unknown as Array<{ actor_id: string; created_at: number; revoked_at: number | null }>
    return rows.map((row) => ({ actorId: row.actor_id, createdAt: new Date(row.created_at).toISOString(), revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : undefined, current: row.actor_id === owner.actor_id }))
  }

  private authorize(token: string): DeviceRow {
    if (!token || token.length > 500) throw new Error('Device authorization is invalid.')
    const row = this.database.prepare('SELECT account_id, workspace_id, actor_id, public_key, revoked_at FROM devices WHERE token_hash=?').get(digestToken(token)) as unknown as DeviceRow | undefined
    if (!row || row.revoked_at) throw new Error('Device authorization is invalid or revoked.')
    return row
  }

  async push(token: string, operations: EncryptedEntityOperation[]) {
    const device = this.authorize(token)
    if (!Array.isArray(operations) || operations.length < 1 || operations.length > MAX_PUSH_OPERATIONS) throw new Error(`Push batches require 1–${MAX_PUSH_OPERATIONS} operations.`)
    const publicKey = await crypto.subtle.importKey('jwk', parsed<JsonWebKey>(device.public_key), { name: 'Ed25519' }, false, ['verify'])
    const maximumAcceptedWallTime = Date.now() + 24 * 60 * 60 * 1000
    for (const operation of operations) {
      validateEncryptedOperation(operation)
      if (operation.actorId !== device.actor_id || operation.timestamp.actorId !== device.actor_id) throw new Error('Operation actor does not match the authorized device.')
      if (operation.timestamp.wallTime > maximumAcceptedWallTime) throw new Error('Operation clock is more than 24 hours in the future.')
      if (!await verifyEncryptedOperation(publicKey, operation)) throw new Error(`Operation ${operation.idempotencyKey} has an invalid device signature.`)
    }
    const operationCount = Number((this.database.prepare('SELECT COUNT(*) AS value FROM operations WHERE workspace_id=?').get(device.workspace_id) as { value: number }).value)
    let newOperations = 0; const batchIds = new Set<string>()
    for (const operation of operations) {
      if (batchIds.has(operation.idempotencyKey)) continue
      batchIds.add(operation.idempotencyKey)
      if (!this.database.prepare('SELECT 1 AS value FROM operations WHERE workspace_id=? AND idempotency_key=?').get(device.workspace_id, operation.idempotencyKey)) newOperations += 1
    }
    if (operationCount + newOperations > MAX_OPERATIONS_PER_WORKSPACE) throw new Error('Workspace encrypted-operation quota is exceeded; export the workspace and contact the service operator.')
    const insert = this.database.prepare('INSERT INTO operations(workspace_id, actor_id, sequence, idempotency_key, entity_kind, entity_id, action, wall_time, envelope, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const last = Number((this.database.prepare('SELECT max_sequence AS value FROM actor_sequences WHERE workspace_id=? AND actor_id=?').get(device.workspace_id, device.actor_id) as { value?: number | null } | undefined)?.value || 0)
      let expected = last + 1
      for (const operation of operations) {
        const existing = this.database.prepare('SELECT envelope FROM operations WHERE workspace_id=? AND idempotency_key=?').get(device.workspace_id, operation.idempotencyKey) as { envelope?: string } | undefined
        if (existing) {
          if (existing.envelope !== JSON.stringify(operation)) throw new Error(`Idempotency key ${operation.idempotencyKey} was reused with different ciphertext.`)
          continue
        }
        if (operation.sequence !== expected) throw new Error(`Expected actor sequence ${expected}, received ${operation.sequence}.`)
        insert.run(device.workspace_id, operation.actorId, operation.sequence, operation.idempotencyKey, operation.entityKind, operation.entityId, operation.action, operation.timestamp.wallTime, JSON.stringify(operation), Date.now())
        if (operation.entityKind === 'media') this.recordMediaLifecycle(device.workspace_id, operation)
        expected += 1
      }
      this.database.prepare('INSERT INTO actor_sequences(workspace_id, actor_id, max_sequence) VALUES (?, ?, ?) ON CONFLICT(workspace_id, actor_id) DO UPDATE SET max_sequence=MAX(actor_sequences.max_sequence, excluded.max_sequence)').run(device.workspace_id, device.actor_id, expected - 1)
      this.database.exec('COMMIT')
    } catch (error) { this.database.exec('ROLLBACK'); throw error }
    return this.cursor(device.workspace_id)
  }

  pull(token: string, after: PullCursor = {}, limit = MAX_PULL_OPERATIONS): SyncPullResult {
    const device = this.authorize(token)
    const cursorEntries = Object.entries(after || {})
    if (cursorEntries.length > MAX_DEVICES_PER_WORKSPACE) throw new Error('Pull cursor contains too many actors.')
    for (const [actorId, sequence] of cursorEntries) { assertId(actorId, 'Pull cursor actor id'); if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error('Pull cursor sequence is invalid.') }
    const boundedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(MAX_PULL_OPERATIONS, Math.floor(limit))) : MAX_PULL_OPERATIONS
    const compactionFloor = this.compactionFloor(device.workspace_id)
    const effectiveAfter = { ...after }
    for (const [actorId, sequence] of Object.entries(compactionFloor)) effectiveAfter[actorId] = Math.max(effectiveAfter[actorId] || 0, sequence)
    const actors = this.database.prepare('SELECT actor_id FROM actor_sequences WHERE workspace_id=?').all(device.workspace_id) as unknown as Array<{ actor_id: string }>
    const conditions = actors.map(() => '(actor_id=? AND sequence>?)').join(' OR ')
    const params = actors.flatMap(({ actor_id }) => [actor_id, effectiveAfter[actor_id] || 0])
    const selected = conditions ? this.database.prepare(`SELECT actor_id, sequence, envelope FROM operations WHERE workspace_id=? AND (${conditions}) ORDER BY received_at, actor_id, sequence LIMIT ?`).all(device.workspace_id, ...params, boundedLimit) as unknown as Array<{ actor_id: string; sequence: number; envelope: string }> : []
    const operations = selected.map((row) => parsed<EncryptedEntityOperation>(row.envelope))
    const cursor = { ...effectiveAfter }; for (const row of selected) cursor[row.actor_id] = Math.max(cursor[row.actor_id] || 0, row.sequence)
    const manifest = this.database.prepare('SELECT manifest FROM snapshot_manifests WHERE workspace_id=? ORDER BY created_at DESC LIMIT 1').get(device.workspace_id) as { manifest?: string } | undefined
    const snapshot = manifest?.manifest ? undefined : this.database.prepare('SELECT snapshot FROM snapshots WHERE workspace_id=? ORDER BY created_at DESC LIMIT 1').get(device.workspace_id) as { snapshot?: string } | undefined
    return { operations, cursor, compactionFloor, latestSnapshot: snapshot?.snapshot ? parsed<EncryptedSnapshot>(snapshot.snapshot) : undefined, latestSnapshotManifest: manifest?.manifest ? parsed<EncryptedSnapshotManifest>(manifest.manifest) : undefined }
  }

  /** Records a cursor only after the client has authenticated, decrypted, applied, and durably persisted it. */
  acknowledge(token: string, cursor: PullCursor) {
    const device = this.authorize(token); const entries = Object.entries(cursor || {})
    if (entries.length > MAX_DEVICES_PER_WORKSPACE) throw new Error('Acknowledgement cursor contains too many actors.')
    const previousRow = this.database.prepare('SELECT cursor FROM device_acknowledgements WHERE workspace_id=? AND actor_id=?').get(device.workspace_id, device.actor_id) as { cursor?: string } | undefined
    const previous = previousRow?.cursor ? parsed<PullCursor>(previousRow.cursor) : {}
    const next = { ...previous }
    for (const [actorId, sequence] of entries) {
      assertId(actorId, 'Acknowledgement actor id')
      if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence < (previous[actorId] || 0)) throw new Error('Acknowledgement cursor is invalid or regressive.')
      const maximum = Number((this.database.prepare('SELECT max_sequence AS value FROM actor_sequences WHERE workspace_id=? AND actor_id=?').get(device.workspace_id, actorId) as { value?: number } | undefined)?.value || 0)
      if (sequence > maximum) throw new Error('Acknowledgement cursor exceeds the service operation cursor.')
      next[actorId] = sequence
    }
    this.database.prepare('INSERT INTO device_acknowledgements(workspace_id, actor_id, cursor, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(workspace_id, actor_id) DO UPDATE SET cursor=excluded.cursor, updated_at=excluded.updated_at').run(device.workspace_id, device.actor_id, JSON.stringify(next), Date.now())
    return { cursor: next, compacted: this.tryCompact(device.workspace_id), compactionFloor: this.compactionFloor(device.workspace_id) }
  }

  devicePublicKey(token: string, actorId: string) {
    const device = this.authorize(token); assertId(actorId, 'Actor id')
    const row = this.database.prepare('SELECT public_key, revoked_at FROM devices WHERE workspace_id=? AND actor_id=?').get(device.workspace_id, actorId) as { public_key?: string; revoked_at?: number | null } | undefined
    // Revocation blocks authentication and new writes. Historical signatures
    // still need the actor's public key to remain independently verifiable.
    if (!row?.public_key) throw new Error('Sync device key is unavailable.')
    return parsed<JsonWebKey>(row.public_key)
  }

  private cursor(workspaceId: string): PullCursor {
    const rows = this.database.prepare('SELECT actor_id, max_sequence AS sequence FROM actor_sequences WHERE workspace_id=?').all(workspaceId) as unknown as Array<{ actor_id: string; sequence: number }>
    return Object.fromEntries(rows.map((row) => [row.actor_id, row.sequence]))
  }

  private compactionFloor(workspaceId: string): PullCursor {
    const row = this.database.prepare('SELECT floor FROM compaction_state WHERE workspace_id=?').get(workspaceId) as { floor?: string } | undefined
    return row?.floor ? parsed<PullCursor>(row.floor) : {}
  }

  private cursorDominates(left: PullCursor, right: PullCursor) { return Object.entries(right).every(([actorId, sequence]) => (left[actorId] || 0) >= sequence) }

  private recordMediaLifecycle(workspaceId: string, operation: EncryptedEntityOperation) {
    const row = this.database.prepare('SELECT actor_id, wall_time, counter FROM media_tombstones WHERE workspace_id=? AND media_id=?').get(workspaceId, operation.entityId) as { actor_id: string; wall_time: number; counter: number } | undefined
    const newer = !row || operation.timestamp.wallTime > row.wall_time || (operation.timestamp.wallTime === row.wall_time && (operation.timestamp.counter > row.counter || (operation.timestamp.counter === row.counter && operation.actorId.localeCompare(row.actor_id) > 0)))
    if (!newer) return
    if (operation.action === 'delete') this.database.prepare('INSERT INTO media_tombstones(workspace_id, media_id, actor_id, sequence, wall_time, counter, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id, media_id) DO UPDATE SET actor_id=excluded.actor_id, sequence=excluded.sequence, wall_time=excluded.wall_time, counter=excluded.counter, deleted_at=excluded.deleted_at').run(workspaceId, operation.entityId, operation.actorId, operation.sequence, operation.timestamp.wallTime, operation.timestamp.counter, Date.now())
    else if (operation.action === 'restore') this.database.prepare('DELETE FROM media_tombstones WHERE workspace_id=? AND media_id=?').run(workspaceId, operation.entityId)
  }

  private tryCompact(workspaceId: string) {
    const manifestRow = this.database.prepare('SELECT manifest FROM snapshot_manifests WHERE workspace_id=? ORDER BY created_at DESC LIMIT 1').get(workspaceId) as { manifest?: string } | undefined
    if (!manifestRow?.manifest) return 0
    const manifest = parsed<EncryptedSnapshotManifest>(manifestRow.manifest)
    const active = this.database.prepare('SELECT actor_id FROM devices WHERE workspace_id=? AND revoked_at IS NULL').all(workspaceId) as unknown as Array<{ actor_id: string }>
    if (!active.length) return 0
    for (const device of active) {
      const row = this.database.prepare('SELECT cursor FROM device_acknowledgements WHERE workspace_id=? AND actor_id=?').get(workspaceId, device.actor_id) as { cursor?: string } | undefined
      if (!row?.cursor || !this.cursorDominates(parsed<PullCursor>(row.cursor), manifest.through)) return 0
    }
    const previous = this.compactionFloor(workspaceId)
    if (!this.cursorDominates(manifest.through, previous)) return 0
    let removed = 0
    this.database.exec('BEGIN IMMEDIATE')
    try {
      for (const [actorId, sequence] of Object.entries(manifest.through)) removed += Number(this.database.prepare('DELETE FROM operations WHERE workspace_id=? AND actor_id=? AND sequence<=?').run(workspaceId, actorId, sequence).changes)
      this.database.prepare('INSERT INTO compaction_state(workspace_id, floor, updated_at) VALUES (?, ?, ?) ON CONFLICT(workspace_id) DO UPDATE SET floor=excluded.floor, updated_at=excluded.updated_at').run(workspaceId, JSON.stringify(manifest.through), Date.now())
      this.database.exec('COMMIT')
    } catch (error) { this.database.exec('ROLLBACK'); throw error }
    this.runMaintenance(Date.now(), workspaceId)
    return removed
  }

  putSnapshot(token: string, snapshot: EncryptedSnapshot) {
    const device = this.authorize(token); if (snapshot.workspaceId !== device.workspace_id) throw new Error('Snapshot workspace does not match authorization.')
    const bytes = byteLength(snapshot); if (bytes > MAX_LEGACY_SNAPSHOT_BYTES) throw new Error('Legacy encrypted snapshot exceeds 16 MiB; use chunked snapshot transport.')
    if (snapshot.protocol !== 1 || typeof snapshot.ciphertext !== 'string' || typeof snapshot.nonce !== 'string' || typeof snapshot.sha256 !== 'string' || !snapshot.through || typeof snapshot.through !== 'object') throw new Error('Encrypted snapshot is invalid.')
    for (const [actorId, sequence] of Object.entries(snapshot.through)) { assertId(actorId, 'Snapshot actor id'); if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error('Snapshot cursor is invalid.') }
    const id = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
    this.database.prepare('INSERT OR IGNORE INTO snapshots(workspace_id, id, snapshot, byte_length, created_at) VALUES (?, ?, ?, ?, ?)').run(device.workspace_id, id, JSON.stringify(snapshot), bytes, Date.now())
    this.database.prepare('DELETE FROM snapshots WHERE workspace_id=? AND id NOT IN (SELECT id FROM snapshots WHERE workspace_id=? ORDER BY created_at DESC LIMIT ?)').run(device.workspace_id, device.workspace_id, MAX_SNAPSHOTS_PER_WORKSPACE)
    return id
  }

  putSnapshotChunk(token: string, chunk: EncryptedSnapshotChunk) {
    const device = this.authorize(token); assertId(chunk.snapshotId, 'Snapshot id')
    const bytes = byteLength(chunk)
    if (chunk.protocol !== 1 || !Number.isSafeInteger(chunk.index) || chunk.index < 0 || chunk.index >= 8_192 || !Number.isSafeInteger(chunk.plaintextBytes) || chunk.plaintextBytes < 1 || chunk.plaintextBytes > 4 * 1024 * 1024 || !validBase64(chunk.nonce, 12) || !validBase64(chunk.ciphertext) || Buffer.from(chunk.ciphertext, 'base64').byteLength !== chunk.plaintextBytes + 16 || bytes > MAX_SNAPSHOT_CHUNK_BYTES) throw new Error('Encrypted snapshot chunk is invalid or too large.')
    const existingSnapshot = this.database.prepare('SELECT 1 AS value FROM snapshot_chunks WHERE workspace_id=? AND snapshot_id=? LIMIT 1').get(device.workspace_id, chunk.snapshotId) as { value?: number } | undefined
    if (!existingSnapshot) {
      const snapshotIds = Number((this.database.prepare('SELECT COUNT(DISTINCT snapshot_id) AS value FROM snapshot_chunks WHERE workspace_id=?').get(device.workspace_id) as { value: number }).value)
      if (snapshotIds >= MAX_SNAPSHOT_IDS_PER_WORKSPACE) throw new Error('Workspace has too many staged encrypted snapshots; finish or retry an existing snapshot.')
    }
    const previous = this.database.prepare('SELECT byte_length FROM snapshot_chunks WHERE workspace_id=? AND snapshot_id=? AND chunk_index=?').get(device.workspace_id, chunk.snapshotId, chunk.index) as { byte_length?: number } | undefined
    const used = Number((this.database.prepare('SELECT COALESCE(SUM(byte_length), 0) AS value FROM snapshot_chunks WHERE workspace_id=?').get(device.workspace_id) as { value: number }).value)
    if (used - (previous?.byte_length || 0) + bytes > MAX_ENCRYPTED_SNAPSHOT_BYTES_PER_WORKSPACE) throw new Error('Workspace encrypted-snapshot quota is exceeded.')
    this.database.prepare('INSERT INTO snapshot_chunks(workspace_id, snapshot_id, chunk_index, chunk, byte_length, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id, snapshot_id, chunk_index) DO UPDATE SET chunk=excluded.chunk, byte_length=excluded.byte_length, created_at=excluded.created_at').run(device.workspace_id, chunk.snapshotId, chunk.index, JSON.stringify(chunk), bytes, Date.now())
  }

  getSnapshotChunk(token: string, snapshotId: string, index: number) {
    const device = this.authorize(token); assertId(snapshotId, 'Snapshot id')
    if (!Number.isSafeInteger(index) || index < 0) throw new Error('Snapshot chunk index is invalid.')
    const row = this.database.prepare('SELECT chunk FROM snapshot_chunks WHERE workspace_id=? AND snapshot_id=? AND chunk_index=?').get(device.workspace_id, snapshotId, index) as { chunk?: string } | undefined
    return row?.chunk ? parsed<EncryptedSnapshotChunk>(row.chunk) : null
  }

  commitSnapshotManifest(token: string, manifest: EncryptedSnapshotManifest) {
    const device = this.authorize(token); assertId(manifest.snapshotId, 'Snapshot id')
    if (manifest.workspaceId !== device.workspace_id) throw new Error('Snapshot workspace does not match authorization.')
    if (manifest.protocol !== 1 || manifest.format !== 'chunked-v1' || typeof manifest.sha256 !== 'string' || !manifest.through || typeof manifest.through !== 'object' || !Number.isSafeInteger(manifest.plaintextBytes) || manifest.plaintextBytes < 1 || manifest.plaintextBytes > MAX_SNAPSHOT_BYTES || !Number.isSafeInteger(manifest.chunkBytes) || manifest.chunkBytes < 64 * 1024 || manifest.chunkBytes > 4 * 1024 * 1024 || !Number.isSafeInteger(manifest.chunkCount) || manifest.chunkCount !== Math.ceil(manifest.plaintextBytes / manifest.chunkBytes)) throw new Error('Encrypted snapshot manifest is invalid or too large.')
    for (const [actorId, sequence] of Object.entries(manifest.through)) { assertId(actorId, 'Snapshot actor id'); if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error('Snapshot cursor is invalid.') }
    const serviceCursor = this.cursor(device.workspace_id); for (const [actorId, sequence] of Object.entries(manifest.through)) if (sequence > (serviceCursor[actorId] || 0)) throw new Error('Snapshot cursor exceeds the service operation cursor.')
    const floor = this.compactionFloor(device.workspace_id); if (!this.cursorDominates(manifest.through, floor)) throw new Error('Snapshot cursor is behind the compacted operation floor.')
    const latestRow = this.database.prepare('SELECT manifest FROM snapshot_manifests WHERE workspace_id=? ORDER BY created_at DESC LIMIT 1').get(device.workspace_id) as { manifest?: string } | undefined
    if (latestRow?.manifest && !this.cursorDominates(manifest.through, parsed<EncryptedSnapshotManifest>(latestRow.manifest).through)) throw new Error('Snapshot cursor is behind the latest committed snapshot.')
    const rows = this.database.prepare('SELECT chunk_index, chunk FROM snapshot_chunks WHERE workspace_id=? AND snapshot_id=? ORDER BY chunk_index').all(device.workspace_id, manifest.snapshotId) as unknown as Array<{ chunk_index: number; chunk: string }>
    if (rows.length !== manifest.chunkCount) throw new Error('Encrypted snapshot is incomplete and cannot be committed.')
    let plaintextBytes = 0
    for (let index = 0; index < rows.length; index += 1) {
      const chunk = parsed<EncryptedSnapshotChunk>(rows[index].chunk); const expectedBytes = Math.min(manifest.chunkBytes, manifest.plaintextBytes - index * manifest.chunkBytes)
      if (rows[index].chunk_index !== index || chunk.protocol !== 1 || chunk.snapshotId !== manifest.snapshotId || chunk.index !== index || chunk.plaintextBytes !== expectedBytes) throw new Error(`Encrypted snapshot chunk ${index} does not match its manifest.`)
      plaintextBytes += chunk.plaintextBytes
    }
    if (plaintextBytes !== manifest.plaintextBytes) throw new Error('Encrypted snapshot length does not match its manifest.')
    const now = Date.now(); const serialized = JSON.stringify(manifest)
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare('INSERT OR REPLACE INTO snapshot_manifests(workspace_id, id, manifest, byte_length, created_at) VALUES (?, ?, ?, ?, ?)').run(device.workspace_id, manifest.snapshotId, serialized, Buffer.byteLength(serialized), now)
      const retained = this.database.prepare('SELECT id FROM snapshot_manifests WHERE workspace_id=? ORDER BY created_at DESC LIMIT ?').all(device.workspace_id, MAX_SNAPSHOTS_PER_WORKSPACE) as unknown as Array<{ id: string }>
      const retain = new Set(retained.map((row) => row.id))
      for (const row of this.database.prepare('SELECT id FROM snapshot_manifests WHERE workspace_id=?').all(device.workspace_id) as unknown as Array<{ id: string }>) if (!retain.has(row.id)) { this.database.prepare('DELETE FROM snapshot_chunks WHERE workspace_id=? AND snapshot_id=?').run(device.workspace_id, row.id); this.database.prepare('DELETE FROM snapshot_manifests WHERE workspace_id=? AND id=?').run(device.workspace_id, row.id) }
      this.database.prepare('DELETE FROM snapshot_chunks WHERE workspace_id=? AND snapshot_id NOT IN (SELECT id FROM snapshot_manifests WHERE workspace_id=?) AND created_at < ?').run(device.workspace_id, device.workspace_id, now - 24 * 60 * 60 * 1000)
      this.database.exec('COMMIT')
    } catch (error) { this.database.exec('ROLLBACK'); throw error }
    return manifest.snapshotId
  }

  putMediaChunk(token: string, chunk: EncryptedMediaChunk) {
    const device = this.authorize(token); assertId(chunk.mediaId, 'Media id'); assertId(chunk.uploadId, 'Media upload id')
    if (chunk.protocol !== 1 || !Number.isSafeInteger(chunk.index) || chunk.index < 0 || chunk.index >= 8_192 || !Number.isSafeInteger(chunk.plaintextBytes) || chunk.plaintextBytes < 0 || chunk.plaintextBytes > 4 * 1024 * 1024 || !validBase64(chunk.nonce, 12) || !validBase64(chunk.ciphertext) || Buffer.from(chunk.ciphertext, 'base64').byteLength !== chunk.plaintextBytes + 16 || byteLength(chunk) > MAX_MEDIA_CHUNK_BYTES) throw new Error('Encrypted media chunk is invalid or too large.')
    this.database.prepare('DELETE FROM media_upload_chunks WHERE workspace_id=? AND created_at<? AND (media_id, upload_id) NOT IN (SELECT media_id, upload_id FROM media_manifests WHERE workspace_id=?)').run(device.workspace_id, Date.now() - STAGED_UPLOAD_GRACE_MILLISECONDS, device.workspace_id)
    const existingUpload = this.database.prepare('SELECT 1 AS value FROM media_upload_chunks WHERE workspace_id=? AND media_id=? AND upload_id=? LIMIT 1').get(device.workspace_id, chunk.mediaId, chunk.uploadId)
    if (!existingUpload) {
      const uploads = Number((this.database.prepare('SELECT COUNT(*) AS value FROM (SELECT 1 FROM media_upload_chunks WHERE workspace_id=? GROUP BY media_id, upload_id)').get(device.workspace_id) as { value: number }).value)
      if (uploads >= MAX_MEDIA_UPLOAD_IDS_PER_WORKSPACE) throw new Error('Workspace has too many staged encrypted media uploads.')
    }
    const previous = this.database.prepare('SELECT byte_length FROM media_upload_chunks WHERE workspace_id=? AND media_id=? AND upload_id=? AND chunk_index=?').get(device.workspace_id, chunk.mediaId, chunk.uploadId, chunk.index) as { byte_length?: number } | undefined
    const currentUsed = Number((this.database.prepare('SELECT COALESCE(SUM(byte_length), 0) AS value FROM media_upload_chunks WHERE workspace_id=?').get(device.workspace_id) as { value: number }).value)
    const legacyUsed = Number((this.database.prepare('SELECT COALESCE(SUM(byte_length), 0) AS value FROM media_chunks WHERE workspace_id=?').get(device.workspace_id) as { value: number }).value)
    if (currentUsed + legacyUsed - (previous?.byte_length || 0) + byteLength(chunk) > MAX_ENCRYPTED_MEDIA_BYTES_PER_WORKSPACE) throw new Error('Workspace encrypted-media quota is exceeded.')
    this.database.prepare('INSERT INTO media_upload_chunks(workspace_id, media_id, upload_id, chunk_index, chunk, byte_length, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id, media_id, upload_id, chunk_index) DO UPDATE SET chunk=excluded.chunk, byte_length=excluded.byte_length, created_at=excluded.created_at').run(device.workspace_id, chunk.mediaId, chunk.uploadId, chunk.index, JSON.stringify(chunk), byteLength(chunk), Date.now())
  }

  commitMediaManifest(token: string, manifest: EncryptedMediaManifest) {
    const device = this.authorize(token); assertId(manifest.mediaId, 'Media id'); assertId(manifest.uploadId, 'Media upload id')
    if (manifest.protocol !== 1 || manifest.format !== 'chunked-v1' || !Number.isSafeInteger(manifest.plaintextBytes) || manifest.plaintextBytes < 0 || manifest.plaintextBytes > 4 * 1024 * 1024 * 1024 || !Number.isSafeInteger(manifest.chunkBytes) || manifest.chunkBytes < 64 * 1024 || manifest.chunkBytes > 4 * 1024 * 1024 || !Number.isSafeInteger(manifest.chunkCount) || manifest.chunkCount !== Math.ceil(manifest.plaintextBytes / manifest.chunkBytes) || manifest.chunkCount > 8_192) throw new Error('Encrypted media manifest is invalid or too large.')
    const rows = this.database.prepare('SELECT chunk_index, chunk FROM media_upload_chunks WHERE workspace_id=? AND media_id=? AND upload_id=? ORDER BY chunk_index').all(device.workspace_id, manifest.mediaId, manifest.uploadId) as unknown as Array<{ chunk_index: number; chunk: string }>
    if (rows.length !== manifest.chunkCount) throw new Error('Encrypted media upload is incomplete and cannot be committed.')
    let plaintextBytes = 0
    for (let index = 0; index < rows.length; index += 1) {
      const chunk = parsed<EncryptedMediaChunk>(rows[index].chunk); const expected = Math.min(manifest.chunkBytes, manifest.plaintextBytes - index * manifest.chunkBytes)
      if (rows[index].chunk_index !== index || chunk.mediaId !== manifest.mediaId || chunk.uploadId !== manifest.uploadId || chunk.index !== index || chunk.plaintextBytes !== expected) throw new Error(`Encrypted media chunk ${index} does not match its manifest.`)
      plaintextBytes += chunk.plaintextBytes
    }
    if (plaintextBytes !== manifest.plaintextBytes) throw new Error('Encrypted media length does not match its manifest.')
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare('INSERT INTO media_manifests(workspace_id, media_id, upload_id, manifest, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(workspace_id, media_id) DO UPDATE SET upload_id=excluded.upload_id, manifest=excluded.manifest, created_at=excluded.created_at').run(device.workspace_id, manifest.mediaId, manifest.uploadId, JSON.stringify(manifest), Date.now())
      this.database.prepare('DELETE FROM media_upload_chunks WHERE workspace_id=? AND media_id=? AND upload_id<>?').run(device.workspace_id, manifest.mediaId, manifest.uploadId)
      this.database.prepare('DELETE FROM media_chunks WHERE workspace_id=? AND media_id=?').run(device.workspace_id, manifest.mediaId)
      this.database.exec('COMMIT')
    } catch (error) { this.database.exec('ROLLBACK'); throw error }
  }

  getMediaChunk(token: string, mediaId: string, index: number) {
    const device = this.authorize(token); assertId(mediaId, 'Media id')
    if (!Number.isSafeInteger(index) || index < 0) throw new Error('Media chunk index is invalid.')
    const manifest = this.database.prepare('SELECT upload_id FROM media_manifests WHERE workspace_id=? AND media_id=?').get(device.workspace_id, mediaId) as { upload_id?: string } | undefined
    const row = manifest?.upload_id
      ? this.database.prepare('SELECT chunk FROM media_upload_chunks WHERE workspace_id=? AND media_id=? AND upload_id=? AND chunk_index=?').get(device.workspace_id, mediaId, manifest.upload_id, index) as { chunk?: string } | undefined
      : this.database.prepare('SELECT chunk FROM media_chunks WHERE workspace_id=? AND media_id=? AND chunk_index=?').get(device.workspace_id, mediaId, index) as { chunk?: string } | undefined
    return row?.chunk ? parsed<EncryptedMediaChunk>(row.chunk) : null
  }

  /** Content-blind cleanup: only compacted media tombstones older than the grace period are eligible. */
  runMaintenance(now = Date.now(), workspaceId?: string) {
    const workspaces = workspaceId ? [workspaceId] : (this.database.prepare('SELECT id FROM workspaces').all() as unknown as Array<{ id: string }>).map((row) => row.id)
    let deletedMedia = 0; let deletedStagedChunks = 0
    for (const id of workspaces) {
      deletedStagedChunks += Number(this.database.prepare('DELETE FROM media_upload_chunks WHERE workspace_id=? AND created_at<? AND (media_id, upload_id) NOT IN (SELECT media_id, upload_id FROM media_manifests WHERE workspace_id=?)').run(id, now - STAGED_UPLOAD_GRACE_MILLISECONDS, id).changes)
      const floor = this.compactionFloor(id)
      const tombstones = this.database.prepare('SELECT media_id, actor_id, sequence FROM media_tombstones WHERE workspace_id=? AND deleted_at<=?').all(id, now - MEDIA_DELETE_GRACE_MILLISECONDS) as unknown as Array<{ media_id: string; actor_id: string; sequence: number }>
      for (const tombstone of tombstones) {
        if ((floor[tombstone.actor_id] || 0) < tombstone.sequence) continue
        this.database.exec('BEGIN IMMEDIATE')
        try {
          this.database.prepare('DELETE FROM media_upload_chunks WHERE workspace_id=? AND media_id=?').run(id, tombstone.media_id)
          this.database.prepare('DELETE FROM media_chunks WHERE workspace_id=? AND media_id=?').run(id, tombstone.media_id)
          this.database.prepare('DELETE FROM media_manifests WHERE workspace_id=? AND media_id=?').run(id, tombstone.media_id)
          this.database.prepare('DELETE FROM media_tombstones WHERE workspace_id=? AND media_id=?').run(id, tombstone.media_id)
          this.database.exec('COMMIT'); deletedMedia += 1
        } catch (error) { this.database.exec('ROLLBACK'); throw error }
      }
    }
    return { deletedMedia, deletedStagedChunks }
  }

  /** Aggregate operational telemetry only; no entity ids, ciphertext, or user content are returned. */
  operatorMetrics(now = Date.now()) {
    const scalar = (sql: string) => Number((this.database.prepare(sql).get() as { value: number }).value)
    const oldestAck = this.database.prepare('SELECT MIN(updated_at) AS value FROM device_acknowledgements').get() as { value?: number | null }
    return {
      generatedAt: new Date(now).toISOString(),
      accounts: scalar('SELECT COUNT(*) AS value FROM accounts'),
      workspaces: scalar('SELECT COUNT(*) AS value FROM workspaces'),
      activeDevices: scalar('SELECT COUNT(*) AS value FROM devices WHERE revoked_at IS NULL'),
      revokedDevices: scalar('SELECT COUNT(*) AS value FROM devices WHERE revoked_at IS NOT NULL'),
      retainedOperations: scalar('SELECT COUNT(*) AS value FROM operations'),
      committedSnapshots: scalar('SELECT COUNT(*) AS value FROM snapshot_manifests'),
      stagedSnapshotChunks: scalar('SELECT COUNT(*) AS value FROM snapshot_chunks WHERE (workspace_id, snapshot_id) NOT IN (SELECT workspace_id, id FROM snapshot_manifests)'),
      committedMedia: scalar('SELECT COUNT(*) AS value FROM media_manifests'),
      stagedMediaChunks: scalar('SELECT COUNT(*) AS value FROM media_upload_chunks WHERE (workspace_id, media_id, upload_id) NOT IN (SELECT workspace_id, media_id, upload_id FROM media_manifests)'),
      encryptedSnapshotBytes: scalar('SELECT COALESCE(SUM(byte_length), 0) AS value FROM snapshot_chunks'),
      encryptedMediaBytes: scalar('SELECT COALESCE(SUM(byte_length), 0) AS value FROM media_upload_chunks') + scalar('SELECT COALESCE(SUM(byte_length), 0) AS value FROM media_chunks'),
      oldestDeviceAcknowledgementAgeSeconds: oldestAck.value ? Math.max(0, Math.floor((now - oldestAck.value) / 1000)) : null,
    }
  }

  deleteAccount(token: string) {
    const device = this.authorize(token)
    this.database.prepare('DELETE FROM accounts WHERE id=?').run(device.account_id)
  }

  close() { this.database.close() }
}
