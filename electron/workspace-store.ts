import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync } from 'node:fs'
import { readdir, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { DatabaseSync, backup as backupDatabase, type StatementSync } from 'node:sqlite'
import type { AppData, MediaAsset } from '../src/types.js'
import type { WorkspaceChangeSet } from '../src/lib/workspace-changes.js'
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
const DATABASE_SCHEMA_VERSION = 1
const MAX_AUTOMATIC_BACKUPS = 7
const MEDIA_SCHEME = 'neoanki-media'

interface WorkspaceStoreStatus {
  path: string
  recoveredFromBackup: boolean
  recoveryError?: string
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

export class WorkspaceStore {
  private db: DatabaseSync
  private readonly dbPath: string
  private readonly backupRoot: string
  private readonly statusValue: WorkspaceStoreStatus

  constructor(private readonly userDataRoot: string) {
    mkdirSync(userDataRoot, { recursive: true })
    this.backupRoot = join(userDataRoot, 'backups')
    mkdirSync(this.backupRoot, { recursive: true })
    this.dbPath = join(userDataRoot, DATABASE_FILE)
    const opened = this.openRecoverableDatabase()
    this.db = opened.db
    this.statusValue = { path: this.dbPath, recoveredFromBackup: opened.recovered, recoveryError: opened.error, migratedLegacyData: false }
    this.configure()
    this.initializeSchema()
    this.statusValue.migratedLegacyData = this.migrateLegacyJsonIfNeeded()
  }

  private openRecoverableDatabase(): { db: DatabaseSync; recovered: boolean; error?: string } {
    const openAndCheck = () => {
      const db = new DatabaseSync(this.dbPath)
      const result = db.prepare('PRAGMA quick_check').get() as Record<string, unknown> | undefined
      if (!result || !Object.values(result).includes('ok')) { db.close(); throw new Error('SQLite integrity check failed.') }
      return db
    }
    try { return { db: openAndCheck(), recovered: false } }
    catch (initialError) {
      if (existsSync(this.dbPath)) renameSync(this.dbPath, join(this.userDataRoot, `neo-anki.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`))
      const automatic = this.automaticBackupPathsSync()[0]
      if (automatic) {
        try {
          copyFileSync(automatic, this.dbPath)
          return { db: openAndCheck(), recovered: true }
        } catch { /* Fall through to a new, empty database while preserving both files. */ }
      }
      return {
        db: new DatabaseSync(this.dbPath),
        recovered: false,
        error: `The workspace database could not be opened${automatic ? ' or recovered from its latest automatic backup' : ''}. The damaged file was preserved. ${initialError instanceof Error ? initialError.message : ''}`.trim(),
      }
    }
  }

  private configure() {
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA trusted_schema = OFF;')
  }

  private initializeSchema() {
    const current = Number((this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
    if (current > DATABASE_SCHEMA_VERSION) throw new Error(`Workspace database schema ${current} requires a newer Neo Anki release.`)
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
      PRAGMA user_version = ${DATABASE_SCHEMA_VERSION};
    `)
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

  private loadFromDatabase(database: DatabaseSync): AppData | null {
    const meta = database.prepare('SELECT version, device_id, settings_json, updated_at FROM workspace_meta WHERE id = 1').get() as { version: number; device_id: string; settings_json: string; updated_at: string } | undefined
    if (!meta) return null
    const assetRows = database.prepare('SELECT metadata_json FROM assets ORDER BY updated_at DESC, id').all() as Array<{ metadata_json: string }>
    const assets = assetRows.map((row) => {
      const asset = parseJson<StoredAssetMetadata>(row.metadata_json)
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
    this.transaction(() => {
      for (const value of changes.upsert.items) { const item = knowledgeItemSchema.parse(value); this.db.prepare('INSERT INTO items(id, created_at, updated_at, json) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET created_at=excluded.created_at, updated_at=excluded.updated_at, json=excluded.json').run(item.id, item.createdAt, item.updatedAt, stringify(item)) }
      for (const value of changes.upsert.cards) { const card = practiceCardSchema.parse(value); this.db.prepare('INSERT INTO cards(id, item_id, due, suspended, created_at, updated_at, json) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET item_id=excluded.item_id, due=excluded.due, suspended=excluded.suspended, created_at=excluded.created_at, updated_at=excluded.updated_at, json=excluded.json').run(card.id, card.itemId, card.fsrs.due, card.suspended ? 1 : 0, card.createdAt, card.updatedAt, stringify(card)) }
      for (const value of changes.upsert.reviews) { const review = reviewEventSchema.parse(value); this.db.prepare('INSERT INTO reviews(id, card_id, reviewed_at, json) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET card_id=excluded.card_id, reviewed_at=excluded.reviewed_at, json=excluded.json').run(review.id, review.cardId, review.reviewedAt, stringify(review)) }
      for (const value of changes.upsert.assets) this.upsertAsset(value)
      for (const value of changes.upsert.goals) { const goal = learningGoalSchema.parse(value); this.db.prepare('INSERT INTO goals(id, created_at, updated_at, json) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET created_at=excluded.created_at, updated_at=excluded.updated_at, json=excluded.json').run(goal.id, goal.createdAt, goal.updatedAt, stringify(goal)) }
      for (const value of changes.upsert.views) { const view = savedViewSchema.parse(value); this.db.prepare('INSERT INTO views(id, created_at, updated_at, json) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET created_at=excluded.created_at, updated_at=excluded.updated_at, json=excluded.json').run(view.id, view.createdAt, view.updatedAt, stringify(view)) }
      for (const value of changes.upsert.packs) { const pack = packSubscriptionSchema.parse(value); this.db.prepare('INSERT INTO packs(id, installed_at, updated_at, json) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET installed_at=excluded.installed_at, updated_at=excluded.updated_at, json=excluded.json').run(pack.id, pack.installedAt, pack.updatedAt, stringify(pack)) }
      for (const value of changes.upsert.packConflicts) { const conflict = packConflictSchema.parse(value); this.db.prepare('INSERT INTO pack_conflicts(id, created_at, json) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET created_at=excluded.created_at, json=excluded.json').run(conflict.id, conflict.createdAt, stringify(conflict)) }
      for (const value of changes.upsert.trash) { const entry = trashEntrySchema.parse(value); this.db.prepare('INSERT INTO trash(id, deleted_at, json) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET deleted_at=excluded.deleted_at, json=excluded.json').run(entry.id, entry.deletedAt, stringify(entry)) }

      const remove = (table: string, ids: string[]) => { const statement = this.db.prepare(`DELETE FROM ${table} WHERE id = ?`); ids.forEach((value) => statement.run(value)) }
      remove('reviews', changes.remove.reviews); remove('cards', changes.remove.cards); remove('items', changes.remove.items)
      remove('assets', changes.remove.assets); remove('goals', changes.remove.goals); remove('views', changes.remove.views); remove('packs', changes.remove.packs); remove('pack_conflicts', changes.remove.packConflicts); remove('trash', changes.remove.trash)

      if (changes.meta) {
        const settings = userSettingsSchema.parse(changes.meta.settings)
        const updatedAt = new Date(changes.meta.updatedAt)
        if (!changes.meta.deviceId || !Number.isFinite(updatedAt.getTime())) throw new Error('Workspace metadata is invalid.')
        this.db.prepare('INSERT INTO workspace_meta(id, version, device_id, settings_json, updated_at) VALUES (1, 3, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET version=3, device_id=excluded.device_id, settings_json=excluded.settings_json, updated_at=excluded.updated_at').run(changes.meta.deviceId, stringify(settings), updatedAt.toISOString())
      }
    })
  }

  replaceAll(input: unknown) {
    const data = parseWorkspaceData(input)
    this.transaction(() => {
      this.db.exec('DELETE FROM reviews; DELETE FROM cards; DELETE FROM items; DELETE FROM assets; DELETE FROM goals; DELETE FROM views; DELETE FROM packs; DELETE FROM pack_conflicts; DELETE FROM trash; DELETE FROM workspace_meta;')
      this.applyChangesWithoutTransaction(data)
    })
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
    return row ? { mimeType: row.mime_type, hash: row.hash, bytes: new Uint8Array(row.data) } : null
  }

  async exportBackup(destination: string) {
    await rm(destination, { force: true })
    await backupDatabase(this.db, destination, { rate: 256 })
  }

  async restoreBackup(source: string) {
    const candidate = new DatabaseSync(source, { readOnly: true })
    try {
      const check = candidate.prepare('PRAGMA integrity_check').get() as Record<string, unknown> | undefined
      const version = Number((candidate.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
      if (!check || !Object.values(check).includes('ok') || version !== DATABASE_SCHEMA_VERSION) throw new Error('This is not a compatible Neo Anki backup.')
      const required = new Set(['workspace_meta', 'items', 'cards', 'reviews', 'assets', 'goals', 'views', 'packs', 'pack_conflicts', 'trash'])
      const present = new Set((candidate.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map((row) => row.name))
      if ([...required].some((table) => !present.has(table))) throw new Error('This backup is missing required workspace tables.')
      if (!this.loadFromDatabase(candidate)) throw new Error('This backup does not contain a workspace.')
    } finally { candidate.close() }

    await this.createAutomaticBackup('before-restore')
    this.db.prepare('ATTACH DATABASE ? AS restore_source').run(source)
    try {
      this.transaction(() => {
        this.db.exec('DELETE FROM reviews; DELETE FROM cards; DELETE FROM items; DELETE FROM assets; DELETE FROM goals; DELETE FROM views; DELETE FROM packs; DELETE FROM pack_conflicts; DELETE FROM trash; DELETE FROM workspace_meta;')
        this.db.exec('INSERT INTO workspace_meta SELECT * FROM restore_source.workspace_meta; INSERT INTO items SELECT * FROM restore_source.items; INSERT INTO cards SELECT * FROM restore_source.cards; INSERT INTO reviews SELECT * FROM restore_source.reviews; INSERT INTO assets SELECT * FROM restore_source.assets; INSERT INTO goals SELECT * FROM restore_source.goals; INSERT INTO views SELECT * FROM restore_source.views; INSERT INTO packs SELECT * FROM restore_source.packs; INSERT INTO pack_conflicts SELECT * FROM restore_source.pack_conflicts; INSERT INTO trash SELECT * FROM restore_source.trash;')
      })
    } finally { this.db.exec('DETACH DATABASE restore_source') }
    // Full parsing catches semantic corruption that SQLite's integrity check cannot see.
    this.load()
  }

  private automaticBackupPathsSync() {
    if (!existsSync(this.backupRoot)) return []
    return readdirSync(this.backupRoot)
      .filter((name) => /^auto-.*\.neoanki-backup$/.test(name))
      .sort().reverse().map((name) => join(this.backupRoot, name))
  }

  async createAutomaticBackup(reason = 'auto') {
    if (!this.hasWorkspace()) return null
    const destination = join(this.backupRoot, `auto-${new Date().toISOString().replace(/[:.]/g, '-')}-${reason}.neoanki-backup`)
    await this.exportBackup(destination)
    const entries = (await readdir(this.backupRoot)).filter((name) => /^auto-.*\.neoanki-backup$/.test(name)).sort().reverse()
    await Promise.all(entries.slice(MAX_AUTOMATIC_BACKUPS).map((name) => rm(join(this.backupRoot, name), { force: true })))
    return destination
  }

  async maybeCreateDailyBackup() {
    const latest = this.automaticBackupPathsSync()[0]
    if (latest) {
      const stamp = basename(latest).slice(5, 15)
      if (stamp === new Date().toISOString().slice(0, 10)) return null
    }
    return this.createAutomaticBackup()
  }

  clear() {
    this.transaction(() => this.db.exec('DELETE FROM reviews; DELETE FROM cards; DELETE FROM items; DELETE FROM assets; DELETE FROM goals; DELETE FROM views; DELETE FROM packs; DELETE FROM pack_conflicts; DELETE FROM trash; DELETE FROM workspace_meta;'))
  }

  close() { this.db.close() }
}
