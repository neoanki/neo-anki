import { createHash, randomUUID } from 'node:crypto'
import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { readdir, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { DatabaseSync, backup as backupDatabase, type StatementSync } from 'node:sqlite'
import type { AppData, MediaAsset } from '../src/types.js'
import type { WorkspaceChangeSet } from '../src/lib/workspace-changes.js'
import type { WorkspaceDocumentV4, WorkspacePatchV2 } from '../packages/compatibility-domain/src/index.js'
import { applyWorkspacePatchV2 as applyDomainPatchV2, createWorkspaceDocumentV4, parseWorkspaceDocumentV4 } from '../packages/compatibility-domain/src/index.js'
import { appDataToWorkspaceDocumentV4, refreshWorkspaceDocumentV4FromProjection, workspaceDocumentV4ToAppData } from '../src/lib/workspace-v4.js'
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
const DATABASE_SCHEMA_VERSION = 3
const MAX_AUTOMATIC_BACKUPS = 7
const MEDIA_SCHEME = 'neoanki-media'

interface WorkspaceStoreStatus {
  path: string
  recoveredFromBackup: boolean
  recoveryError?: string
  recoverySourcePath?: string
  migratedLegacyData: boolean
}

type StoredAssetMetadata = Omit<MediaAsset, 'dataUrl'>

const parseJson = <T>(value: unknown): T => JSON.parse(String(value)) as T
const stringify = (value: unknown) => JSON.stringify(value)

const dataUrlBytes = (value: string) => {
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(value)
  if (!match) throw new Error('New media must use an embedded data URL.')
  try { return match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3])) }
  catch { throw new Error('A media asset contains an invalid data URL.') }
}

const mediaUrl = (asset: Pick<MediaAsset, 'id' | 'hash'>) => `${MEDIA_SCHEME}://asset/${encodeURIComponent(asset.id)}?v=${asset.hash.slice(0, 16)}`

const rows = <T>(statement: StatementSync) => statement.all().map((row) => parseJson<T>((row as { json: unknown }).json))
const localDateKey = (date: Date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')

const sha256 = (value: Uint8Array) => createHash('sha256').update(value).digest('hex')

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
    if (sha256(readFileSync(temporary)) !== expectedDigest) throw new Error('The retained Anki rollback archive failed verification after writing.')
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

  constructor(private readonly userDataRoot: string) {
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
    if (!this.statusValue.recoveryError) {
      try { this.statusValue.migratedLegacyData = this.migrateLegacyJsonIfNeeded() }
      catch (error) {
        const legacyPath = join(this.userDataRoot, LEGACY_FILE)
        this.statusValue.recoveryError = `The legacy workspace could not be migrated. The original JSON was preserved. ${error instanceof Error ? error.message : ''}`.trim()
        this.statusValue.recoverySourcePath = existsSync(legacyPath) ? legacyPath : undefined
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
        try { this.loadFromDatabase(db) }
        catch (error) { db.close(); throw error }
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
        json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS patch_receipts (
        owner TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        workspace_revision INTEGER NOT NULL,
        applied_at TEXT NOT NULL,
        PRIMARY KEY(owner, idempotency_key)
      ) STRICT;
    `)
    if (current === 1 && this.hasWorkspace() && !this.db.prepare('SELECT 1 FROM workspace_v4 WHERE id = 1').get()) {
      const legacy = this.loadLegacyProjectionFromDatabase(this.db)
      if (!legacy) throw new Error('The pre-v4 workspace migration found no workspace.')
      this.storeWorkspaceDocument(appDataToWorkspaceDocumentV4(legacy))
    }
    this.db.exec(`PRAGMA user_version = ${DATABASE_SCHEMA_VERSION};`)
  }

  private migrateLegacyJsonIfNeeded() {
    if (this.hasWorkspace()) return false
    const legacyPath = join(this.userDataRoot, LEGACY_FILE)
    if (!existsSync(legacyPath)) return false
    const legacy = JSON.parse(readFileSync(legacyPath, 'utf8')) as unknown
    const migrated = migrateWorkspaceData(legacy as Parameters<typeof migrateWorkspaceData>[0])
    const preserved = join(this.backupRoot, `legacy-json-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    copyFileSync(legacyPath, preserved)
    this.replaceAll(migrated)
    return true
  }

  private transaction<T>(run: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try { const result = run(); this.db.exec('COMMIT'); return result }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  private hasWorkspace() { return Boolean(this.db.prepare('SELECT 1 FROM workspace_meta WHERE id = 1').get()) }

  status(): WorkspaceStoreStatus { return { ...this.statusValue } }

  private loadLegacyProjectionFromDatabase(database: DatabaseSync): AppData | null {
    const meta = database.prepare('SELECT version, device_id, settings_json, updated_at FROM workspace_meta WHERE id = 1').get() as { version: number; device_id: string; settings_json: string; updated_at: string } | undefined
    if (!meta) return null
    const assetRows = database.prepare('SELECT hash, metadata_json, data FROM assets ORDER BY updated_at DESC, id').all() as Array<{ hash: string; metadata_json: string; data: Uint8Array }>
    const assets = assetRows.map((row) => {
      const asset = parseJson<StoredAssetMetadata>(row.metadata_json)
      const bytes = Buffer.from(row.data)
      const digest = createHash('sha256').update(bytes).digest('hex')
      if (asset.byteLength !== bytes.byteLength || asset.hash !== row.hash || digest !== row.hash) throw new Error(`Media ${asset.filename} failed its integrity check.`)
      return { ...asset, dataUrl: mediaUrl(asset) }
    })
    return parseWorkspaceData({
      version: meta.version,
      deviceId: meta.device_id,
      settings: parseJson(meta.settings_json),
      updatedAt: meta.updated_at,
      items: rows(database.prepare('SELECT json FROM items ORDER BY created_at DESC, id')),
      cards: rows(database.prepare('SELECT json FROM cards ORDER BY created_at DESC, id')),
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
    const table = database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='workspace_v4'").get()
    if (!table) return null
    const row = database.prepare('SELECT json FROM workspace_v4 WHERE id = 1').get() as { json: string } | undefined
    return row ? parseWorkspaceDocumentV4(parseJson(row.json)) : null
  }

  private storeWorkspaceDocument(document: WorkspaceDocumentV4) {
    const parsed = parseWorkspaceDocumentV4(document)
    this.db.prepare(`INSERT INTO workspace_v4(id, revision, updated_at, json) VALUES (1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, updated_at=excluded.updated_at, json=excluded.json`)
      .run(parsed.workspace.revision, parsed.workspace.updatedAt, stringify(parsed))
  }

  private loadFromDatabase(database: DatabaseSync): AppData | null {
    const document = this.readWorkspaceDocument(database)
    if (!document) return this.loadLegacyProjectionFromDatabase(database)
    // Re-reading media blobs proves integrity before exposing any projected URL.
    const legacy = this.loadLegacyProjectionFromDatabase(database)
    const projected = workspaceDocumentV4ToAppData(document)
    if (legacy) {
      const urls = new Map(legacy.assets.map((asset) => [asset.id, asset.dataUrl]))
      projected.assets = projected.assets.map((asset) => ({ ...asset, dataUrl: urls.get(asset.id) || asset.dataUrl }))
    }
    return parseWorkspaceData(projected)
  }

  load(): AppData | null { return this.loadFromDatabase(this.db) }

  private upsertAsset(input: unknown) {
    const asset = mediaAssetSchema.parse(input) as MediaAsset
    const existing = this.db.prepare('SELECT data FROM assets WHERE id = ?').get(asset.id) as { data: Uint8Array } | undefined
    const bytes = asset.dataUrl.startsWith(`${MEDIA_SCHEME}:`) && existing ? Buffer.from(existing.data) : dataUrlBytes(asset.dataUrl)
    if (bytes.byteLength !== asset.byteLength) throw new Error(`Media ${asset.filename} does not match its declared byte length.`)
    const digest = createHash('sha256').update(bytes).digest('hex')
    if (asset.hash && digest !== asset.hash) throw new Error(`Media ${asset.filename} does not match its SHA-256 digest.`)
    const { dataUrl: _dataUrl, ...rawMetadata } = asset
    const metadata = { ...rawMetadata, hash: digest }
    this.db.prepare(`INSERT INTO assets(id, mime_type, hash, updated_at, metadata_json, data) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET mime_type=excluded.mime_type, hash=excluded.hash, updated_at=excluded.updated_at, metadata_json=excluded.metadata_json, data=excluded.data`)
      .run(asset.id, asset.mimeType, digest, asset.updatedAt, stringify(metadata), bytes)
  }

  applyChanges(changes: WorkspaceChangeSet) {
    if (!changes || changes.version !== 1 || !changes.upsert || !changes.remove) throw new Error('Workspace change set is invalid.')
    if (changes.remove.reviews.length) throw new Error('Review history is append-only; append a reversal event instead of deleting a review.')
    this.transaction(() => {
      for (const value of changes.upsert.items) { const item = knowledgeItemSchema.parse(value); this.db.prepare('INSERT INTO items(id, created_at, updated_at, json) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET created_at=excluded.created_at, updated_at=excluded.updated_at, json=excluded.json').run(item.id, item.createdAt, item.updatedAt, stringify(item)) }
      for (const value of changes.upsert.cards) { const card = practiceCardSchema.parse(value); this.db.prepare('INSERT INTO cards(id, item_id, due, suspended, created_at, updated_at, json) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET item_id=excluded.item_id, due=excluded.due, suspended=excluded.suspended, created_at=excluded.created_at, updated_at=excluded.updated_at, json=excluded.json').run(card.id, card.itemId, card.fsrs.due, card.suspended ? 1 : 0, card.createdAt, card.updatedAt, stringify(card)) }
      for (const value of changes.upsert.reviews) { const review = reviewEventSchema.parse(value); this.db.prepare('INSERT INTO reviews(id, card_id, reviewed_at, json) VALUES (?, ?, ?, ?)').run(review.id, review.cardId, review.reviewedAt, stringify(review)) }
      for (const value of changes.upsert.assets) this.upsertAsset(value)
      for (const value of changes.upsert.goals) { const goal = learningGoalSchema.parse(value); this.db.prepare('INSERT INTO goals(id, created_at, updated_at, json) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET created_at=excluded.created_at, updated_at=excluded.updated_at, json=excluded.json').run(goal.id, goal.createdAt, goal.updatedAt, stringify(goal)) }
      for (const value of changes.upsert.views) { const view = savedViewSchema.parse(value); this.db.prepare('INSERT INTO views(id, created_at, updated_at, json) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET created_at=excluded.created_at, updated_at=excluded.updated_at, json=excluded.json').run(view.id, view.createdAt, view.updatedAt, stringify(view)) }
      for (const value of changes.upsert.packs) { const pack = packSubscriptionSchema.parse(value); this.db.prepare('INSERT INTO packs(id, installed_at, updated_at, json) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET installed_at=excluded.installed_at, updated_at=excluded.updated_at, json=excluded.json').run(pack.id, pack.installedAt, pack.updatedAt, stringify(pack)) }
      for (const value of changes.upsert.packConflicts) { const conflict = packConflictSchema.parse(value); this.db.prepare('INSERT INTO pack_conflicts(id, created_at, json) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET created_at=excluded.created_at, json=excluded.json').run(conflict.id, conflict.createdAt, stringify(conflict)) }
      for (const value of changes.upsert.trash) { const entry = trashEntrySchema.parse(value); this.db.prepare('INSERT INTO trash(id, deleted_at, json) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET deleted_at=excluded.deleted_at, json=excluded.json').run(entry.id, entry.deletedAt, stringify(entry)) }

      const remove = (table: string, ids: string[]) => { const statement = this.db.prepare(`DELETE FROM ${table} WHERE id = ?`); ids.forEach((value) => statement.run(value)) }
      remove('cards', changes.remove.cards); remove('items', changes.remove.items)
      remove('assets', changes.remove.assets); remove('goals', changes.remove.goals); remove('views', changes.remove.views); remove('packs', changes.remove.packs); remove('pack_conflicts', changes.remove.packConflicts); remove('trash', changes.remove.trash)

      if (changes.meta) {
        const settings = userSettingsSchema.parse(changes.meta.settings)
        const updatedAt = new Date(changes.meta.updatedAt)
        if (!changes.meta.deviceId || !Number.isFinite(updatedAt.getTime())) throw new Error('Workspace metadata is invalid.')
        this.db.prepare('INSERT INTO workspace_meta(id, version, device_id, settings_json, updated_at) VALUES (1, 3, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET version=3, device_id=excluded.device_id, settings_json=excluded.settings_json, updated_at=excluded.updated_at').run(changes.meta.deviceId, stringify(settings), updatedAt.toISOString())
      }
      if (this.hasWorkspace()) {
        const projected = this.loadLegacyProjectionFromDatabase(this.db)
        if (!projected) throw new Error('Workspace projection disappeared during commit.')
        const previous = this.readWorkspaceDocument(this.db) || undefined
        this.storeWorkspaceDocument(refreshWorkspaceDocumentV4FromProjection(projected, previous))
        this.loadFromDatabase(this.db)
      }
    })
  }

  replaceAll(input: unknown) {
    const isV4 = (input as Partial<WorkspaceDocumentV4>)?.format === 'neo-anki-workspace'
    const document = isV4 ? parseWorkspaceDocumentV4(input) : appDataToWorkspaceDocumentV4(parseWorkspaceData(input))
    const data = workspaceDocumentV4ToAppData(document)
    this.transaction(() => {
      this.db.exec('DELETE FROM reviews; DELETE FROM cards; DELETE FROM items; DELETE FROM assets; DELETE FROM goals; DELETE FROM views; DELETE FROM packs; DELETE FROM pack_conflicts; DELETE FROM trash; DELETE FROM workspace_meta; DELETE FROM workspace_v4; DELETE FROM patch_receipts;')
      this.applyChangesWithoutTransaction(data)
      this.storeWorkspaceDocument(document)
      this.loadFromDatabase(this.db)
    })
  }

  commitWorkspaceV4Import(input: { document: unknown; media: unknown[]; sourceArchive?: Uint8Array; operation: 'additive' | 'replace-profile' }) {
    const imported = parseWorkspaceDocumentV4(input.document)
    const rootEnvelope = imported.workspace.sourceEnvelopes.find((value) => value.sha256 && (value.format === 'anki-apkg' || value.format === 'anki-colpkg'))
    let createdArchivePath = ''
    if (input.sourceArchive) {
      if (input.sourceArchive.byteLength > 512 * 1024 * 1024) throw new Error('The retained Anki rollback archive exceeds 512 MB.')
      const digest = sha256(input.sourceArchive)
      if (!rootEnvelope?.sha256 || digest !== rootEnvelope.sha256) throw new Error('The retained Anki rollback archive does not match the preflight digest.')
      const extension = rootEnvelope.format === 'anki-colpkg' ? 'colpkg' : 'apkg'
      const destination = join(this.importArchiveRoot, `${digest}.${extension}`)
      createdArchivePath = retainVerifiedArchive(destination, input.sourceArchive, digest)
    }
    const mediaPayloads = input.media.map((value) => mediaAssetSchema.parse(value) as MediaAsset)
    const mediaById = new Map(mediaPayloads.map((value) => [value.id, value]))
    const previous = this.readWorkspaceDocument(this.db)
    let document: WorkspaceDocumentV4
    if (!previous) {
      document = imported
      document.clientState.settings = { ...document.clientState.settings, onboardingComplete: true }
    } else {
      const root = imported.workspace.sourceEnvelopes.find((value) => value.sha256 && (value.format === 'anki-apkg' || value.format === 'anki-colpkg'))
      if (root && previous.workspace.sourceEnvelopes.some((value) => value.sha256 === root.sha256 && value.format === root.format)) return this.load()
      const workspace = structuredClone(previous.workspace)
      const importedWorkspace = structuredClone(imported.workspace)
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
      importedWorkspace.profiles.forEach((value, index) => { value.active = replacingActiveProfile ? index === 0 : false })
      const merge = <T extends { id: string }>(target: T[], incoming: T[], label: string) => {
        const ids = new Set(target.map((value) => value.id))
        for (const value of incoming) {
          if (ids.has(value.id)) throw new Error(`Anki import ${label} collision: ${value.id}.`)
          ids.add(value.id); target.push(value)
        }
      }
      merge(workspace.profiles, importedWorkspace.profiles, 'profile')
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
      document.clientState = { ...structuredClone(previous.clientState), tombstones: (previous.clientState.tombstones || []).filter((value) => !incomingIds.has(`${value.kind}:${value.id}`)) }
      if (replacingActiveProfile) document.clientState.settings = { ...document.clientState.settings, onboardingComplete: true }
    }
    document = parseWorkspaceDocumentV4(document)
    const projected = workspaceDocumentV4ToAppData(document)
    const existing = this.loadLegacyProjectionFromDatabase(this.db)
    const existingUrls = new Map((existing?.assets || []).map((value) => [value.id, value.dataUrl]))
    projected.assets = projected.assets.map((asset) => {
      const payload = mediaById.get(asset.id)
      return payload ? { ...asset, dataUrl: payload.dataUrl, altText: payload.altText } : { ...asset, dataUrl: existingUrls.get(asset.id) || asset.dataUrl }
    })
    try {
      this.transaction(() => {
        const replaceAssets = !previous
        this.db.exec(`DELETE FROM reviews; DELETE FROM cards; DELETE FROM items; ${replaceAssets ? 'DELETE FROM assets;' : ''} DELETE FROM goals; DELETE FROM views; DELETE FROM packs; DELETE FROM pack_conflicts; DELETE FROM trash; DELETE FROM workspace_meta; DELETE FROM workspace_v4;`)
        this.applyChangesWithoutTransaction(projected)
        if (!replaceAssets) {
          const keep = new Set(projected.assets.map((value) => value.id))
          const stored = this.db.prepare('SELECT id FROM assets').all() as Array<{ id: string }>
          const remove = this.db.prepare('DELETE FROM assets WHERE id = ?')
          stored.forEach((value) => { if (!keep.has(value.id)) remove.run(value.id) })
        }
        this.storeWorkspaceDocument(document)
        this.loadFromDatabase(this.db)
      })
    } catch (error) { if (createdArchivePath) rmSync(createdArchivePath, { force: true }); throw error }
    return this.load()
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

  applyCoreWorkspacePatch(patch: WorkspacePatchV2) {
    const previous = this.readWorkspaceDocument(this.db)
    if (!previous) throw new Error('Workspace v4 is not active.')
    if (patch.owner.type !== 'core') throw new Error('Core workspace patches must use the core owner.')
    const owner = 'core'; const requestHash = sha256(Buffer.from(stringify(patch)))
    const receipt = this.db.prepare('SELECT request_hash FROM patch_receipts WHERE owner=? AND idempotency_key=?').get(owner, patch.idempotencyKey) as { request_hash: string } | undefined
    if (receipt) {
      if (receipt.request_hash !== requestHash) throw new Error('A different core patch already used this idempotency key.')
      return { workspaceRevision: previous.workspace.revision, data: this.load()! }
    }
    const document = createWorkspaceDocumentV4(applyDomainPatchV2(previous.workspace, patch), previous.clientState)
    const projected = workspaceDocumentV4ToAppData(document)
    const existing = this.loadLegacyProjectionFromDatabase(this.db)
    const urls = new Map((existing?.assets || []).map((value) => [value.id, value.dataUrl]))
    projected.assets = projected.assets.map((value) => ({ ...value, dataUrl: urls.get(value.id) || value.dataUrl }))
    this.transaction(() => {
      this.db.exec('DELETE FROM reviews; DELETE FROM cards; DELETE FROM items; DELETE FROM goals; DELETE FROM views; DELETE FROM packs; DELETE FROM pack_conflicts; DELETE FROM trash; DELETE FROM workspace_meta; DELETE FROM workspace_v4;')
      this.applyChangesWithoutTransaction(projected)
      this.storeWorkspaceDocument(document)
      this.db.prepare('INSERT INTO patch_receipts(owner, idempotency_key, request_hash, workspace_revision, applied_at) VALUES (?, ?, ?, ?, ?)').run(owner, patch.idempotencyKey, requestHash, document.workspace.revision, new Date().toISOString())
      this.loadFromDatabase(this.db)
    })
    return { workspaceRevision: document.workspace.revision, data: this.load()! }
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
    const existing = this.loadLegacyProjectionFromDatabase(this.db)
    const urls = new Map((existing?.assets || []).map((value) => [value.id, value.dataUrl]))
    projected.assets = projected.assets.map((value) => ({ ...value, dataUrl: urls.get(value.id) || value.dataUrl }))
    this.transaction(() => {
      this.db.exec('DELETE FROM reviews; DELETE FROM cards; DELETE FROM items; DELETE FROM goals; DELETE FROM views; DELETE FROM packs; DELETE FROM pack_conflicts; DELETE FROM trash; DELETE FROM workspace_meta; DELETE FROM workspace_v4;')
      this.applyChangesWithoutTransaction(projected)
      this.storeWorkspaceDocument(document)
      this.db.prepare('INSERT INTO patch_receipts(owner, idempotency_key, request_hash, workspace_revision, applied_at) VALUES (?, ?, ?, ?, ?)').run(owner, patch.idempotencyKey, requestHash, document.workspace.revision, new Date().toISOString())
      this.loadFromDatabase(this.db)
    })
    return { workspaceRevision: document.workspace.revision, data: this.load()! }
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
      this.loadFromDatabase(this.db)
    })
    return { workspaceRevision: validated.workspace.revision, data: this.load()! }
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
    const current = this.loadLegacyProjectionFromDatabase(this.db)
    const urls = new Map((current?.assets || []).map((value) => [value.id, value.dataUrl]))
    projected.assets = projected.assets.map((value) => value.id === id ? { ...value, dataUrl: `data:${input.mimeType};base64,${Buffer.from(bytes).toString('base64')}`, altText: input.altText || '' } : { ...value, dataUrl: urls.get(value.id) || value.dataUrl })
    this.transaction(() => {
      this.db.exec('DELETE FROM reviews; DELETE FROM cards; DELETE FROM items; DELETE FROM goals; DELETE FROM views; DELETE FROM packs; DELETE FROM pack_conflicts; DELETE FROM trash; DELETE FROM workspace_meta; DELETE FROM workspace_v4;')
      this.applyChangesWithoutTransaction(projected); this.storeWorkspaceDocument(validated); this.loadFromDatabase(this.db)
    })
    return { id, sha256, byteLength: bytes.byteLength, workspaceRevision: validated.workspace.revision }
  }

  private applyChangesWithoutTransaction(data: AppData) {
    const changes: WorkspaceChangeSet = {
      version: 1,
      meta: { deviceId: data.deviceId, settings: data.settings, updatedAt: data.updatedAt },
      upsert: { items: data.items, cards: data.cards, reviews: data.reviews, assets: data.assets, goals: data.goals, views: data.views, packs: data.packs, packConflicts: data.packConflicts, trash: data.trash },
      remove: { items: [], cards: [], reviews: [], assets: [], goals: [], views: [], packs: [], packConflicts: [], trash: [] },
    }
    // applyChanges normally owns the transaction. The nested implementation is kept explicit here.
    for (const item of changes.upsert.items) { const value = knowledgeItemSchema.parse(item); this.db.prepare('INSERT INTO items(id, created_at, updated_at, json) VALUES (?, ?, ?, ?)').run(value.id, value.createdAt, value.updatedAt, stringify(value)) }
    for (const card of changes.upsert.cards) { const value = practiceCardSchema.parse(card); this.db.prepare('INSERT INTO cards(id, item_id, due, suspended, created_at, updated_at, json) VALUES (?, ?, ?, ?, ?, ?, ?)').run(value.id, value.itemId, value.fsrs.due, value.suspended ? 1 : 0, value.createdAt, value.updatedAt, stringify(value)) }
    for (const review of changes.upsert.reviews) { const value = reviewEventSchema.parse(review); this.db.prepare('INSERT INTO reviews(id, card_id, reviewed_at, json) VALUES (?, ?, ?, ?)').run(value.id, value.cardId, value.reviewedAt, stringify(value)) }
    changes.upsert.assets.forEach((asset) => this.upsertAsset(asset))
    for (const goal of changes.upsert.goals) { const value = learningGoalSchema.parse(goal); this.db.prepare('INSERT INTO goals(id, created_at, updated_at, json) VALUES (?, ?, ?, ?)').run(value.id, value.createdAt, value.updatedAt, stringify(value)) }
    for (const view of changes.upsert.views) { const value = savedViewSchema.parse(view); this.db.prepare('INSERT INTO views(id, created_at, updated_at, json) VALUES (?, ?, ?, ?)').run(value.id, value.createdAt, value.updatedAt, stringify(value)) }
    for (const pack of changes.upsert.packs) { const value = packSubscriptionSchema.parse(pack); this.db.prepare('INSERT INTO packs(id, installed_at, updated_at, json) VALUES (?, ?, ?, ?)').run(value.id, value.installedAt, value.updatedAt, stringify(value)) }
    for (const conflict of changes.upsert.packConflicts) { const value = packConflictSchema.parse(conflict); this.db.prepare('INSERT INTO pack_conflicts(id, created_at, json) VALUES (?, ?, ?)').run(value.id, value.createdAt, stringify(value)) }
    for (const entry of changes.upsert.trash) { const value = trashEntrySchema.parse(entry); this.db.prepare('INSERT INTO trash(id, deleted_at, json) VALUES (?, ?, ?)').run(value.id, value.deletedAt, stringify(value)) }
    this.db.prepare('INSERT INTO workspace_meta(id, version, device_id, settings_json, updated_at) VALUES (1, 3, ?, ?, ?)').run(data.deviceId, stringify(data.settings), data.updatedAt)
  }

  readAsset(id: string) {
    const row = this.db.prepare('SELECT mime_type, hash, data FROM assets WHERE id = ?').get(id) as { mime_type: string; hash: string; data: Uint8Array } | undefined
    if (!row) return null
    const bytes = new Uint8Array(row.data)
    if (createHash('sha256').update(bytes).digest('hex') !== row.hash) throw new Error(`Media ${id} failed its integrity check.`)
    return { mimeType: row.mime_type, hash: row.hash, bytes }
  }

  async exportBackup(destination: string) {
    await rm(destination, { force: true })
    await backupDatabase(this.db, destination, { rate: 256 })
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
      if (!check || !Object.values(check).includes('ok') || version !== DATABASE_SCHEMA_VERSION) throw new Error('This is not a compatible Neo Anki backup.')
      const required = new Set(['workspace_meta', 'workspace_v4', 'items', 'cards', 'reviews', 'assets', 'goals', 'views', 'packs', 'pack_conflicts', 'trash'])
      const present = new Set((candidate.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map((row) => row.name))
      if ([...required].some((table) => !present.has(table))) throw new Error('This backup is missing required workspace tables.')
      if (!this.loadFromDatabase(candidate)) throw new Error('This backup does not contain a workspace.')
    } finally { candidate.close() }
  }

  async restoreBackup(source: string) {
    this.validateBackup(source)

    await this.createAutomaticBackup('before-restore')
    this.db.prepare('ATTACH DATABASE ? AS restore_source').run(source)
    try {
      this.transaction(() => {
        this.db.exec('DELETE FROM reviews; DELETE FROM cards; DELETE FROM items; DELETE FROM assets; DELETE FROM goals; DELETE FROM views; DELETE FROM packs; DELETE FROM pack_conflicts; DELETE FROM trash; DELETE FROM workspace_meta; DELETE FROM workspace_v4; DELETE FROM patch_receipts;')
        this.db.exec('INSERT INTO workspace_meta SELECT * FROM restore_source.workspace_meta; INSERT INTO workspace_v4 SELECT * FROM restore_source.workspace_v4; INSERT INTO items SELECT * FROM restore_source.items; INSERT INTO cards SELECT * FROM restore_source.cards; INSERT INTO reviews SELECT * FROM restore_source.reviews; INSERT INTO assets SELECT * FROM restore_source.assets; INSERT INTO goals SELECT * FROM restore_source.goals; INSERT INTO views SELECT * FROM restore_source.views; INSERT INTO packs SELECT * FROM restore_source.packs; INSERT INTO pack_conflicts SELECT * FROM restore_source.pack_conflicts; INSERT INTO trash SELECT * FROM restore_source.trash;')
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

  async createRollingBackup() { return this.createAutomaticBackup() }

  suggestedBackupRestorePath() {
    return this.automaticBackupPathsSync()[0] || this.backupRoot
  }

  clear() {
    this.transaction(() => this.db.exec('DELETE FROM reviews; DELETE FROM cards; DELETE FROM items; DELETE FROM assets; DELETE FROM goals; DELETE FROM views; DELETE FROM packs; DELETE FROM pack_conflicts; DELETE FROM trash; DELETE FROM workspace_meta; DELETE FROM workspace_v4; DELETE FROM patch_receipts;'))
    this.statusValue.recoveryError = undefined
    this.statusValue.recoverySourcePath = undefined
    this.statusValue.recoveredFromBackup = false
  }

  close() { this.db.close() }
}
