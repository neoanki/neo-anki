// @vitest-environment node
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { createSeedData } from '../src/data/seed.js'
import { appDataToWorkspaceDocumentV4 } from '../src/lib/workspace-v4.js'
import { createWorkspaceChangeSet } from '../src/lib/workspace-changes.js'
import type { WorkspacePatchV2 } from '../packages/compatibility-domain/src/index.js'
import { WorkspaceStore } from './workspace-store.js'

const roots: string[] = []
const temporaryRoot = async () => { const root = await mkdtemp(join(tmpdir(), 'neo-anki-store-')); roots.push(root); return root }
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

describe('WorkspaceStore', () => {
  it('persists normalized change sets', async () => {
    const store = new WorkspaceStore(await temporaryRoot()); const initial = createSeedData()
    store.applyChanges(createWorkspaceChangeSet(null, initial))
    expect(store.load()?.items).toHaveLength(initial.items.length)
    store.close()
  })

  it('replays durable journaled mutations and compatibility patches after restart', async () => {
    const root = await temporaryRoot()
    let store = new WorkspaceStore(root)
    const initial = createSeedData()
    store.applyChanges(createWorkspaceChangeSet(null, initial))
    const changed = { ...initial, settings: { ...initial.settings, dailyMinutes: 47 }, updatedAt: new Date().toISOString() }
    store.applyChanges(createWorkspaceChangeSet(initial, changed))
    const document = store.workspaceV4Document()
    const noteType = document.workspace.noteTypes[0]
    store.applyCoreWorkspacePatch({ version: 2, idempotencyKey: 'test:journal-restart', expectedWorkspaceRevision: document.workspace.revision, owner: { type: 'core' }, operations: [{ op: 'update', kind: 'noteType', id: noteType.id, expectedRevision: noteType.revision, value: { ...noteType, name: 'Journal Basic', revision: noteType.revision + 1, updatedAt: changed.updatedAt } }] })
    store.close()

    const database = new DatabaseSync(join(root, 'neo-anki.sqlite'), { readOnly: true })
    expect((database.prepare('SELECT COUNT(*) AS count FROM workspace_journal').get() as { count: number }).count).toBe(2)
    database.close()

    store = new WorkspaceStore(root)
    expect(store.load()?.settings.dailyMinutes).toBe(47)
    expect(store.workspaceV4Document().workspace.noteTypes[0].name).toBe('Journal Basic')
    store.close()
  })

  it('blocks recovery when a durable journal record is corrupted', async () => {
    const root = await temporaryRoot()
    const store = new WorkspaceStore(root)
    const initial = createSeedData()
    store.applyChanges(createWorkspaceChangeSet(null, initial))
    const changed = { ...initial, settings: { ...initial.settings, dailyMinutes: 49 }, updatedAt: new Date().toISOString() }
    store.applyChanges(createWorkspaceChangeSet(initial, changed))
    store.close()

    const database = new DatabaseSync(join(root, 'neo-anki.sqlite'))
    database.prepare("UPDATE workspace_journal SET json = json || ' ' WHERE sequence = (SELECT MAX(sequence) FROM workspace_journal)").run()
    database.close()

    const blocked = new WorkspaceStore(root)
    expect(blocked.status().recoveryError).toContain('Workspace journal integrity check failed')
    expect(blocked.status().recoverySourcePath).toMatch(/neo-anki\.corrupt-.*\.sqlite$/)
    expect(blocked.load()).toBeNull()
    blocked.close()
  })

  it('backs up and restores uncheckpointed journal mutations', async () => {
    const sourceRoot = await temporaryRoot()
    const backup = join(sourceRoot, 'journal.neoanki-backup')
    const initial = createSeedData()
    let store = new WorkspaceStore(sourceRoot)
    store.applyChanges(createWorkspaceChangeSet(null, initial))
    const changed = { ...initial, settings: { ...initial.settings, dailyMinutes: 51 }, updatedAt: new Date().toISOString() }
    store.applyChanges(createWorkspaceChangeSet(initial, changed))
    await store.exportBackup(backup)
    store.close()

    const targetRoot = await temporaryRoot()
    store = new WorkspaceStore(targetRoot)
    store.applyChanges(createWorkspaceChangeSet(null, createSeedData()))
    await store.restoreBackup(backup)
    expect(store.load()?.settings.dailyMinutes).toBe(51)
    store.close()
  })

  it('restores schema-v5 backups through the versioned compatibility path', async () => {
    const sourceRoot = await temporaryRoot()
    const backup = join(sourceRoot, 'schema-v5.neoanki-backup')
    const initial = createSeedData()
    initial.settings.dailyMinutes = 43
    let store = new WorkspaceStore(sourceRoot)
    store.applyChanges(createWorkspaceChangeSet(null, initial))
    await store.exportBackup(backup)
    store.close()

    const legacy = new DatabaseSync(backup)
    legacy.exec('DROP TABLE workspace_journal; PRAGMA user_version = 5;')
    legacy.close()

    const targetRoot = await temporaryRoot()
    store = new WorkspaceStore(targetRoot)
    store.applyChanges(createWorkspaceChangeSet(null, createSeedData()))
    await store.restoreBackup(backup)
    expect(store.load()?.settings.dailyMinutes).toBe(43)
    store.close()
  })

  it('keeps the original legacy workspace usable when background migration is interrupted', async () => {
    const root = await temporaryRoot()
    const initial = createSeedData()
    await writeFile(join(root, 'neo-anki-data.json'), JSON.stringify(initial), 'utf8')
    let store = new WorkspaceStore(root, { allowUnvalidatedLegacyProjection: true })
    expect(store.load()?.items).toHaveLength(initial.items.length)
    store.close()

    store = new WorkspaceStore(root)
    expect(store.load()?.items).toHaveLength(initial.items.length)
    store.finishDeferredLegacyMigration()
    store.close()

    store = new WorkspaceStore(root)
    expect(store.load()?.items).toHaveLength(initial.items.length)
    expect(store.hasDeferredLegacyMigration()).toBe(false)
    store.close()
  })

  it('keeps extension configuration in the authoritative workspace', async () => {
    const store = new WorkspaceStore(await temporaryRoot()); const initial = createSeedData()
    store.applyChanges(createWorkspaceChangeSet(null, initial)); store.writeExtensionConfig('org.neoanki.fixture', { enabled: true })
    expect(store.readExtensionConfig('org.neoanki.fixture')).toEqual({ enabled: true })
    store.close()
  })

  it('applies core compatibility patches atomically and idempotently', async () => {
    const store = new WorkspaceStore(await temporaryRoot()); store.applyChanges(createWorkspaceChangeSet(null, createSeedData()))
    const document = store.workspaceV4Document(), noteType = document.workspace.noteTypes[0]
    const patch: WorkspacePatchV2 = { version: 2, idempotencyKey: 'test:edit', expectedWorkspaceRevision: document.workspace.revision, owner: { type: 'core' }, operations: [{ op: 'update', kind: 'noteType', id: noteType.id, expectedRevision: noteType.revision, value: { ...noteType, revision: noteType.revision + 1, updatedAt: new Date().toISOString(), name: 'Edited Basic' } }] }
    const result = store.applyCoreWorkspacePatch(patch)
    expect(store.applyCoreWorkspacePatch(patch).workspaceRevision).toBe(result.workspaceRevision)
    store.close()
  })

  it('checkpoints imports while keeping native rendering derived from workspace data', async () => {
    const root = await temporaryRoot(); const store = new WorkspaceStore(root), seed = createSeedData(), checkpoint = await store.createImportCheckpoint()
    expect(checkpoint).toBeNull()
    const committed = store.commitWorkspaceV4Import({ document: appDataToWorkspaceDocumentV4(seed), media: [], operation: 'replace-profile' })
    expect(committed?.items).toHaveLength(seed.items.length)
    expect(store.load()?.cards[0].rendering).toMatchObject({ prompt: { value: expect.any(String) }, answer: { value: expect.any(String) } })
    const database = new DatabaseSync(join(root, 'neo-anki.sqlite'), { readOnly: true })
    expect((database.prepare("SELECT json_type(json, '$.rendering') AS type FROM cards WHERE id = ?").get(seed.cards[0].id) as { type: string | null }).type).toBeNull()
    database.close()
    const changed = { ...committed!, cards: committed!.cards.map((card) => card.id === seed.cards[0].id ? { ...card, estimatedSeconds: card.estimatedSeconds + 1, updatedAt: new Date().toISOString() } : card), updatedAt: new Date().toISOString() }
    store.applyChanges(createWorkspaceChangeSet(committed!, changed))
    expect(store.load()?.cards[0].rendering).toMatchObject({ templateId: expect.any(String), responseMode: expect.stringMatching(/reveal|type/) })
    expect(await store.createImportCheckpoint()).toBeTruthy()
    store.close()
  })

  it('commits extension migration media as binary bytes without base64 expansion', async () => {
    const store = new WorkspaceStore(await temporaryRoot()), seed = createSeedData()
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 255])
    const hash = createHash('sha256').update(bytes).digest('hex')
    const timestamp = new Date().toISOString()
    const asset = { id: 'asset-binary', filename: 'binary.dat', mimeType: 'application/octet-stream', dataUrl: 'neoanki-media://pending', bytes, byteLength: bytes.byteLength, hash, altText: 'Binary fixture', createdAt: timestamp, updatedAt: timestamp }
    const { bytes: _bytes, ...assetMetadata } = asset
    const document = appDataToWorkspaceDocumentV4({ ...seed, assets: [assetMetadata] })

    store.commitWorkspaceV4Import({ document, media: [asset], operation: 'replace-profile' })

    expect(store.readAsset(asset.id)?.bytes).toEqual(bytes)
    expect(store.load()?.assets[0]).toMatchObject({ id: asset.id, dataUrl: expect.stringMatching(/^neoanki-media:\/\/asset\//) })
    store.close()
  })

  it('serves generic imported media with the MIME type implied by its filename', async () => {
    const store = new WorkspaceStore(await temporaryRoot()), seed = createSeedData()
    const bytes = new Uint8Array([0xff, 0xfb, 0x90, 0x64])
    const hash = createHash('sha256').update(bytes).digest('hex')
    const timestamp = new Date().toISOString()
    const asset = { id: 'asset-audio', filename: 'voice.mp3', mimeType: 'application/octet-stream', dataUrl: 'neoanki-media://pending', bytes, byteLength: bytes.byteLength, hash, altText: '', createdAt: timestamp, updatedAt: timestamp }
    const { bytes: _bytes, ...assetMetadata } = asset

    store.commitWorkspaceV4Import({ document: appDataToWorkspaceDocumentV4({ ...seed, assets: [assetMetadata] }), media: [asset], operation: 'replace-profile' })

    expect(store.load()?.assets[0].mimeType).toBe('audio/mpeg')
    expect(store.readAsset(asset.id)).toMatchObject({ mimeType: 'audio/mpeg', bytes })
    store.close()
  })

  it('preserves archive-backed media while applying unrelated workspace patches', async () => {
    const root = await temporaryRoot(); let store = new WorkspaceStore(root); const seed = createSeedData()
    const bytes = new Uint8Array([1, 2, 3]); const hash = createHash('sha256').update(bytes).digest('hex'); const timestamp = new Date().toISOString()
    const asset = { id: 'asset-archived', filename: 'archived.dat', mimeType: 'application/octet-stream', dataUrl: 'neoanki-media://pending', bytes, byteLength: bytes.byteLength, hash, altText: '', createdAt: timestamp, updatedAt: timestamp }
    const { bytes: _bytes, ...assetMetadata } = asset
    store.commitWorkspaceV4Import({ document: appDataToWorkspaceDocumentV4({ ...seed, assets: [assetMetadata] }), media: [asset], operation: 'replace-profile' })
    store.close()

    const archiveName = `${'a'.repeat(64)}.apkg`; await writeFile(join(root, 'import-archives', archiveName), new Uint8Array([0]))
    const database = new DatabaseSync(join(root, 'neo-anki.sqlite'))
    const stored = database.prepare('SELECT metadata_json FROM assets WHERE id = ?').get(asset.id) as { metadata_json: string }
    database.prepare('UPDATE assets SET metadata_json = ?, data = ? WHERE id = ?').run(JSON.stringify({ ...JSON.parse(stored.metadata_json), archivedMedia: { archiveName, entryName: '0', zstd: false } }), new Uint8Array(), asset.id)
    database.close()

    store = new WorkspaceStore(root)
    const document = store.workspaceV4Document(); const noteType = document.workspace.noteTypes[0]
    store.applyCoreWorkspacePatch({ version: 2, idempotencyKey: 'test:archived-media-edit', expectedWorkspaceRevision: document.workspace.revision, owner: { type: 'core' }, operations: [{ op: 'update', kind: 'noteType', id: noteType.id, expectedRevision: noteType.revision, value: { ...noteType, revision: noteType.revision + 1, updatedAt: timestamp, name: 'Edited with archived media' } }] })
    store.close()

    const verified = new DatabaseSync(join(root, 'neo-anki.sqlite'), { readOnly: true })
    const row = verified.prepare('SELECT metadata_json, length(data) AS bytes FROM assets WHERE id = ?').get(asset.id) as { metadata_json: string; bytes: number }
    expect(JSON.parse(row.metadata_json).archivedMedia).toEqual({ archiveName, entryName: '0', zstd: false })
    expect(row.bytes).toBe(0)
    verified.close()
  })

  it('never silently replaces a corrupt workspace with an older automatic backup', async () => {
    const root = await temporaryRoot()
    const store = new WorkspaceStore(root)
    const initial = createSeedData()
    store.applyChanges(createWorkspaceChangeSet(null, initial))
    await store.createRollingBackup()
    store.close()

    const databasePath = join(root, 'neo-anki.sqlite')
    const database = new DatabaseSync(databasePath)
    database.prepare('UPDATE workspace_v4 SET json = ? WHERE id = 1').run('{"format":"neo-anki-workspace","schemaVersion":4,"workspace":BROKEN')
    database.close()

    const blocked = new WorkspaceStore(root)
    const status = blocked.status()
    expect(status.recoveredFromBackup).toBe(false)
    expect(status.recoveryError).toContain('available for explicit restore')
    expect(status.recoverySourcePath).toMatch(/neo-anki\.corrupt-.*\.sqlite$/)
    expect(blocked.load()).toBeNull()
    blocked.close()

    const replacement = new DatabaseSync(databasePath, { readOnly: true })
    expect((replacement.prepare('SELECT COUNT(*) AS count FROM workspace_v4').get() as { count: number }).count).toBe(0)
    replacement.close()
    const preserved = new DatabaseSync(status.recoverySourcePath!, { readOnly: true })
    expect((preserved.prepare('SELECT json FROM workspace_v4 WHERE id = 1').get() as { json: string }).json).toContain('BROKEN')
    preserved.close()
  })

  it('unblocks a failed workspace after explicit backup restore or start-empty recovery', async () => {
    const root = await temporaryRoot()
    const original = new WorkspaceStore(root)
    const seed = createSeedData()
    original.applyChanges(createWorkspaceChangeSet(null, seed))
    const backup = await original.createRollingBackup()
    original.close()

    const database = new DatabaseSync(join(root, 'neo-anki.sqlite'))
    database.prepare('UPDATE workspace_v4 SET json = ? WHERE id = 1').run('{BROKEN')
    database.close()

    const blocked = new WorkspaceStore(root)
    expect(blocked.status().recoveryError).toBeTruthy()
    expect(blocked.suggestedBackupRestorePath()).toBe(backup)
    await blocked.restoreBackup(backup!)
    expect(blocked.status()).toMatchObject({ recoveryError: undefined, recoverySourcePath: undefined, recoveredFromBackup: true })
    expect(blocked.load()?.items).toHaveLength(seed.items.length)

    blocked.clear()
    expect(blocked.status()).toMatchObject({ recoveryError: undefined, recoverySourcePath: undefined, recoveredFromBackup: false })
    expect(blocked.load()).toBeNull()
    blocked.close()
  })

  it('creates at most one rolling recovery snapshot per local day', async () => {
    const root = await temporaryRoot()
    const store = new WorkspaceStore(root)
    let previous = createSeedData()
    store.applyChanges(createWorkspaceChangeSet(null, previous))
    await store.createRollingBackup()
    for (let dailyMinutes = 31; dailyMinutes <= 40; dailyMinutes += 1) {
      const next = { ...previous, settings: { ...previous.settings, dailyMinutes }, updatedAt: new Date(Date.now() + dailyMinutes).toISOString() }
      store.applyChanges(createWorkspaceChangeSet(previous, next))
      await store.createRollingBackup()
      previous = next
    }
    store.close()

    const backups = (await readdir(join(root, 'backups'))).filter((name) => name.startsWith('auto-')).sort().reverse()
    expect(backups).toHaveLength(1)
    const retainedMinutes = backups.map((name) => {
      const backup = new DatabaseSync(join(root, 'backups', name), { readOnly: true })
      const json = (backup.prepare('SELECT settings_json FROM workspace_meta WHERE id = 1').get() as { settings_json: string }).settings_json
      backup.close()
      return (JSON.parse(json) as { dailyMinutes: number }).dailyMinutes
    })
    expect(retainedMinutes).toEqual([30])
  })

  it('turns a legacy JSON migration failure into an explicit preserved-source recovery state', async () => {
    const root = await temporaryRoot()
    const legacyPath = join(root, 'neo-anki-data.json')
    await writeFile(legacyPath, '{"version":1,"items":BROKEN', 'utf8')

    const store = new WorkspaceStore(root)
    const status = store.status()
    expect(status.recoveryError).toContain('legacy workspace could not be migrated')
    expect(status.recoverySourcePath).toBe(legacyPath)
    expect(status.recoveredFromBackup).toBe(false)
    expect(store.load()).toBeNull()
    expect(await readFile(legacyPath, 'utf8')).toBe('{"version":1,"items":BROKEN')
    store.close()
  })
})
