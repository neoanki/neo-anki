import * as SQLite from 'expo-sqlite'
import { parseWorkspaceDocumentV4, type WorkspaceDocumentV4 } from '@neo-anki/compatibility-domain'
import { createEmptyWorkspace } from './workspace'

export interface StoredMobileSyncConfig { version: 1; endpoint: string; accountId: string; workspaceId: string; actorId: string; publicKeyJwk: JsonWebKey; baseline: WorkspaceDocumentV4; client: unknown; createdAt: string; lastSuccessAt?: string; lastError?: string }
export class MobileDatabase {
  private database: Promise<SQLite.SQLiteDatabase> | null = null
  private async db() {
    if (!this.database) this.database = SQLite.openDatabaseAsync('neo-anki-v4.sqlite').then(async (database) => {
      await database.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; CREATE TABLE IF NOT EXISTS workspace (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), document TEXT NOT NULL); CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, bytes BLOB NOT NULL); CREATE TABLE IF NOT EXISTS sync_config (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), config TEXT NOT NULL);')
      return database
    })
    return this.database
  }
  async loadWorkspace() { const row = await (await this.db()).getFirstAsync<{ document: string }>('SELECT document FROM workspace WHERE singleton = 1'); if (row) return parseWorkspaceDocumentV4(JSON.parse(row.document)); const empty = createEmptyWorkspace(); await this.saveWorkspace(empty); return empty }
  async saveWorkspace(document: WorkspaceDocumentV4) { const value = parseWorkspaceDocumentV4(document); const db = await this.db(); await db.withExclusiveTransactionAsync(async (transaction) => { await transaction.runAsync('INSERT INTO workspace(singleton, document) VALUES (1, ?) ON CONFLICT(singleton) DO UPDATE SET document=excluded.document', JSON.stringify(value)) }) }
  async putMedia(id: string, bytes: Uint8Array) { await (await this.db()).runAsync('INSERT INTO media(id, bytes) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET bytes=excluded.bytes', id, bytes) }
  async getMedia(id: string) { return (await (await this.db()).getFirstAsync<{ bytes: Uint8Array }>('SELECT bytes FROM media WHERE id = ?', id))?.bytes || null }
  async loadSyncConfig() { const row = await (await this.db()).getFirstAsync<{ config: string }>('SELECT config FROM sync_config WHERE singleton = 1'); return row ? JSON.parse(row.config) as StoredMobileSyncConfig : null }
  async saveSyncConfig(config: StoredMobileSyncConfig) { await (await this.db()).runAsync('INSERT INTO sync_config(singleton, config) VALUES (1, ?) ON CONFLICT(singleton) DO UPDATE SET config=excluded.config', JSON.stringify(config)) }
  async saveWorkspaceAndSyncConfig(document: WorkspaceDocumentV4, config: StoredMobileSyncConfig) {
    const workspace = parseWorkspaceDocumentV4(document); const db = await this.db()
    await db.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync('INSERT INTO workspace(singleton, document) VALUES (1, ?) ON CONFLICT(singleton) DO UPDATE SET document=excluded.document', JSON.stringify(workspace))
      await transaction.runAsync('INSERT INTO sync_config(singleton, config) VALUES (1, ?) ON CONFLICT(singleton) DO UPDATE SET config=excluded.config', JSON.stringify(config))
    })
  }
  async clearSyncConfig() { await (await this.db()).runAsync('DELETE FROM sync_config WHERE singleton = 1') }
}
