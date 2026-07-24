import { createHash, randomUUID } from 'node:crypto'
import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { readdir, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { DatabaseSync, backup as backupDatabase, type StatementSync } from 'node:sqlite'
import { unzipSync } from 'fflate'
import { decompress as decompressZstd } from 'fzstd'
import type { AppData, MediaAsset } from '../src/types.js'
import type { WorkspaceChangeSet } from '../src/lib/workspace-changes.js'
import type { WorkspaceDocumentV4, WorkspacePatchV2 } from '../packages/compatibility-domain/src/index.js'
import { applyWorkspacePatchV2 as applyDomainPatchV2, createWorkspaceDocumentV4, parseWorkspaceDocumentV4 } from '../packages/compatibility-domain/src/index.js'
import { appDataToWorkspaceDocumentV4, projectValidatedWorkspaceDocumentV4ToAppData, refreshWorkspaceDocumentV4FromProjection, workspaceDocumentV4ToAppData } from '../src/lib/workspace-v4.js'
import { mimeFromFilename } from '../src/lib/media.js'
import {
  knowledgeItemSchema,
  learningGoalSchema,
  mediaAssetSchema,
  migrateWorkspaceData,
  packConflictSchema,
  packSubscriptionSchema,
  parseWorkspaceData,
  practiceCardSchema,
  reviewEventSchema,
  savedViewSchema,
  trashEntrySchema,
  userSettingsSchema,
} from '../src/lib/workspace-schema.js'

const DATABASE_FILE = 'neo-anki.sqlite'
const LEGACY_FILE = 'neo-anki-data.json'
const DATABASE_SCHEMA_VERSION = 6
const MAX_AUTOMATIC_BACKUPS = 7
const MEDIA_SCHEME = 'neoanki-media'

interface WorkspaceStoreStatus {
  path: string
  recoveredFromBackup: boolean
  recoveryError?: string
  recoverySourcePath?: string
  migratedLegacyData: boolean
}

type ArchivedMediaLocation = { archiveName: string; entryName: string; zstd: boolean }
type StoredAssetMetadata = Omit<MediaAsset, 'dataUrl'> & { archivedMedia?: ArchivedMediaLocation }
type MigrationMediaPayload = { asset: MediaAsset; bytes?: Uint8Array }
const parseJson = <T>(value: unknown): T => JSON.parse(String(value)) as T
const stringify = (value: unknown) => JSON.stringify(value)

const dataUrlBytes = (value: string) => {
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(value)
  if (!match) throw new Error('New media must use an embedded data URL.')
  try { return match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3])) }
  catch { throw new Error('A media asset contains an invalid data URL.') }
}

const mediaUrl = (asset: Pick<MediaAsset, 'id' | 'hash'>) => `${MEDIA_SCHEME}://asset/${encodeURIComponent(asset.id)}?v=${asset.hash.slice(0, 16)}`
const resolvedMediaMimeType = (asset: Pick<MediaAsset, 'filename' | 'mimeType'>) => asset.mimeType === 'application/octet-stream' ? mimeFromFilename(asset.filename) : asset.mimeType

const migrationMediaPayload = (input: unknown): MigrationMediaPayload => {
  const raw = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const bytes = raw.bytes instanceof Uint8Array ? raw.bytes : undefined
  const parsed = mediaAssetSchema.parse({ ...raw, dataUrl: typeof raw.dataUrl === 'string' ? raw.dataUrl : `${MEDIA_SCHEME}://pending` }) as MediaAsset
  const candidate = { ...parsed, mimeType: resolvedMediaMimeType(parsed) }
  return { asset: bytes ? { ...candidate, dataUrl: mediaUrl(candidate) } : candidate, bytes }
}

const rows = <T>(statement: StatementSync) => statement.all().map((row) => parseJson<T>((row as { json: unknown }).json))
const localDateKey = (date: Date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')

const sha256 = (value: Uint8Array) => createHash('sha256').update(value).digest('hex')
const importTiming = (label: string, startedAt: number, previousAt = startedAt) => {
  const now = performance.now()
  if (process.env.NEO_ANKI_IMPORT_TIMING === '1') console.error(JSON.stringify({ type: 'neo-anki-import-timing', label, elapsedMs: Math.round(now - startedAt), phaseMs: Math.round(now - previousAt), at: Date.now() }))
  return now
}

const syncFile = (path: string) => {
  let descriptor: number | undefined
  try { descriptor = openSync(path, 'r+'); fsyncSync(descriptor) }
  finally { if (descriptor !== undefined) closeSync(descriptor) }
}

const syncDirectory = (path: string) => {
  let descriptor: number | undefined
  try { descriptor = openSync(path, 'r'); fsyncSync(descriptor) }
  finally { if (descriptor !== undefined) closeSync(descriptor) }
}

const retainVerifiedArchive = (destination: string, bytes: Uint8Array, expectedDigest: string) => {
  const parent = join(destination, '..')
  if (existsSync(destination)) {
    try {
      const stored = readFileSync(destination)
      if (stored.byteLength === bytes.byteLength && sha256(stored) === expectedDigest) return ''
    } catch { /* Quarantine unreadable rollback data below. */ }
    renameSync(destination, `${destination}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`)
    try { syncDirectory(parent) } catch { /* Directory fsync is unavailable on some platforms. */ }
  }

  const temporary = `${destination}.tmp-${randomUUID()}`
  try {
    writeFileSync(temporary, bytes, { flag: 'wx' })
    syncFile(temporary)
    if (statSync(temporary).size !== bytes.byteLength) throw new Error('The retained Anki rollback archive was truncated while writing.')
    renameSync(temporary, destination)
    try { syncDirectory(parent) } catch { /* The file itself was durably flushed above. */ }
    return destination
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}

export class WorkspaceStore {
  private db: DatabaseSync
  private readonly dbPath: string
  private readonly backupRoot: string
  private readonly importArchiveRoot: string
  private readonly statusValue: WorkspaceStoreStatus
  private readonly sourceArchiveCache = new Map<string, Uint8Array>()
  private documentCache: WorkspaceDocumentV4 | null | undefined
  private projectionCache: AppData | null | undefined
  private deferredLegacyData: AppData | null = null
  private deferredLegacyInput: unknown | undefined
  private deferredLegacyMigrationStarted = false
  private readonly allowUnvalidatedLegacyProjection: boolean

  constructor(private readonly userDataRoot: string, options: { preserveLegacySource?: boolean; allowUnvalidatedLegacyProjection?: boolean } = {}) {
    this.allowUnvalidatedLegacyProjection = options.allowUnvalidatedLegacyProjection === true
    mkdirSync(userDataRoot, { recursive: true })
    this.backupRoot = join(userDataRoot, 'backups')
    mkdirSync(this.backupRoot, { recursive: true })
    this.importArchiveRoot = join(userDataRoot, 'import-archives')
    mkdirSync(this.importArchiveRoot, { recursive: true })
    this.dbPath = join(userDataRoot, DATABASE_FILE)
    const opened = this.openRecoverableDatabase()
    this.db = opened.db
    this.statusValue = { path: this.dbPath, recoveredFromBackup: opened.recovered, recoveryError: opened.error, recoverySourcePath: opened.recoverySourcePath, migratedLegacyData: false }
    this.configure()
    this.initializeSchema()
    if (!this.statusValue.recoveryError && !this.hasWorkspace()) {
      const legacyPath = join(this.userDataRoot, LEGACY_FILE)
      if (existsSync(legacyPath)) {
        if (options.preserveLegacySource !== false) {
          const preserved = join(this.backupRoot, `legacy-json-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
          copyFileSync(legacyPath, preserved)
        }
        try { this.deferredLegacyInput = JSON.parse(readFileSync(legacyPath, 'utf8')) as unknown }
        catch (error) {
          this.statusValue.recoverySourcePath = legacyPath
          this.statusValue.recoveryError = `The legacy workspace could not be migrated. The original JSON was preserved. ${error instanceof Error ? error.message : ''}`.trim()
        }
      }
    }
  }

  private openRecoverableDatabase(): { db: DatabaseSync; recovered: boolean; error?: string; recoverySourcePath?: string } {
    const openAndCheck = () => {
      const db = new DatabaseSync(this.dbPath)
      const result = db.prepare('PRAGMA quick_check').get() as Record<string, unknown> | undefined
      if (!result || !Object.values(result).includes('ok')) { db.close(); throw new Error('SQLite integrity check failed.') }
      const schemaVersion = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
      if (schemaVersion > 0 && schemaVersion <= DATABASE_SCHEMA_VERSION) {
        try {
          const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='workspace_v4'").get()
          const invalid = table && db.prepare('SELECT 1 FROM workspace_v4 WHERE id = 1 AND json_valid(json) = 0').get()
          if (invalid) throw new Error('Workspace v4 JSON is invalid.')
          const journalTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='workspace_journal'").get()
          if (journalTable) {
            const journal = db.prepare('SELECT json, content_hash FROM workspace_journal').all() as Array<{ json: string; content_hash: string }>
            if (journal.some((row) => sha256(Buffer.from(row.json)) !== row.content_hash)) throw new Error('Workspace journal integrity check failed.')
          }
        } catch (error) { db.close(); throw error }
      }
      return db
    }
    try { return { db: openAndCheck(), recovered: false } }
    catch (initialError) {
      let recoverySourcePath: string | undefined
      if (existsSync(this.dbPath)) {
        recoverySourcePath = join(this.userDataRoot, `neo-anki.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`)
        renameSync(this.dbPath, recoverySourcePath)
      }
      const automatic = this.automaticBackupPathsSync()
      // Never replace a damaged workspace silently. Even a valid backup can be
      // older than the source and therefore discard newer knowledge. Recovery
      // remains blocked until the user explicitly exports, restores, or resets.
      rmSync(this.dbPath, { force: true })
      return {
        db: new DatabaseSync(this.dbPath),
        recovered: false,
        error: `The workspace database could not be opened. The damaged file was preserved.${automatic.length ? ` ${automatic.length} automatic backup${automatic.length === 1 ? ' is' : 's are'} available for explicit restore.` : ''} ${initialError instanceof Error ? initialError.message : ''}`.trim(),
        recoverySourcePath,
      }
    }
  }

  private configure() {
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA trusted_schema = OFF;')
  }

  private initializeSchema() {
    const current = Number((this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
    if (current > DATABASE_SCHEMA_VERSION) throw new Error(`Workspace database schema ${current} requires a newer Neo Anki release.`)
    if (current === 1 && this.hasWorkspace()) {
      this.db.exec('PRAGMA wal_checkpoint(FULL)')
      copyFileSync(this.dbPath, join(this.backupRoot, `pre-workspace-v4-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`))
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_meta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL,
        device_id TEXT NOT NULL,
        settings_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS cards (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        due TEXT NOT NULL,
        suspended INTEGER NOT NULL CHECK (suspended IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        json TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS cards_due_idx ON cards(suspended, due);
      CREATE INDEX IF NOT EXISTS cards_item_idx ON cards(item_id);
      CREATE TABLE IF NOT EXISTS reviews (
        id TEXT PRIMARY KEY,
        card_id TEXT NOT NULL,
        reviewed_at TEXT NOT NULL,
        json TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS reviews_card_idx ON reviews(card_id, reviewed_at);
      CREATE INDEX IF NOT EXISTS reviews_time_idx ON reviews(reviewed_at);
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        mime_type TEXT NOT NULL,
        hash TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        data BLOB NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS assets_hash_idx ON assets(hash);
      CREATE TABLE IF NOT EXISTS goals (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, json TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS views (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, json TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS packs (id TEXT PRIMARY KEY, installed_at TEXT NOT NULL, updated_at TEXT NOT NULL, json TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS pack_conflicts (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, json TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS trash (id TEXT PRIMARY KEY, deleted_at TEXT NOT NULL, json TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS workspace_v4 (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        revision INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        json TEXT NOT NULL,
        content_hash TEXT
      ) STRICT;
      CREATE TABLE IF NOT EXISTS patch_receipts (
        owner TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        workspace_revision INTEGER NOT NULL,
        applied_at TEXT NOT NULL,
        PRIMARY KEY(owner, idempotency_key)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS workspace_journal (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL CHECK (kind IN ('changes', 'core-patch')),
        json TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
    `)
    if (current > 0 && current < 4) {
      this.db.exec("UPDATE cards SET json = json_remove(json, '$.rendering'); DROP TABLE IF EXISTS rendering_styles;")
    }
    const workspaceColumns = this.db.prepare('PRAGMA table_info(workspace_v4)').all() as Array<{ name: string }>
    if (!workspaceColumns.some((column) => column.name === 'content_hash')) this.db.exec('ALTER TABLE workspace_v4 ADD COLUMN content_hash TEXT')
    if (current === 1 && this.hasWorkspace() && !this.db.prepare('SELECT 1 FROM workspace_v4 WHERE id = 1').get()) {
      const legacy = this.loadLegacyProjectionFromDatabase(this.db)
      if (!legacy) throw new Error('The pre-v4 workspace migration found no workspace.')
      this.storeWorkspaceDocument(appDataToWorkspaceDocumentV4(legacy))
    }
    if (current > 0 && current < 5) {
      const row = this.db.prepare('SELECT json FROM workspace_v4 WHERE id = 1').get() as { json: string } | undefined
      if (row) {
        // Validate the last pre-hash document once. Future launches can trust a
        // matching digest after SQLite integrity and JSON checks succeed.
        parseWorkspaceDocumentV4(parseJson(row.json))
        this.db.prepare('UPDATE workspace_v4 SET content_hash = ? WHERE id = 1').run(sha256(Buffer.from(row.json)))
      }
    }
    this.db.exec(`PRAGMA user_version = ${DATABASE_SCHEMA_VERSION};`)
  }

  private readDeferredLegacyData() {
    if (this.deferredLegacyData) return this.deferredLegacyData
    if (this.hasWorkspace()) return null
    const legacyPath = join(this.userDataRoot, LEGACY_FILE)
    if (!existsSync(legacyPath)) return null
    if (this.statusValue.recoveryError) return null
    try {
      const legacy = this.deferredLegacyInput ?? JSON.parse(readFileSync(legacyPath, 'utf8')) as unknown
      const candidate = legacy as Partial<AppData>
      const canProjectBeforeValidation = this.allowUnvalidatedLegacyProjection
        && candidate?.version === 3
        && typeof candidate.deviceId === 'string'
        && candidate.settings !== null
        && typeof candidate.settings === 'object'
        && typeof candidate.updatedAt === 'string'
        && ['items', 'cards', 'reviews', 'assets', 'goals', 'views', 'packs', 'packConflicts', 'trash']
          .every((key) => Array.isArray((candidate as Record<string, unknown>)[key]))
      this.deferredLegacyData = canProjectBeforeValidation
        ? legacy as AppData
        : migrateWorkspaceData(legacy as Parameters<typeof migrateWorkspaceData>[0])
      this.deferredLegacyInput = undefined
      this.statusValue.migratedLegacyData = true
      return this.deferredLegacyData
    } catch (error) {
      this.statusValue.recoverySourcePath = legacyPath
      this.statusValue.recoveryError = `The legacy workspace could not be migrated. The original JSON was preserved. ${error instanceof Error ? error.message : ''}`.trim()
      throw error
    }
  }

  /**
   * Finish first-run materialization after the validated projection has reached
   * the renderer. The original JSON remains recoverable, and every mutation
   * forces this commit first, so acknowledged writes can never overtake it.
   */
  finishDeferredLegacyMigration() {
    if (!this.deferredLegacyData || this.deferredLegacyMigrationStarted || this.hasWorkspace()) return
    this.deferredLegacyMigrationStarted = true
    try {
      const data = this.deferredLegacyData
      const document = appDataToWorkspaceDocumentV4(data)
      this.transaction(() => {
        this.db.exec('DELETE FROM reviews; DELETE FROM cards; DELETE FROM items; DELETE FROM assets; DELETE FROM goals; DELETE FROM views; DELETE FROM packs; DELETE FROM pack_conflicts; DELETE FROM trash; DELETE FROM workspace_meta; DELETE FROM workspace_v4; DELETE FROM patch_receipts; DELETE FROM workspace_journal;')
        this.persistCanonicalProjectionMetadata(data)
        this.storeValidatedWorkspaceDocument(document)
      })
      this.documentCache = document
      this.projectionCache = data
      this.deferredLegacyData = null
      this.deferredLegacyInput = undefined
    } catch (error) {
      this.deferredLegacyMigrationStarted = false
      this.statusValue.recoveryError = `The legacy workspace remains usable but could not be committed to the local database. ${error instanceof Error ? error.message : ''}`.trim()
      throw error
    }
  }

  /**
   * Adopt a migration committed by the background worker through its own
   * SQLite connection. The renderer keeps the already-loaded projection, while
   * subsequent document reads use the newly committed canonical snapshot.
   */
  acceptExternalLegacyMigration() {
    if (!this.hasWorkspace() || !this.db.prepare('SELECT 1 FROM workspace_v4 WHERE id = 1').get()) {
      throw new Error('The background legacy migration did not commit a complete workspace.')
    }
    this.documentCache = undefined
    this.deferredLegacyData = null
    this.deferredLegacyInput = undefined
    this.deferredLegacyMigrationStarted = false
    this.statusValue.migratedLegacyData = true
  }

  private transaction<T>(run: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try { const result = run(); this.db.exec('COMMIT'); return result }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  private hasWorkspace() { return Boolean(this.db.prepare('SELECT 1 FROM workspace_meta WHERE id = 1').get()) }

  status(): WorkspaceStoreStatus { return { ...this.statusValue } }
  hasDeferredLegacyMigration() { return Boolean(this.deferredLegacyData) }

  private loadLegacyProjectionFromDatabase(database: DatabaseSync): AppData | null {
    const meta = database.prepare('SELECT version, device_id, settings_json, updated_at FROM workspace_meta WHERE id = 1').get() as { version: number; device_id: string; settings_json: string; updated_at: string } | undefined
    if (!meta) return null
    const assetRows = database.prepare('SELECT hash, metadata_json FROM assets ORDER BY updated_at DESC, id').all() as Array<{ hash: string; metadata_json: string }>
    const assets = assetRows.map((row) => {
      const asset = parseJson<StoredAssetMetadata>(row.metadata_json)
      if (asset.hash !== row.hash) throw new Error(`Media ${asset.filename} has inconsistent metadata.`)
      if (asset.archivedMedia) {
        if (!existsSync(join(this.importArchiveRoot, asset.archivedMedia.archiveName))) throw new Error(`Media ${asset.filename} is missing its retained Anki source archive.`)
      }
      return { ...asset, mimeType: resolvedMediaMimeType(asset), dataUrl: mediaUrl(asset) }
    })
    return parseWorkspaceData({
      version: meta.version,
      deviceId: meta.device_id,
      settings: parseJson(meta.settings_json),
      updatedAt: meta.updated_at,
      items: rows(database.prepare('SELECT json FROM items ORDER BY created_at DESC, id')),
      cards: rows(database.prepare("SELECT json_remove(json, '$.rendering') AS json FROM cards ORDER BY created_at DESC, id")),
      reviews: rows(database.prepare('SELECT json FROM reviews ORDER BY reviewed_at, id')),
      assets,
      goals: rows(database.prepare('SELECT json FROM goals ORDER BY created_at DESC, id')),
      views: rows(database.prepare('SELECT json FROM views ORDER BY created_at DESC, id')),
      packs: rows(database.prepare('SELECT json FROM packs ORDER BY installed_at DESC, id')),
      packConflicts: rows(database.prepare('SELECT json FROM pack_conflicts ORDER BY created_at DESC, id')),
      trash: rows(database.prepare('SELECT json FROM trash ORDER BY deleted_at DESC, id')),
    })
  }

  private readWorkspaceDocument(database: DatabaseSync): WorkspaceDocumentV4 | null {
    if (database === this.db && this.documentCache !== undefined) return this.documentCache
    const table = database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='workspace_v4'").get()
    if (!table) return null
    const row = database.prepare('SELECT json, content_hash FROM workspace_v4 WHERE id = 1').get() as { json: string; content_hash?: string } | undefined
    let document: WorkspaceDocumentV4 | null = null
    if (row) {
      const digest = sha256(Buffer.from(row.json))
      if (row.content_hash && row.content_hash === digest) {
        const candidate = parseJson<WorkspaceDocumentV4>(row.json)
        if (candidate.format !== 'neo-anki-workspace' || candidate.schemaVersion !== 4 || !candidate.workspace || !candidate.clientState) throw new Error('Workspace v4 JSON has an invalid envelope.')
        document = candidate
      } else {
        document = parseWorkspaceDocumentV4(parseJson(row.json))
        if (database === this.db) database.prepare('UPDATE workspace_v4 SET content_hash = ? WHERE id = 1').run(digest)
      }
    }
    if (database === this.db) this.documentCache = document
    return document
  }

  private storeValidatedWorkspaceDocument(parsed: WorkspaceDocumentV4) {
    const json = stringify(parsed)
    this.db.prepare(`INSERT INTO workspace_v4(id, revision, updated_at, json, content_hash) VALUES (1, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, updated_at=excluded.updated_at, json=excluded.json, content_hash=excluded.content_hash`)
      .run(parsed.workspace.revision, parsed.workspace.updatedAt, json, sha256(Buffer.from(json)))
    this.db.exec('DELETE FROM workspace_journal')
    this.documentCache = parsed
  }

  private appendJournal(kind: 'changes' | 'core-patch', value: unknown) {
    const json = stringify(value)
    this.db.prepare('INSERT INTO workspace_journal(kind, json, content_hash, created_at) VALUES (?, ?, ?, ?)').run(kind, json, sha256(Buffer.from(json)), new Date().toISOString())
  }

  private storeWorkspaceDocument(document: WorkspaceDocumentV4) { this.storeValidatedWorkspaceDocument(parseWorkspaceDocumentV4(document)) }

  private cardForStorage<T extends { rendering?: unknown }>(card: T) {
    const { rendering: _rendering, ...stored } = card
    return stored
  }

  private loadFromDatabase(database: DatabaseSync): AppData | null {
    const loadedDocument = this.readWorkspaceDocument(database)
    if (!loadedDocument) return this.loadLegacyProjectionFromDatabase(database)
    let document: WorkspaceDocumentV4 = loadedDocument
    let projected = projectValidatedWorkspaceDocumentV4ToAppData(document)
    if (database === this.db) {
      const journal = database.prepare('SELECT kind, json, content_hash FROM workspace_journal ORDER BY sequence').all() as Array<{ kind: 'changes' | 'core-patch'; json: string; content_hash: string }>
      for (const row of journal) {
        if (sha256(Buffer.from(row.json)) !== row.content_hash) throw new Error('The workspace journal failed its integrity check.')
        if (row.kind === 'changes') {
          const changes = parseJson<WorkspaceChangeSet>(row.json)
          const nextProjection = this.projectionAfterChanges(projected, changes)
          this.documentCache = document
          document = this.incrementalDocumentAfterChanges(changes, projected, nextProjection)
            || refreshWorkspaceDocumentV4FromProjection(nextProjection, document)
          projected = nextProjection
        } else {
          const patch = parseJson<WorkspacePatchV2>(row.json)
          const previous: WorkspaceDocumentV4 = document
          document = { ...previous, workspace: applyDomainPatchV2(previous.workspace, patch) }
          projected = this.projectionAfterWorkspacePatch(patch, previous, document, projected)
        }
      }
      this.documentCache = document
    }
    projected.assets = projected.assets.map((asset) => ({ ...asset, dataUrl: mediaUrl(asset) }))
    return projected
  }

  load(): AppData | null {
    if (this.projectionCache !== undefined) return this.projectionCache
    const deferred = this.readDeferredLegacyData()
    this.projectionCache = deferred || this.loadFromDatabase(this.db)
    return this.projectionCache
  }

  private upsertAsset(input: unknown, suppliedBytes?: Uint8Array) {
    const asset = mediaAssetSchema.parse(input) as MediaAsset
    const existing = this.db.prepare('SELECT data FROM assets WHERE id = ?').get(asset.id) as { data: Uint8Array } | undefined
    const bytes = suppliedBytes || (asset.dataUrl.startsWith(`${MEDIA_SCHEME}:`) && existing ? Buffer.from(existing.data) : dataUrlBytes(asset.dataUrl))
    if (bytes.byteLength !== asset.byteLength) throw new Error(`Media ${asset.filename} does not match its declared byte length.`)
    const digest = createHash('sha256').update(bytes).digest('hex')
    if (asset.hash && digest !== asset.hash) throw new Error(`Media ${asset.filename} does not match its SHA-256 digest.`)
    const { dataUrl: _dataUrl, ...rawMetadata } = asset
    const metadata = { ...rawMetadata, hash: digest }
    this.db.prepare(`INSERT INTO assets(id, mime_type, hash, updated_at, metadata_json, data) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET mime_type=excluded.mime_type, hash=excluded.hash, updated_at=excluded.updated_at, metadata_json=excluded.metadata_json, data=excluded.data`)
      .run(asset.id, asset.mimeType, digest, asset.updatedAt, stringify(metadata), bytes)
  }

  private projectionAfterChanges(previous: AppData, changes: WorkspaceChangeSet): AppData {
    const merge = <T extends { id: string }>(current: T[], upsert: T[], remove: string[], appendNew = false) => {
      if (!upsert.length && !remove.length) return current
      const removed = new Set(remove)
      const replacements = new Map(upsert.map((value) => [value.id, value]))
      const existing = new Set(current.map((value) => value.id))
      const retained = current.filter((value) => !removed.has(value.id)).map((value) => replacements.get(value.id) || value)
      const added = upsert.filter((value) => !existing.has(value.id))
      return appendNew ? [...retained, ...added] : [...added, ...retained]
    }
    return {
      ...previous,
      ...(changes.meta ? { deviceId: changes.meta.deviceId, settings: changes.meta.settings, updatedAt: changes.meta.updatedAt } : {}),
      items: merge(previous.items, changes.upsert.items, changes.remove.items),
      cards: merge(previous.cards, changes.upsert.cards, changes.remove.cards),
      reviews: merge(previous.reviews, changes.upsert.reviews, changes.remove.reviews, true),
      assets: merge(previous.assets, changes.upsert.assets, changes.remove.assets),
      goals: merge(previous.goals, changes.upsert.goals, changes.remove.goals),
      views: merge(previous.views, changes.upsert.views, changes.remove.views),
      packs: merge(previous.packs, changes.upsert.packs, changes.remove.packs),
      packConflicts: merge(previous.packConflicts, changes.upsert.packConflicts, changes.remove.packConflicts),
      trash: merge(previous.trash, changes.upsert.trash, changes.remove.trash),
    }
  }

  /**
   * Incrementally refresh the durable compatibility graph for the common
   * interaction path. Inputs have already passed the per-entity schemas in the
   * same SQLite transaction; unchanged graph collections retain identity.
   */
  private incrementalDocumentAfterChanges(changes: WorkspaceChangeSet, previousProjection: AppData, nextProjection: AppData) {
    const previous = this.readWorkspaceDocument(this.db)
    if (!previous) return null
    const unsupportedUpserts = changes.upsert.assets.length || changes.upsert.goals.length || changes.upsert.views.length
      || changes.upsert.packs.length || changes.upsert.packConflicts.length || changes.upsert.trash.length
    const unsupportedRemovals = Object.values(changes.remove).some((values) => values.length)
    if (unsupportedUpserts || unsupportedRemovals) return null

    const previousItems = new Map(previousProjection.items.map((value) => [value.id, value]))
    const noteIndexes = new Map(previous.workspace.notes.map((value, index) => [value.id, index]))
    const cardIndexes = new Map(previous.workspace.cards.map((value, index) => [value.id, index]))
    const reviewIds = new Set(previous.workspace.reviews.map((value) => value.id))
    if (changes.upsert.items.some((value) => !noteIndexes.has(value.id) || previousItems.get(value.id)?.collection !== value.collection)) return null
    if (changes.upsert.cards.some((value) => !cardIndexes.has(value.id))) return null
    if (changes.upsert.reviews.some((value) => reviewIds.has(value.id))) return null

    const workspace = { ...previous.workspace }
    let notes = previous.workspace.notes
    let cards = previous.workspace.cards
    let reviews = previous.workspace.reviews
    let presets = previous.workspace.presets
    let sourceEnvelopes = previous.workspace.sourceEnvelopes
    const envelopeIndexes = new Map(sourceEnvelopes.map((value, index) => [value.id, index]))
    let envelopesChanged = false
    const updateLegacyEnvelope = (entity: { id: string; profileId: string; sourceEnvelopeId?: string }, legacy: Record<string, unknown>, updatedAt: string) => {
      let index = entity.sourceEnvelopeId ? envelopeIndexes.get(entity.sourceEnvelopeId) : undefined
      if (index === undefined) {
        const id = `source:neo-v3:${entity.id}`
        if (!envelopesChanged) { sourceEnvelopes = [...sourceEnvelopes]; envelopesChanged = true }
        index = sourceEnvelopes.length
        sourceEnvelopes.push({ id, revision: 1, createdAt: updatedAt, updatedAt, profileId: entity.profileId, format: 'neo-v3', sourceId: entity.id, schemaVersion: '3', opaque: { legacy: structuredClone(legacy) } })
        envelopeIndexes.set(id, index)
        entity.sourceEnvelopeId = id
        return
      }
      const current = sourceEnvelopes[index]
      const opaque = { ...current.opaque, legacy: structuredClone(legacy) }
      if (stringify(opaque) === stringify(current.opaque)) return
      if (!envelopesChanged) { sourceEnvelopes = [...sourceEnvelopes]; envelopesChanged = true }
      sourceEnvelopes[index] = { ...current, opaque, revision: current.revision + 1, updatedAt }
    }

    if (changes.upsert.items.length) {
      notes = [...notes]
      const noteTypes = new Map(workspace.noteTypes.map((value) => [value.id, value]))
      for (const raw of changes.upsert.items) {
        const item = knowledgeItemSchema.parse(raw)
        const index = noteIndexes.get(item.id)!
        const current = notes[index]
        const type = noteTypes.get(current.noteTypeId)
        if (!type) return null
        const fields = item.contentModel?.contentTypeId === type.id
          ? Object.fromEntries(item.contentModel.fields.filter((field) => type.fieldIds.includes(field.id)).map((field) => [field.id, field.value]))
          : Object.fromEntries(type.fieldIds.map((fieldId, ordinal) => [fieldId, ordinal === 0 ? item.prompt : ordinal === 1 ? item.answer : ordinal === 2 ? item.context : current.fields[fieldId] || '']))
        const next = { ...current, fields, tags: [...item.tags], revision: current.revision + 1, updatedAt: item.updatedAt }
        updateLegacyEnvelope(next, { source: item.source, citations: item.citations, mediaIds: item.mediaIds, occlusions: item.occlusions, provenance: item.provenance, extensionData: item.extensionData }, item.updatedAt)
        notes[index] = next
      }
    }

    if (changes.upsert.cards.length) {
      cards = [...cards]
      for (const raw of changes.upsert.cards) {
        const card = practiceCardSchema.parse(raw)
        const index = cardIndexes.get(card.id)!
        const current = cards[index]
        const next = {
          ...current,
          suspended: card.suspended,
          buriedUntil: card.buriedUntil,
          buriedBy: card.buriedBy,
          flags: (card.flags || 0) as WorkspaceDocumentV4['workspace']['cards'][number]['flags'],
          leech: card.leech,
          scheduling: {
            strategy: 'neo-fsrs' as const,
            queue: card.scheduling?.queue || (card.fsrs.reps ? 'review' as const : 'new' as const),
            dueAt: card.fsrs.due,
            stability: card.fsrs.stability,
            difficulty: card.fsrs.difficulty,
            elapsedDays: card.fsrs.elapsed_days,
            scheduledDays: card.fsrs.scheduled_days,
            reps: card.fsrs.reps,
            lapses: card.fsrs.lapses,
            state: card.fsrs.state,
            lastReviewAt: card.fsrs.last_review,
            continuityOverrideDueAt: card.scheduling?.continuityOverrideDueAt,
          },
          revision: current.revision + 1,
          updatedAt: card.updatedAt,
        }
        updateLegacyEnvelope(next, { variant: card.variant, occlusionId: card.occlusionId, promptData: card.promptData, estimatedSeconds: card.estimatedSeconds, leech: card.leech }, card.updatedAt)
        cards[index] = next
      }
    }

    if (changes.upsert.reviews.length) {
      reviews = [...reviews]
      const cardById = new Map(cards.map((value) => [value.id, value]))
      const reviewById = new Map(reviews.map((value) => [value.id, value]))
      const reversed = new Set(reviews.filter((value) => value.kind === 'reversal' && value.reversesReviewId).map((value) => value.reversesReviewId!))
      const profile = workspace.profiles.find((value) => value.active) || workspace.profiles[0]
      if (!profile) return null
      for (const raw of changes.upsert.reviews) {
        const review = reviewEventSchema.parse(raw)
        const card = cardById.get(review.cardId)
        if (!card) return null
        if (review.kind === 'reversal') {
          const target = review.reversesReviewId && reviewById.get(review.reversesReviewId)
          if (!target || target.kind === 'reversal' || target.cardId !== review.cardId || reversed.has(target.id)) return null
          reversed.add(target.id)
        }
        const entity: WorkspaceDocumentV4['workspace']['reviews'][number] = {
          id: review.id, revision: 1, createdAt: review.reviewedAt, updatedAt: review.reviewedAt,
          profileId: card.profileId || profile.id, cardId: review.cardId, kind: review.kind || 'review' as const,
          rating: review.rating, reviewedAt: review.reviewedAt, durationMilliseconds: Math.max(0, Math.round(review.durationSeconds * 1000)),
          intervalBefore: review.previousCard?.scheduled_days || 0,
          intervalAfter: Math.max(0, Math.round((Date.parse(review.nextDue) - Date.parse(review.reviewedAt)) / 86_400_000)),
          reversesReviewId: review.reversesReviewId,
          previousScheduling: review.previousScheduling ? structuredClone(review.previousScheduling) : undefined,
          nextScheduling: structuredClone(card.scheduling),
          previousEstimatedSeconds: review.previousEstimatedSeconds,
          previousCardState: review.previousCardState ? {
            ...structuredClone(review.previousCardState),
            flags: review.previousCardState.flags as WorkspaceDocumentV4['workspace']['cards'][number]['flags'] | undefined,
          } : undefined,
          siblingChanges: review.siblingChanges ? structuredClone(review.siblingChanges) : undefined,
          sourceEnvelopeId: undefined as string | undefined,
        }
        updateLegacyEnvelope(entity, { deviceId: review.deviceId, rawDurationSeconds: review.rawDurationSeconds, previousDue: review.previousDue, nextDue: review.nextDue, previousCard: review.previousCard }, review.reviewedAt)
        reviews.push(entity)
        reviewById.set(entity.id, entity)
      }
    }

    let clientState = previous.clientState
    if (changes.meta) {
      clientState = { ...clientState, settings: { ...structuredClone(clientState.settings), ...structuredClone(nextProjection.settings) } }
      const activeProfile = workspace.profiles.find((value) => value.active) || workspace.profiles[0]
      const presetIndex = presets.findIndex((value) => value.profileId === activeProfile?.id)
      if (presetIndex >= 0) {
        presets = [...presets]
        const current = presets[presetIndex]
        const next = { ...current, desiredRetention: nextProjection.settings.retention, buryNewSiblings: nextProjection.settings.burySiblings, buryReviewSiblings: nextProjection.settings.burySiblings, leechThreshold: nextProjection.settings.leechThreshold, leechAction: nextProjection.settings.leechAction }
        if (stringify(next) !== stringify(current)) presets[presetIndex] = { ...next, revision: current.revision + 1, updatedAt: changes.meta.updatedAt }
      }
    }

    workspace.notes = notes
    workspace.cards = cards
    workspace.reviews = reviews
    workspace.presets = presets
    workspace.sourceEnvelopes = sourceEnvelopes
    workspace.revision = previous.workspace.revision + 1
    workspace.updatedAt = changes.meta?.updatedAt || nextProjection.updatedAt
    return { ...previous, workspace, clientState }
  }

  applyChanges(changes: WorkspaceChangeSet) {
    if (!changes || changes.version !== 1 || !changes.upsert || !changes.remove) throw new Error('Workspace change set is invalid.')
    if (changes.remove.reviews.length) throw new Error('Review history is append-only; append a reversal event instead of deleting a review.')
    if (this.deferredLegacyData) this.finishDeferredLegacyMigration()
    const loadedProjection = this.load()
    const previousProjection: AppData = loadedProjection || {
      version: 3,
      deviceId: changes.meta?.deviceId || '',
      settings: changes.meta?.settings as AppData['settings'],
      updatedAt: changes.meta?.updatedAt || new Date().toISOString(),
      items: [], cards: [], reviews: [], assets: [], goals: [], views: [], packs: [], packConflicts: [], trash: [],
    }
    if (!changes.meta && !loadedProjection) throw new Error('An initial workspace commit requires metadata.')
    const nextProjection = this.projectionAfterChanges(previousProjection, changes)
    this.transaction(() => {
      for (const value of changes.upsert.items) knowledgeItemSchema.parse(value)
      for (const value of changes.upsert.cards) practiceCardSchema.parse(value)
      for (const value of changes.upsert.reviews) reviewEventSchema.parse(value)
      for (const value of changes.upsert.assets) this.upsertAsset(value)
      for (const value of changes.upsert.goals) learningGoalSchema.parse(value)
      for (const value of changes.upsert.views) savedViewSchema.parse(value)
      for (const value of changes.upsert.packs) packSubscriptionSchema.parse(value)
      for (const value of changes.upsert.packConflicts) packConflictSchema.parse(value)
      for (const value of changes.upsert.trash) trashEntrySchema.parse(value)
      const removeAsset = this.db.prepare('DELETE FROM assets WHERE id = ?')
      changes.remove.assets.forEach((value) => removeAsset.run(value))

      if (changes.meta) {
        const settings = userSettingsSchema.parse(changes.meta.settings)
        const updatedAt = new Date(changes.meta.updatedAt)
        if (!changes.meta.deviceId || !Number.isFinite(updatedAt.getTime())) throw new Error('Workspace metadata is invalid.')
        this.db.prepare('INSERT INTO workspace_meta(id, version, device_id, settings_json, updated_at) VALUES (1, 3, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET version=3, device_id=excluded.device_id, settings_json=excluded.settings_json, updated_at=excluded.updated_at').run(changes.meta.deviceId, stringify(settings), updatedAt.toISOString())
      }
      if (this.hasWorkspace()) {
        const existingDocument = this.readWorkspaceDocument(this.db)
        if (!existingDocument) {
          this.storeValidatedWorkspaceDocument(refreshWorkspaceDocumentV4FromProjection(nextProjection))
        } else {
          const document = this.incrementalDocumentAfterChanges(changes, previousProjection, nextProjection)
            || refreshWorkspaceDocumentV4FromProjection(nextProjection, existingDocument)
          this.appendJournal('changes', changes)
          this.documentCache = document
        }
      }
    })
    this.projectionCache = nextProjection
  }

  replaceAll(input: unknown) {
    const isV4 = (input as Partial<WorkspaceDocumentV4>)?.format === 'neo-anki-workspace'
    const document = isV4 ? parseWorkspaceDocumentV4(input) : appDataToWorkspaceDocumentV4(parseWorkspaceData(input))
    const data = workspaceDocumentV4ToAppData(document)
    this.transaction(() => {
      this.db.exec('DELETE FROM reviews; DELETE FROM cards; DELETE FROM items; DELETE FROM assets; DELETE FROM goals; DELETE FROM views; DELETE FROM packs; DELETE FROM pack_conflicts; DELETE FROM trash; DELETE FROM workspace_meta; DELETE FROM workspace_v4; DELETE FROM patch_receipts; DELETE FROM workspace_journal;')
      this.applyChangesWithoutTransaction(data)
      this.storeWorkspaceDocument(document)
    })
    this.projectionCache = data
    this.deferredLegacyData = null
  }

  commitWorkspaceV4Import(input: { document: unknown; media: unknown[]; sourceArchive?: Uint8Array; operation: 'additive' | 'replace-profile' }) {
    const timingStarted = performance.now(); let timingPrevious = importTiming('store-entered', timingStarted)
    const imported = parseWorkspaceDocumentV4(input.document)
    imported.workspace.media = imported.workspace.media.map((asset) => ({ ...asset, mimeType: resolvedMediaMimeType(asset) }))
    timingPrevious = importTiming('document-parsed', timingStarted, timingPrevious)
    const rootEnvelope = imported.workspace.sourceEnvelopes.find((value) => value.sha256 && (value.format === 'anki-apkg' || value.format === 'anki-colpkg'))
    let createdArchivePath = ''
    if (input.sourceArchive) {
      const digest = sha256(input.sourceArchive)
      if (!rootEnvelope?.sha256 || digest !== rootEnvelope.sha256) throw new Error('The retained Anki rollback archive does not match the preflight digest.')
      const extension = rootEnvelope.format === 'anki-colpkg' ? 'colpkg' : 'apkg'
      const destination = join(this.importArchiveRoot, `${digest}.${extension}`)
      createdArchivePath = retainVerifiedArchive(destination, input.sourceArchive, digest)
    }
    timingPrevious = importTiming('archive-retained', timingStarted, timingPrevious)
    const mediaPayloads = input.media.map(migrationMediaPayload)
    const mediaById = new Map(mediaPayloads.map((value) => [value.asset.id, value.asset]))
    const mediaBytesById = new Map(mediaPayloads.flatMap((value) => value.bytes ? [[value.asset.id, value.bytes] as const] : []))
    const archivedMediaById = new Map<string, ArchivedMediaLocation>()
    if (rootEnvelope?.sha256 && input.sourceArchive) {
      const archiveName = `${rootEnvelope.sha256}.${rootEnvelope.format === 'anki-colpkg' ? 'colpkg' : 'apkg'}`
      const envelopes = new Map(imported.workspace.sourceEnvelopes.map((value) => [value.id, value]))
      for (const asset of imported.workspace.media) {
        const source = envelopes.get(asset.sourceEnvelopeId || '')
        const entryName = String(source?.opaque?.originalAssetId ?? '')
        if (/^\d+$/.test(entryName)) archivedMediaById.set(asset.id, { archiveName, entryName, zstd: rootEnvelope.schemaVersion === 'latest-zstd' })
      }
    }
    if (process.env.NEO_ANKI_IMPORT_TIMING === '1') console.error(JSON.stringify({ type: 'neo-anki-import-timing', label: 'archive-media-locators', count: archivedMediaById.size, at: Date.now() }))
    const previous = this.readWorkspaceDocument(this.db)
    timingPrevious = importTiming('media-and-previous-parsed', timingStarted, timingPrevious)
    let document: WorkspaceDocumentV4
    if (!previous) {
      document = imported
      document.clientState.settings = { ...document.clientState.settings, onboardingComplete: true }
    } else {
      const root = imported.workspace.sourceEnvelopes.find((value) => value.sha256 && (value.format === 'anki-apkg' || value.format === 'anki-colpkg'))
      if (root && previous.workspace.sourceEnvelopes.some((value) => value.sha256 === root.sha256 && value.format === root.format)) return this.load()
      const workspace = {
        ...previous.workspace,
        profiles: [...previous.workspace.profiles], noteTypes: [...previous.workspace.noteTypes], fields: [...previous.workspace.fields], templates: [...previous.workspace.templates],
        decks: [...previous.workspace.decks], presets: [...previous.workspace.presets], notes: [...previous.workspace.notes], cards: [...previous.workspace.cards], reviews: [...previous.workspace.reviews],
        media: [...previous.workspace.media], extensionRecords: [...previous.workspace.extensionRecords], sourceEnvelopes: [...previous.workspace.sourceEnvelopes],
      }
      const importedWorkspace = imported.workspace
      const existingSourceProfile = root ? previous.workspace.sourceEnvelopes.find((value) => value.format === root.format && value.sourceId === root.sourceId)?.profileId : undefined
      const replacedProfiles = new Set(input.operation === 'replace-profile' ? workspace.profiles.filter((value) => value.active).map((value) => value.id) : existingSourceProfile ? [existingSourceProfile] : [])
      if (replacedProfiles.size) {
        const removedNoteTypes = new Set(workspace.noteTypes.filter((value) => replacedProfiles.has(value.profileId)).map((value) => value.id))
        workspace.profiles = workspace.profiles.filter((value) => !replacedProfiles.has(value.id))
        workspace.noteTypes = workspace.noteTypes.filter((value) => !replacedProfiles.has(value.profileId))
        workspace.fields = workspace.fields.filter((value) => !removedNoteTypes.has(value.noteTypeId))
        workspace.templates = workspace.templates.filter((value) => !removedNoteTypes.has(value.noteTypeId))
        workspace.decks = workspace.decks.filter((value) => !replacedProfiles.has(value.profileId))
        workspace.presets = workspace.presets.filter((value) => !replacedProfiles.has(value.profileId))
        workspace.notes = workspace.notes.filter((value) => !replacedProfiles.has(value.profileId))
        workspace.cards = workspace.cards.filter((value) => !replacedProfiles.has(value.profileId))
        workspace.reviews = workspace.reviews.filter((value) => !replacedProfiles.has(value.profileId))
        workspace.media = workspace.media.filter((value) => !replacedProfiles.has(value.profileId))
        workspace.extensionRecords = workspace.extensionRecords.filter((value) => !replacedProfiles.has(value.profileId))
        workspace.sourceEnvelopes = workspace.sourceEnvelopes.filter((value) => !replacedProfiles.has(value.profileId))
      }
      const replacingActiveProfile = input.operation === 'replace-profile'
      const importedProfiles = importedWorkspace.profiles.map((value, index) => ({ ...value, active: replacingActiveProfile ? index === 0 : false }))
      const merge = <T extends { id: string }>(target: T[], incoming: T[], label: string) => {
        const ids = new Set(target.map((value) => value.id))
        for (const value of incoming) {
          if (ids.has(value.id)) throw new Error(`Anki import ${label} collision: ${value.id}.`)
          ids.add(value.id); target.push(value)
        }
      }
      merge(workspace.profiles, importedProfiles, 'profile')
      merge(workspace.noteTypes, importedWorkspace.noteTypes, 'note type')
      merge(workspace.fields, importedWorkspace.fields, 'field')
      merge(workspace.templates, importedWorkspace.templates, 'template')
      merge(workspace.decks, importedWorkspace.decks, 'deck')
      merge(workspace.presets, importedWorkspace.presets, 'preset')
      merge(workspace.notes, importedWorkspace.notes, 'note')
      merge(workspace.cards, importedWorkspace.cards, 'card')
      merge(workspace.reviews, importedWorkspace.reviews, 'review')
      merge(workspace.media, importedWorkspace.media, 'media')
      merge(workspace.extensionRecords, importedWorkspace.extensionRecords, 'extension record')
      merge(workspace.sourceEnvelopes, importedWorkspace.sourceEnvelopes, 'source envelope')
      workspace.revision += 1; workspace.updatedAt = new Date().toISOString()
      document = { ...previous, workspace }
      const incomingIds = new Set([...importedWorkspace.notes.map((value) => `note:${value.id}`), ...importedWorkspace.cards.map((value) => `card:${value.id}`)])
      document.clientState = { ...previous.clientState, tombstones: (previous.clientState.tombstones || []).filter((value) => !incomingIds.has(`${value.kind}:${value.id}`)) }
      if (replacingActiveProfile) document.clientState.settings = { ...document.clientState.settings, onboardingComplete: true }
    }
    const projected = projectValidatedWorkspaceDocumentV4ToAppData(document)
    timingPrevious = importTiming('workspace-projected', timingStarted, timingPrevious)
    projected.assets = projected.assets.map((asset) => {
      const payload = mediaById.get(asset.id)
      return payload ? { ...asset, dataUrl: mediaUrl(payload), altText: payload.altText } : asset
    })
    const persistedProjection = projected
    timingPrevious = importTiming('card-renderings-materialized', timingStarted, timingPrevious)
    try {
      // The WAL commit is still synchronous and durable. Deferring its bulk
      // checkpoint keeps database compaction outside the import critical path.
      this.db.exec('PRAGMA wal_autocheckpoint = 0')
      this.transaction(() => {
        const replaceAssets = !previous
        this.db.exec(`DELETE FROM reviews; DELETE FROM cards; DELETE FROM items; ${replaceAssets ? 'DELETE FROM assets;' : ''} DELETE FROM goals; DELETE FROM views; DELETE FROM packs; DELETE FROM pack_conflicts; DELETE FROM trash; DELETE FROM workspace_meta; DELETE FROM workspace_v4;`)
        this.applyChangesWithoutTransaction(persistedProjection, mediaBytesById, archivedMediaById)
        timingPrevious = importTiming('legacy-tables-written', timingStarted, timingPrevious)
        if (!replaceAssets) {
          const keep = new Set(projected.assets.map((value) => value.id))
          const stored = this.db.prepare('SELECT id FROM assets').all() as Array<{ id: string }>
          const remove = this.db.prepare('DELETE FROM assets WHERE id = ?')
          stored.forEach((value) => { if (!keep.has(value.id)) remove.run(value.id) })
        }
        this.storeValidatedWorkspaceDocument(document)
        timingPrevious = importTiming('workspace-document-written', timingStarted, timingPrevious)
      })
    } catch (error) { if (createdArchivePath) rmSync(createdArchivePath, { force: true }); throw error }
    finally { this.db.exec('PRAGMA wal_autocheckpoint = 1000') }
    importTiming('transaction-committed', timingStarted, timingPrevious)
    this.projectionCache = projected
    return projected
  }

  commitSynchronizedWorkspace(input: { document: unknown; media: unknown[] }) {
    const document = parseWorkspaceDocumentV4(input.document)
    const payload = input.media.map((value) => mediaAssetSchema.parse(value) as MediaAsset)
    const expected = new Set(document.workspace.media.map((value) => value.id))
    if (payload.length !== expected.size || payload.some((value) => !expected.delete(value.id)) || expected.size) throw new Error('Synchronized media payload does not exactly match workspace media metadata.')
    return this.commitWorkspaceV4Import({ document, media: payload, operation: 'replace-profile' })
  }

  workspaceV4ExportPayload() {
    const document = this.readWorkspaceDocument(this.db)
    if (!document) throw new Error('Workspace v4 is not active.')
    const projected = workspaceDocumentV4ToAppData(document)
    const metadata = new Map(projected.assets.map((value) => [value.id, value]))
    const media = document.workspace.media.map((asset) => {
      const stored = this.readAsset(asset.id)
      if (!stored) throw new Error(`Media ${asset.filename} is missing from local storage.`)
      const source = metadata.get(asset.id)
      return { id: asset.id, filename: asset.filename, mimeType: asset.mimeType, dataUrl: `data:${asset.mimeType};base64,${Buffer.from(stored.bytes).toString('base64')}`, byteLength: asset.byteLength, hash: asset.sha256, altText: source?.altText || '', createdAt: asset.createdAt, updatedAt: asset.updatedAt }
    })
    return { document, media }
  }

  workspaceV4Document() {
    const document = this.readWorkspaceDocument(this.db)
    if (!document) throw new Error('Workspace v4 is not active.')
    return structuredClone(document)
  }

  workspaceV4EditorDocument() {
    const document = this.readWorkspaceDocument(this.db)
    if (!document) throw new Error('Workspace v4 is not active.')
    const noteIds = new Set<string>()
    for (const type of document.workspace.noteTypes) {
      const note = document.workspace.notes.find((candidate) => candidate.noteTypeId === type.id)
      if (note) noteIds.add(note.id)
    }
    return {
      ...document,
      workspace: {
        ...document.workspace,
        notes: document.workspace.notes.filter((note) => noteIds.has(note.id)),
        cards: document.workspace.cards.filter((card) => noteIds.has(card.noteId)),
        reviews: [],
        media: [],
        extensionRecords: [],
        sourceEnvelopes: [],
      },
      clientState: { ...document.clientState, goals: [], views: [], packs: [], packConflicts: [], trash: [], tombstones: [] },
    } satisfies WorkspaceDocumentV4
  }

  workspaceRevision() { return this.readWorkspaceDocument(this.db)?.workspace.revision || 0 }

  private projectionAfterWorkspacePatch(patch: WorkspacePatchV2, previousDocument: WorkspaceDocumentV4, document: WorkspaceDocumentV4, currentProjection?: AppData) {
    const current = currentProjection || this.load()
    if (!current) return projectValidatedWorkspaceDocumentV4ToAppData(document)
    if (patch.operations.some((operation) => !['noteType', 'field', 'template', 'preset', 'deck'].includes(operation.kind))) {
      return projectValidatedWorkspaceDocumentV4ToAppData(document)
    }
    let items = current.items
    let cards = current.cards
    for (const operation of patch.operations) {
      if (operation.op === 'delete' || !operation.value) return projectValidatedWorkspaceDocumentV4ToAppData(document)
      if (operation.kind === 'noteType') {
        const noteType = operation.value as WorkspaceDocumentV4['workspace']['noteTypes'][number]
        items = items.map((item) => item.contentModel?.contentTypeId === noteType.id
          ? { ...item, contentModel: { ...item.contentModel, contentTypeName: noteType.name } }
          : item)
      } else if (operation.kind === 'preset') {
        const preset = operation.value as WorkspaceDocumentV4['workspace']['presets'][number]
        const schedulerOptions = {
          desiredRetention: preset.desiredRetention,
          maximumIntervalDays: preset.maximumIntervalDays,
          learningStepsMinutes: [...preset.learningStepsMinutes],
          relearningStepsMinutes: [...preset.relearningStepsMinutes],
          newCardsPerDay: preset.newCardsPerDay,
          reviewsPerDay: preset.reviewsPerDay,
          buryNewSiblings: preset.buryNewSiblings,
          buryReviewSiblings: preset.buryReviewSiblings,
          leechThreshold: preset.leechThreshold,
          leechAction: preset.leechAction,
        }
        cards = cards.map((card) => card.presetId === preset.id ? { ...card, schedulerOptions } : card)
      } else if (operation.kind === 'deck') {
        const deck = operation.value as WorkspaceDocumentV4['workspace']['decks'][number]
        const affected = new Set(previousDocument.workspace.cards.filter((card) => card.deckId === deck.id).map((card) => card.id))
        cards = cards.map((card) => affected.has(card.id) ? { ...card, deckName: deck.name, presetId: deck.presetId } : card)
      }
    }
    const renderingCardIds = this.renderingCardIdsAfterPatch(patch, previousDocument, document)
    if (renderingCardIds.size) cards = cards.map((card) => renderingCardIds.has(card.id) ? { ...card, rendering: undefined } : card)
    return { ...current, items, cards, updatedAt: document.workspace.updatedAt }
  }

  private renderingCardIdsAfterPatch(patch: WorkspacePatchV2, previousDocument: WorkspaceDocumentV4, document: WorkspaceDocumentV4) {
    const noteTypeIds = new Set<string>()
    const templateIds = new Set<string>()
    for (const operation of patch.operations) {
      if (operation.kind === 'noteType') noteTypeIds.add(operation.id)
      if (operation.kind === 'template') {
        templateIds.add(operation.id)
        const value = operation.value as WorkspaceDocumentV4['workspace']['templates'][number] | undefined
        const previous = previousDocument.workspace.templates.find((candidate) => candidate.id === operation.id)
        if (value?.noteTypeId) noteTypeIds.add(value.noteTypeId)
        if (previous?.noteTypeId) noteTypeIds.add(previous.noteTypeId)
      }
      if (operation.kind === 'field') {
        const value = operation.value as WorkspaceDocumentV4['workspace']['fields'][number] | undefined
        const previous = previousDocument.workspace.fields.find((candidate) => candidate.id === operation.id)
        if (value?.noteTypeId) noteTypeIds.add(value.noteTypeId)
        if (previous?.noteTypeId) noteTypeIds.add(previous.noteTypeId)
      }
    }
    for (const template of document.workspace.templates) if (noteTypeIds.has(template.noteTypeId)) templateIds.add(template.id)
    return new Set(document.workspace.cards.filter((card) => templateIds.has(card.templateId)).map((card) => card.id))
  }

  private coreProjectionPatch(patch: WorkspacePatchV2, previousDocument: WorkspaceDocumentV4, document: WorkspaceDocumentV4) {
    const renderingCardIds = this.renderingCardIdsAfterPatch(patch, previousDocument, document)
    const relevantTemplateIds = new Set(document.workspace.cards.filter((card) => renderingCardIds.has(card.id)).map((card) => card.templateId))
    const relevantNoteTypeIds = new Set(document.workspace.templates.filter((template) => relevantTemplateIds.has(template.id)).map((template) => template.noteTypeId))
    const deckCards: Array<{ deckId: string; cardIds: string[] }> = []
    for (const operation of patch.operations) {
      if (operation.kind !== 'deck') continue
      deckCards.push({ deckId: operation.id, cardIds: previousDocument.workspace.cards.filter((card) => card.deckId === operation.id).map((card) => card.id) })
    }
    return {
      updatedAt: document.workspace.updatedAt,
      noteTypes: document.workspace.noteTypes.filter((value) => relevantNoteTypeIds.has(value.id)),
      fields: document.workspace.fields.filter((value) => relevantNoteTypeIds.has(value.noteTypeId)),
      templates: document.workspace.templates.filter((value) => relevantTemplateIds.has(value.id)),
      renderingCards: document.workspace.cards.filter((card) => renderingCardIds.has(card.id)).map((card) => ({ id: card.id, templateId: card.templateId })),
      deckCards,
    }
  }

  applyCoreWorkspacePatch(patch: WorkspacePatchV2) {
    if (this.deferredLegacyData) this.finishDeferredLegacyMigration()
    const previous = this.readWorkspaceDocument(this.db)
    if (!previous) throw new Error('Workspace v4 is not active.')
    if (patch.owner.type !== 'core') throw new Error('Core workspace patches must use the core owner.')
    const owner = 'core'; const requestHash = sha256(Buffer.from(stringify(patch)))
    const receipt = this.db.prepare('SELECT request_hash FROM patch_receipts WHERE owner=? AND idempotency_key=?').get(owner, patch.idempotencyKey) as { request_hash: string } | undefined
    if (receipt) {
      if (receipt.request_hash !== requestHash) throw new Error('A different core patch already used this idempotency key.')
      return { workspaceRevision: previous.workspace.revision, updatedAt: previous.workspace.updatedAt, projectionPatch: this.coreProjectionPatch(patch, previous, previous) }
    }
    const document: WorkspaceDocumentV4 = { ...previous, workspace: applyDomainPatchV2(previous.workspace, patch) }
    const projected = this.projectionAfterWorkspacePatch(patch, previous, document)
    const projectionPatch = this.coreProjectionPatch(patch, previous, document)
    this.transaction(() => {
      this.appendJournal('core-patch', patch)
      this.db.prepare('INSERT INTO patch_receipts(owner, idempotency_key, request_hash, workspace_revision, applied_at) VALUES (?, ?, ?, ?, ?)').run(owner, patch.idempotencyKey, requestHash, document.workspace.revision, new Date().toISOString())
    })
    this.documentCache = document
    this.projectionCache = projected
    return { workspaceRevision: document.workspace.revision, updatedAt: document.workspace.updatedAt, projectionPatch }
  }

  applyExtensionWorkspacePatch(extensionId: string, patch: WorkspacePatchV2) {
    const previous = this.readWorkspaceDocument(this.db)
    if (!previous) throw new Error('Workspace v4 is not active.')
    if (patch.owner.type !== 'extension' || patch.owner.extensionId !== extensionId) throw new Error('Extension patch owner does not match its capability.')
    const owner = `extension:${extensionId}`; const requestHash = sha256(Buffer.from(stringify(patch)))
    const receipt = this.db.prepare('SELECT request_hash FROM patch_receipts WHERE owner=? AND idempotency_key=?').get(owner, patch.idempotencyKey) as { request_hash: string } | undefined
    if (receipt) {
      if (receipt.request_hash !== requestHash) throw new Error('A different extension patch already used this idempotency key.')
      return { workspaceRevision: previous.workspace.revision, data: this.load()! }
    }
    const document = createWorkspaceDocumentV4(applyDomainPatchV2(previous.workspace, patch), previous.clientState)
    const projected = workspaceDocumentV4ToAppData(document)
    const existing = this.load()
    const urls = new Map((existing?.assets || []).map((value) => [value.id, value.dataUrl]))
    projected.assets = projected.assets.map((value) => ({ ...value, dataUrl: urls.get(value.id) || value.dataUrl }))
    this.transaction(() => {
      this.storeValidatedWorkspaceDocument(document)
      this.db.prepare('UPDATE workspace_meta SET settings_json = ?, updated_at = ? WHERE id = 1').run(stringify(projected.settings), document.workspace.updatedAt)
      this.db.prepare('INSERT INTO patch_receipts(owner, idempotency_key, request_hash, workspace_revision, applied_at) VALUES (?, ?, ?, ?, ?)').run(owner, patch.idempotencyKey, requestHash, document.workspace.revision, new Date().toISOString())
    })
    this.projectionCache = projected
    return { workspaceRevision: document.workspace.revision, data: projected }
  }

  readExtensionConfig(extensionId: string) {
    const document = this.readWorkspaceDocument(this.db)
    if (!document) throw new Error('Workspace v4 is not active.')
    const container = document.clientState.settings.extensionConfig
    if (!container || typeof container !== 'object' || Array.isArray(container)) return null
    const value = (container as Record<string, unknown>)[extensionId]
    return value === undefined ? null : structuredClone(value)
  }

  writeExtensionConfig(extensionId: string, value: unknown) {
    const document = this.readWorkspaceDocument(this.db)
    if (!document) throw new Error('Workspace v4 is not active.')
    let encoded: string
    try { encoded = JSON.stringify(value) }
    catch { throw new Error('Extension configuration must be serializable JSON.') }
    if (encoded === undefined || Buffer.byteLength(encoded) > 256 * 1024) throw new Error('Extension configuration exceeds 256 KiB.')
    const parsed = JSON.parse(encoded) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && ['__proto__', 'prototype', 'constructor'].some((key) => Object.prototype.hasOwnProperty.call(parsed, key))) throw new Error('Extension configuration contains an unsafe key.')
    const previous = document.clientState.settings.extensionConfig
    const next = previous && typeof previous === 'object' && !Array.isArray(previous) ? structuredClone(previous) as Record<string, unknown> : {}
    next[extensionId] = parsed
    document.clientState.settings.extensionConfig = next
    document.workspace.revision += 1
    document.workspace.updatedAt = new Date().toISOString()
    const validated = createWorkspaceDocumentV4(document.workspace, document.clientState)
    const projected = workspaceDocumentV4ToAppData(validated)
    this.transaction(() => {
      this.storeWorkspaceDocument(validated)
      this.db.prepare('UPDATE workspace_meta SET settings_json = ?, updated_at = ? WHERE id = 1').run(stringify(projected.settings), validated.workspace.updatedAt)
    })
    this.projectionCache = projected
    return { workspaceRevision: validated.workspace.revision, data: projected }
  }

  extensionContentNotes(extensionId: string, query: { cursor?: string; limit?: number; noteIds?: string[] } = {}) {
    const document = this.readWorkspaceDocument(this.db)
    if (!document) throw new Error('Workspace v4 is not active.')
    const limit = Math.max(1, Math.min(500, Number.isInteger(query.limit) ? Number(query.limit) : 200))
    const cursor = query.cursor ? Number.parseInt(query.cursor, 10) : 0
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('Extension content cursor is invalid.')
    const requested = query.noteIds === undefined ? null : new Set(query.noteIds.slice(0, 500).filter((id) => typeof id === 'string' && id.length <= 240))
    const tombstonedNotes = new Set((document.clientState.tombstones || []).filter((value) => value.kind === 'note').map((value) => value.id))
    const tombstonedCards = new Set((document.clientState.tombstones || []).filter((value) => value.kind === 'card').map((value) => value.id))
    const candidates = document.workspace.notes.filter((note) => !tombstonedNotes.has(note.id) && (!requested || requested.has(note.id)))
    const records = new Map(document.workspace.extensionRecords.filter((record) => record.extensionId === extensionId && record.targetKind === 'note').map((record) => [record.targetId, record]))
    const noteTypes = new Map(document.workspace.noteTypes.map((value) => [value.id, value]))
    const decks = new Map(document.workspace.decks.map((value) => [value.id, value]))
    const firstCardByNote = new Map<string, WorkspaceDocumentV4['workspace']['cards'][number]>()
    for (const card of document.workspace.cards) if (!tombstonedCards.has(card.id) && !firstCardByNote.has(card.noteId)) firstCardByNote.set(card.noteId, card)
    const page = candidates.slice(cursor, cursor + limit)
    return {
      workspaceRevision: document.workspace.revision,
      notes: page.map((note) => {
        const record = records.get(note.id)
        const ordered = (noteTypes.get(note.noteTypeId)?.fieldIds || []).map((fieldId) => note.fields[fieldId] || '')
        const deckName = decks.get(firstCardByNote.get(note.id)?.deckId || '')?.name || 'Default'
        return { noteId: note.id, profileId: note.profileId, prompt: ordered[0] || '', answer: ordered[1] || ordered[0] || '', context: ordered.slice(2).filter(Boolean).join('\n'), deckName, tags: [...note.tags], ...(record ? { record: { id: record.id, revision: record.revision, createdAt: record.createdAt, updatedAt: record.updatedAt, value: structuredClone(record.value) } } : {}) }
      }),
      availableMediaIds: document.workspace.media.map((asset) => asset.id),
      ...(cursor + page.length < candidates.length ? { nextCursor: String(cursor + page.length) } : {}),
    }
  }

  createExtensionMedia(extensionId: string, input: { filename: string; mimeType: string; bytes: Uint8Array; altText?: string }) {
    if (!input.filename || input.filename.length > 240 || !input.mimeType || input.mimeType.length > 120) throw new Error('Extension media metadata is invalid.')
    const bytes = new Uint8Array(input.bytes)
    if (!bytes.byteLength || bytes.byteLength > 25 * 1024 * 1024) throw new Error('Extension media must be between 1 byte and 25 MB.')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const previous = this.readWorkspaceDocument(this.db)
    if (!previous) throw new Error('Workspace v4 is not active.')
    const existing = previous.workspace.media.find((value) => value.sha256 === sha256)
    if (existing) return { id: existing.id, sha256, byteLength: existing.byteLength, workspaceRevision: previous.workspace.revision }
    const document = structuredClone(previous)
    const profile = document.workspace.profiles.find((value) => value.active) || document.workspace.profiles[0]
    if (!profile) throw new Error('Workspace has no profile for extension media.')
    const now = new Date().toISOString(); const id = `media:${sha256}`; const sourceEnvelopeId = `source:extension:${extensionId}:media:${sha256}`
    document.workspace.sourceEnvelopes.push({ id: sourceEnvelopeId, revision: 1, createdAt: now, updatedAt: now, profileId: profile.id, format: 'neo-v4', sourceId: `${extensionId}:${sha256}`, schemaVersion: '4', opaque: { extensionId } })
    document.workspace.media.push({ id, revision: 1, createdAt: now, updatedAt: now, profileId: profile.id, filename: input.filename, mimeType: input.mimeType, byteLength: bytes.byteLength, sha256, storageKey: sha256, sourceEnvelopeId })
    document.workspace.revision += 1; document.workspace.updatedAt = now
    const validated = createWorkspaceDocumentV4(document.workspace, document.clientState)
    const projected = workspaceDocumentV4ToAppData(validated)
    const current = this.load()
    const urls = new Map((current?.assets || []).map((value) => [value.id, value.dataUrl]))
    projected.assets = projected.assets.map((value) => value.id === id ? { ...value, dataUrl: `data:${input.mimeType};base64,${Buffer.from(bytes).toString('base64')}`, altText: input.altText || '' } : { ...value, dataUrl: urls.get(value.id) || value.dataUrl })
    this.transaction(() => {
      this.upsertAsset(projected.assets.find((value) => value.id === id)!, bytes)
      this.storeValidatedWorkspaceDocument(validated)
      this.db.prepare('UPDATE workspace_meta SET settings_json = ?, updated_at = ? WHERE id = 1').run(stringify(projected.settings), validated.workspace.updatedAt)
    })
    return { id, sha256, byteLength: bytes.byteLength, workspaceRevision: validated.workspace.revision }
  }

  private applyChangesWithoutTransaction(data: AppData, suppliedMedia = new Map<string, Uint8Array>(), archivedMedia = new Map<string, ArchivedMediaLocation>()) {
    const changes: WorkspaceChangeSet = {
      version: 1,
      meta: { deviceId: data.deviceId, settings: data.settings, updatedAt: data.updatedAt },
      upsert: { items: data.items, cards: data.cards, reviews: data.reviews, assets: data.assets, goals: data.goals, views: data.views, packs: data.packs, packConflicts: data.packConflicts, trash: data.trash },
      remove: { items: [], cards: [], reviews: [], assets: [], goals: [], views: [], packs: [], packConflicts: [], trash: [] },
    }
    // applyChanges normally owns the transaction. The nested implementation is kept explicit here.
    const insertItem = this.db.prepare('INSERT INTO items(id, created_at, updated_at, json) VALUES (?, ?, ?, ?)')
    const insertCard = this.db.prepare('INSERT INTO cards(id, item_id, due, suspended, created_at, updated_at, json) VALUES (?, ?, ?, ?, ?, ?, ?)')
    const insertReview = this.db.prepare('INSERT INTO reviews(id, card_id, reviewed_at, json) VALUES (?, ?, ?, ?)')
    const insertAsset = this.db.prepare('INSERT INTO assets(id, mime_type, hash, updated_at, metadata_json, data) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET mime_type=excluded.mime_type, hash=excluded.hash, updated_at=excluded.updated_at, metadata_json=excluded.metadata_json, data=excluded.data')
    const selectAsset = this.db.prepare('SELECT hash, metadata_json, data FROM assets WHERE id = ?')
    const insertGoal = this.db.prepare('INSERT INTO goals(id, created_at, updated_at, json) VALUES (?, ?, ?, ?)')
    const insertView = this.db.prepare('INSERT INTO views(id, created_at, updated_at, json) VALUES (?, ?, ?, ?)')
    const insertPack = this.db.prepare('INSERT INTO packs(id, installed_at, updated_at, json) VALUES (?, ?, ?, ?)')
    const insertConflict = this.db.prepare('INSERT INTO pack_conflicts(id, created_at, json) VALUES (?, ?, ?)')
    const insertTrash = this.db.prepare('INSERT INTO trash(id, deleted_at, json) VALUES (?, ?, ?)')
    for (const value of changes.upsert.items) insertItem.run(value.id, value.createdAt, value.updatedAt, stringify(value))
    for (const value of changes.upsert.cards) insertCard.run(value.id, value.itemId, value.fsrs.due, value.suspended ? 1 : 0, value.createdAt, value.updatedAt, stringify(this.cardForStorage(value)))
    for (const value of changes.upsert.reviews) insertReview.run(value.id, value.cardId, value.reviewedAt, stringify(value))
    for (const value of changes.upsert.assets) {
      const existing = suppliedMedia.has(value.id) ? undefined : selectAsset.get(value.id) as { hash: string; metadata_json: string; data: Uint8Array } | undefined
      const existingMetadata = existing ? parseJson<StoredAssetMetadata>(existing.metadata_json) : undefined
      const archived = archivedMedia.get(value.id) || (existing && existingMetadata?.archivedMedia && existing.hash === value.hash && existingMetadata.byteLength === value.byteLength ? existingMetadata.archivedMedia : undefined)
      if (archived) {
        if (!/^[a-f\d]{64}$/i.test(value.hash) || value.byteLength < 0) throw new Error(`Media ${value.filename} has invalid archive metadata.`)
        const { dataUrl: _dataUrl, ...metadata } = value
        insertAsset.run(value.id, value.mimeType, value.hash, value.updatedAt, stringify({ ...metadata, archivedMedia: archived }), new Uint8Array())
        continue
      }
      const bytes = suppliedMedia.get(value.id) || (value.dataUrl.startsWith(`${MEDIA_SCHEME}:`) && existing ? Buffer.from(existing.data) : dataUrlBytes(value.dataUrl))
      if (bytes.byteLength !== value.byteLength) throw new Error(`Media ${value.filename} does not match its declared byte length.`)
      const digest = sha256(bytes)
      if (value.hash && digest !== value.hash) throw new Error(`Media ${value.filename} does not match its SHA-256 digest.`)
      const { dataUrl: _dataUrl, ...metadata } = value
      insertAsset.run(value.id, value.mimeType, digest, value.updatedAt, stringify({ ...metadata, hash: digest }), bytes)
    }
    for (const value of changes.upsert.goals) insertGoal.run(value.id, value.createdAt, value.updatedAt, stringify(value))
    for (const value of changes.upsert.views) insertView.run(value.id, value.createdAt, value.updatedAt, stringify(value))
    for (const value of changes.upsert.packs) insertPack.run(value.id, value.installedAt, value.updatedAt, stringify(value))
    for (const value of changes.upsert.packConflicts) insertConflict.run(value.id, value.createdAt, stringify(value))
    for (const value of changes.upsert.trash) insertTrash.run(value.id, value.deletedAt, stringify(value))
    this.db.prepare('INSERT INTO workspace_meta(id, version, device_id, settings_json, updated_at) VALUES (1, 3, ?, ?, ?)').run(data.deviceId, stringify(data.settings), data.updatedAt)
  }

  private persistCanonicalProjectionMetadata(data: AppData, suppliedMedia = new Map<string, Uint8Array>(), archivedMedia = new Map<string, ArchivedMediaLocation>()) {
    for (const value of data.assets) {
      const archived = archivedMedia.get(value.id)
      if (archived) {
        const { dataUrl: _dataUrl, ...metadata } = value
        this.db.prepare('INSERT INTO assets(id, mime_type, hash, updated_at, metadata_json, data) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET mime_type=excluded.mime_type, hash=excluded.hash, updated_at=excluded.updated_at, metadata_json=excluded.metadata_json, data=excluded.data')
          .run(value.id, value.mimeType, value.hash, value.updatedAt, stringify({ ...metadata, archivedMedia: archived }), new Uint8Array())
      } else {
        this.upsertAsset(value, suppliedMedia.get(value.id))
      }
    }
    this.db.prepare('INSERT INTO workspace_meta(id, version, device_id, settings_json, updated_at) VALUES (1, 3, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET version=3, device_id=excluded.device_id, settings_json=excluded.settings_json, updated_at=excluded.updated_at')
      .run(data.deviceId, stringify(data.settings), data.updatedAt)
  }

  readAsset(id: string) {
    const row = this.db.prepare('SELECT mime_type, hash, metadata_json, data FROM assets WHERE id = ?').get(id) as { mime_type: string; hash: string; metadata_json: string; data: Uint8Array } | undefined
    if (!row) return null
    const metadata = parseJson<StoredAssetMetadata>(row.metadata_json)
    const bytes = metadata.archivedMedia ? this.readArchivedMedia(metadata.archivedMedia) : new Uint8Array(row.data)
    if (bytes.byteLength !== metadata.byteLength) throw new Error(`Media ${id} failed its length check.`)
    if (createHash('sha256').update(bytes).digest('hex') !== row.hash) throw new Error(`Media ${id} failed its integrity check.`)
    return { mimeType: resolvedMediaMimeType(metadata), hash: row.hash, bytes }
  }

  private readArchivedMedia(location: ArchivedMediaLocation) {
    if (!/^[a-f\d]{64}\.(?:apkg|colpkg)$/i.test(location.archiveName) || !/^\d+$/.test(location.entryName)) throw new Error('Archived media has an invalid source location.')
    let archive = this.sourceArchiveCache.get(location.archiveName)
    if (!archive) {
      archive = new Uint8Array(readFileSync(join(this.importArchiveRoot, location.archiveName)))
      if (sha256(archive) !== location.archiveName.slice(0, 64).toLowerCase()) throw new Error('The retained Anki source archive failed its integrity check.')
      this.sourceArchiveCache.clear(); this.sourceArchiveCache.set(location.archiveName, archive)
    }
    const extracted = unzipSync(archive, { filter: (file) => file.name === location.entryName })[location.entryName]
    if (!extracted) throw new Error(`The retained Anki source archive is missing media entry ${location.entryName}.`)
    return location.zstd ? decompressZstd(extracted) : extracted
  }

  async exportBackup(destination: string) {
    await rm(destination, { force: true })
    await backupDatabase(this.db, destination, { rate: 256 })
    const portable = new DatabaseSync(destination)
    try {
      const rows = portable.prepare('SELECT id, metadata_json FROM assets').all() as Array<{ id: string; metadata_json: string }>
      const update = portable.prepare('UPDATE assets SET metadata_json = ?, data = ? WHERE id = ?')
      portable.exec('BEGIN IMMEDIATE')
      try {
        for (const row of rows) {
          const metadata = parseJson<StoredAssetMetadata>(row.metadata_json)
          if (!metadata.archivedMedia) continue
          const bytes = this.readArchivedMedia(metadata.archivedMedia)
          const { archivedMedia: _archivedMedia, ...embedded } = metadata
          update.run(stringify(embedded), bytes, row.id)
        }
        portable.exec('COMMIT')
      } catch (error) { portable.exec('ROLLBACK'); throw error }
    } finally { portable.close() }
  }

  async exportRecoverySource(destination: string) {
    const source = this.statusValue.recoverySourcePath
    if (source && existsSync(source)) {
      copyFileSync(source, destination)
      syncFile(destination)
      return
    }
    await this.exportBackup(destination)
  }

  private validateBackup(source: string) {
    const candidate = new DatabaseSync(source, { readOnly: true })
    try {
      const check = candidate.prepare('PRAGMA integrity_check').get() as Record<string, unknown> | undefined
      const version = Number((candidate.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
      if (!check || !Object.values(check).includes('ok') || version < 4 || version > DATABASE_SCHEMA_VERSION) throw new Error('This is not a compatible Neo Anki backup.')
      const required = new Set(['workspace_meta', 'workspace_v4', 'items', 'cards', 'reviews', 'assets', 'goals', 'views', 'packs', 'pack_conflicts', 'trash'])
      const present = new Set((candidate.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map((row) => row.name))
      if ([...required].some((table) => !present.has(table))) throw new Error('This backup is missing required workspace tables.')
      const row = candidate.prepare('SELECT json FROM workspace_v4 WHERE id = 1').get() as { json: string } | undefined
      if (!row) throw new Error('This backup does not contain a workspace.')
      parseWorkspaceDocumentV4(parseJson(row.json))
    } finally { candidate.close() }
  }

  async restoreBackup(source: string) {
    this.validateBackup(source)
    this.documentCache = undefined
    this.projectionCache = undefined

    await this.createAutomaticBackup('before-restore')
    this.db.prepare('ATTACH DATABASE ? AS restore_source').run(source)
    try {
      const sourceVersion = Number((this.db.prepare('PRAGMA restore_source.user_version').get() as { user_version: number }).user_version)
      this.transaction(() => {
        this.db.exec('DELETE FROM reviews; DELETE FROM cards; DELETE FROM items; DELETE FROM assets; DELETE FROM goals; DELETE FROM views; DELETE FROM packs; DELETE FROM pack_conflicts; DELETE FROM trash; DELETE FROM workspace_meta; DELETE FROM workspace_v4; DELETE FROM patch_receipts; DELETE FROM workspace_journal;')
        this.db.exec(`INSERT INTO workspace_meta SELECT * FROM restore_source.workspace_meta;
          INSERT INTO workspace_v4(id, revision, updated_at, json, content_hash) SELECT id, revision, updated_at, json, ${sourceVersion >= 5 ? 'content_hash' : 'NULL'} FROM restore_source.workspace_v4;
          INSERT INTO items SELECT * FROM restore_source.items; INSERT INTO cards SELECT * FROM restore_source.cards; INSERT INTO reviews SELECT * FROM restore_source.reviews; INSERT INTO assets SELECT * FROM restore_source.assets; INSERT INTO goals SELECT * FROM restore_source.goals; INSERT INTO views SELECT * FROM restore_source.views; INSERT INTO packs SELECT * FROM restore_source.packs; INSERT INTO pack_conflicts SELECT * FROM restore_source.pack_conflicts; INSERT INTO trash SELECT * FROM restore_source.trash;`)
        if (sourceVersion >= 6) this.db.exec('INSERT INTO workspace_journal(sequence, kind, json, content_hash, created_at) SELECT sequence, kind, json, content_hash, created_at FROM restore_source.workspace_journal;')
      })
    } finally { this.db.exec('DETACH DATABASE restore_source') }
    // Full parsing catches semantic corruption that SQLite's integrity check cannot see.
    this.load()
    this.statusValue.recoveryError = undefined
    this.statusValue.recoverySourcePath = undefined
    this.statusValue.recoveredFromBackup = true
  }

  private automaticBackupPathsSync() {
    if (!existsSync(this.backupRoot)) return []
    return readdirSync(this.backupRoot)
      .filter((name) => /^auto-.*\.neoanki-backup$/.test(name))
      .sort().reverse().map((name) => join(this.backupRoot, name))
  }

  async createAutomaticBackup(reason = 'auto') {
    if (!this.hasWorkspace()) return null
    const now = new Date()
    const destination = join(this.backupRoot, `auto-${localDateKey(now)}-${now.toISOString().replace(/[:.]/g, '-')}-${reason}-${randomUUID()}.neoanki-backup`)
    await this.exportBackup(destination)
    const entries = (await readdir(this.backupRoot)).filter((name) => /^auto-.*\.neoanki-backup$/.test(name)).sort().reverse()
    await Promise.all(entries.slice(MAX_AUTOMATIC_BACKUPS).map((name) => rm(join(this.backupRoot, name), { force: true })))
    return destination
  }

  async createImportCheckpoint() {
    if (!this.hasWorkspace()) return null
    const now = new Date()
    const destination = join(this.backupRoot, `import-checkpoint-${localDateKey(now)}-${now.toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.neoanki-backup`)
    try {
      await this.exportBackup(destination)
      this.validateBackup(destination)
      return destination
    } catch (error) {
      await rm(destination, { force: true })
      throw error
    }
  }

  listMigrationRecoveryFiles() {
    const files: Array<{ kind: 'source-package' | 'workspace-checkpoint'; name: string; byteLength: number; createdAt: string }> = []
    for (const name of readdirSync(this.importArchiveRoot)) {
      if (!/^[a-f\d]{64}\.(?:apkg|colpkg)$/i.test(name)) continue
      const metadata = statSync(join(this.importArchiveRoot, name))
      files.push({ kind: 'source-package', name, byteLength: metadata.size, createdAt: metadata.mtime.toISOString() })
    }
    for (const name of readdirSync(this.backupRoot)) {
      if (!/^import-checkpoint-.*-[a-f\d-]{36}\.neoanki-backup$/i.test(name)) continue
      const metadata = statSync(join(this.backupRoot, name))
      files.push({ kind: 'workspace-checkpoint', name, byteLength: metadata.size, createdAt: metadata.mtime.toISOString() })
    }
    return files.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  removeMigrationRecoveryFile(kind: 'source-package' | 'workspace-checkpoint', name: string) {
    const valid = kind === 'source-package' ? /^[a-f\d]{64}\.(?:apkg|colpkg)$/i.test(name) : /^import-checkpoint-.*-[a-f\d-]{36}\.neoanki-backup$/i.test(name)
    if (!valid || basename(name) !== name) throw new Error('Migration recovery filename is invalid.')
    const root = kind === 'source-package' ? this.importArchiveRoot : this.backupRoot
    const destination = join(root, name)
    rmSync(destination, { force: true })
    try { syncDirectory(root) } catch { /* Directory fsync is unavailable on some platforms. */ }
  }

  async createRollingBackup() {
    const date = localDateKey(new Date())
    if (this.automaticBackupPathsSync().some((path) => basename(path).startsWith(`auto-${date}-`))) return null
    return this.createAutomaticBackup()
  }

  suggestedBackupRestorePath() {
    return this.automaticBackupPathsSync()[0] || this.backupRoot
  }

  clear() {
    this.transaction(() => this.db.exec('DELETE FROM reviews; DELETE FROM cards; DELETE FROM items; DELETE FROM assets; DELETE FROM goals; DELETE FROM views; DELETE FROM packs; DELETE FROM pack_conflicts; DELETE FROM trash; DELETE FROM workspace_meta; DELETE FROM workspace_v4; DELETE FROM patch_receipts; DELETE FROM workspace_journal;'))
    this.documentCache = null
    this.projectionCache = null
    this.deferredLegacyData = null
    this.deferredLegacyInput = undefined
    this.statusValue.recoveryError = undefined
    this.statusValue.recoverySourcePath = undefined
    this.statusValue.recoveredFromBackup = false
  }

  close() {
    try { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)') } catch { /* A committed WAL remains recoverable. */ }
    this.db.close()
  }
}
