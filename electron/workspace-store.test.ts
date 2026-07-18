// @vitest-environment node
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import initSqlJs from 'sql.js'
import { strToU8, zipSync } from 'fflate'
import { createSeedData } from '../src/data/seed.js'
import { importAnkiWorkspaceV4 } from '../src/extensions/interoperability/anki.js'
import { createWorkspaceChangeSet } from '../src/lib/workspace-changes.js'
import type { MediaAsset } from '../src/types.js'
import type { WorkspacePatchV2 } from '../packages/compatibility-domain/src/index.js'
import { WorkspaceStore } from './workspace-store.js'

const roots: string[] = []
const temporaryRoot = async () => { const root = await mkdtemp(join(tmpdir(), 'neo-anki-store-')); roots.push(root); return root }

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

describe('WorkspaceStore', () => {
  it('persists normalized change sets and keeps media out of renderer snapshots', async () => {
    const root = await temporaryRoot()
    const store = new WorkspaceStore(root)
    const initial = createSeedData()
    store.applyChanges(createWorkspaceChangeSet(null, initial))

    const bytes = Buffer.from('production media fixture')
    const hash = createHash('sha256').update(bytes).digest('hex')
    const asset: MediaAsset = {
      id: `asset-${hash.slice(0, 20)}`,
      filename: 'fixture.txt',
      mimeType: 'text/plain',
      dataUrl: `data:text/plain;base64,${bytes.toString('base64')}`,
      byteLength: bytes.byteLength,
      hash,
      altText: 'Fixture',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    const next = {
      ...initial,
      assets: [asset],
      items: initial.items.map((item, index) => index ? item : { ...item, mediaIds: [asset.id], updatedAt: new Date().toISOString() }),
      updatedAt: new Date().toISOString(),
    }
    const changes = createWorkspaceChangeSet(initial, next)
    expect(changes.upsert.items).toHaveLength(1)
    expect(changes.upsert.cards).toHaveLength(0)
    store.applyChanges(changes)

    const loaded = store.load()!
    expect(loaded.items).toHaveLength(initial.items.length)
    expect(loaded.assets[0].dataUrl).toMatch(/^neoanki-media:\/\/asset\//)
    expect(Buffer.from(store.readAsset(asset.id)!.bytes)).toEqual(bytes)
    store.close()
  })

  it('exports a verified SQLite backup and restores it transactionally', async () => {
    const root = await temporaryRoot()
    const store = new WorkspaceStore(root)
    const initial = createSeedData()
    store.applyChanges(createWorkspaceChangeSet(null, initial))
    const backup = join(root, 'manual.neoanki-backup')
    await store.exportBackup(backup)

    const changed = { ...initial, settings: { ...initial.settings, dailyMinutes: 90 }, updatedAt: new Date(Date.now() + 1000).toISOString() }
    store.applyChanges(createWorkspaceChangeSet(initial, changed))
    expect(store.load()!.settings.dailyMinutes).toBe(90)
    await store.restoreBackup(backup)
    expect(store.load()!.settings.dailyMinutes).toBe(30)
    store.close()
  })

  it('stores SDK v2 non-secret configuration in the authoritative workspace without losing it to projection saves', async () => {
    const root = await temporaryRoot(); const store = new WorkspaceStore(root); const initial = createSeedData()
    store.applyChanges(createWorkspaceChangeSet(null, initial))
    const first = store.writeExtensionConfig('org.neoanki.tts', { enabled: true, profiles: [{ id: 'spanish' }] })
    expect(first.workspaceRevision).toBeGreaterThan(1)
    expect(store.readExtensionConfig('org.neoanki.tts')).toEqual({ enabled: true, profiles: [{ id: 'spanish' }] })
    const projected = store.load()!
    store.applyChanges(createWorkspaceChangeSet(projected, { ...projected, settings: { ...projected.settings, dailyMinutes: 45 }, updatedAt: new Date().toISOString() }))
    expect(store.readExtensionConfig('org.neoanki.tts')).toEqual({ enabled: true, profiles: [{ id: 'spanish' }] })
    store.close()
  })

  it('applies core-owned compatibility edits atomically and projects them back to the app', async () => {
    const root = await temporaryRoot(); const store = new WorkspaceStore(root); const initial = createSeedData()
    store.applyChanges(createWorkspaceChangeSet(null, initial))
    const document = store.workspaceV4Document()
    const noteType = document.workspace.noteTypes[0]
    const patch: WorkspacePatchV2 = {
      version: 2,
      idempotencyKey: 'test:core-note-type-edit',
      expectedWorkspaceRevision: document.workspace.revision,
      owner: { type: 'core' },
      operations: [{ op: 'update', kind: 'noteType', id: noteType.id, expectedRevision: noteType.revision, value: { ...noteType, revision: noteType.revision + 1, updatedAt: new Date().toISOString(), name: 'Edited Basic', css: '.card { color: rebeccapurple; }' } }],
    }
    const result = store.applyCoreWorkspacePatch(patch)
    expect(result.workspaceRevision).toBe(document.workspace.revision + 1)
    expect(store.workspaceV4Document().workspace.noteTypes[0]).toMatchObject({ name: 'Edited Basic', css: '.card { color: rebeccapurple; }' })
    expect(result.data.items[0].noteModel?.noteTypeName).toBe('Edited Basic')
    expect(store.applyCoreWorkspacePatch(patch).workspaceRevision).toBe(result.workspaceRevision)
    store.close()
  })

  it('migrates and preserves the legacy JSON workspace once', async () => {
    const root = await temporaryRoot()
    const seed = createSeedData()
    await writeFile(join(root, 'neo-anki-data.json'), JSON.stringify({ ...seed, version: 1, deviceId: undefined }))
    const store = new WorkspaceStore(root)
    expect(store.status().migratedLegacyData).toBe(true)
    expect(store.load()!.items).toHaveLength(seed.items.length)
    expect((await readdir(join(root, 'backups'))).some((name) => name.startsWith('legacy-json-'))).toBe(true)
    store.close()
  })

  it('recovers a corrupted database from the latest automatic backup', async () => {
    const root = await temporaryRoot()
    const first = new WorkspaceStore(root)
    const seed = createSeedData()
    first.applyChanges(createWorkspaceChangeSet(null, seed))
    await first.createAutomaticBackup()
    first.close()
    await writeFile(join(root, 'neo-anki.sqlite'), 'not a database')

    const recovered = new WorkspaceStore(root)
    expect(recovered.status().recoveredFromBackup).toBe(true)
    expect(recovered.load()!.deviceId).toBe(seed.deviceId)
    expect((await readdir(root)).some((name) => name.startsWith('neo-anki.corrupt-'))).toBe(true)
    recovered.close()
  })

  it('commits Workspace v4 Anki graphs atomically, retains rollback archives, and makes repeat import idempotent', async () => {
    const testWasm = `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`
    const SQL = await initSqlJs({ locateFile: () => testWasm })
    const db = new SQL.Database()
    db.run('CREATE TABLE col (crt integer, decks text, models text, dconf text)')
    db.run('CREATE TABLE notes (id integer, guid text, mid integer, mod integer, tags text, flds text)')
    db.run('CREATE TABLE cards (id integer, nid integer, did integer, ord integer, mod integer, type integer, queue integer, due integer, ivl integer, factor integer, reps integer, lapses integer, left integer, odue integer, odid integer, flags integer)')
    db.run('CREATE TABLE revlog (id integer, cid integer, usn integer, ease integer, ivl integer, lastIvl integer, factor integer, time integer, type integer)')
    db.run('INSERT INTO col VALUES (?, ?, ?, ?)', [1_700_000_000, JSON.stringify({ 10: { id: 10, name: 'Imported::Deck', conf: 1 } }), JSON.stringify({ 20: { id: 20, name: 'Basic', type: 0, flds: [{ name: 'Front', ord: 0 }, { name: 'Back', ord: 1 }], tmpls: [{ name: 'Card 1', ord: 0, qfmt: '{{Front}}', afmt: '{{FrontSide}}<hr>{{Back}}' }], css: '.card { color: navy; }' } }), JSON.stringify({ 1: { id: 1, name: 'Default', new: { delays: [1, 10], perDay: 20 }, rev: { perDay: 200, maxIvl: 36500 }, lapse: { delays: [10], leechFails: 8, leechAction: 0 } } })])
    db.run('INSERT INTO notes VALUES (?, ?, ?, ?, ?, ?)', [1, 'guid-1', 20, 1_700_000_100, ' imported ', 'front<img src="fixture.png">\u001fback'])
    db.run('INSERT INTO cards VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [2, 1, 10, 0, 1_700_000_200, 2, 2, 100, 10, 2500, 4, 1, 0, 0, 0, 3])
    db.run('INSERT INTO revlog VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [1_700_000_300_000, 2, -1, 3, 10, 5, 2500, 1200, 1])
    const archive = zipSync({ 'collection.anki2': db.export(), media: strToU8(JSON.stringify({ 0: 'fixture.png' })), 0: new Uint8Array([1, 2, 3, 4]) })
    db.close()
    const imported = await importAnkiWorkspaceV4(archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer, 'fixture.apkg', () => testWasm)

    const root = await temporaryRoot()
    const store = new WorkspaceStore(root)
    const seed = createSeedData()
    store.applyChanges(createWorkspaceChangeSet(null, seed))
    const checkpoint = await store.createImportCheckpoint()
    expect(checkpoint).toBeTruthy()
    expect(store.listMigrationRecoveryFiles()).toEqual([expect.objectContaining({ kind: 'workspace-checkpoint', name: basename(checkpoint!) })])
    const committed = store.commitWorkspaceV4Import({ document: imported.document, media: imported.mediaAssets, sourceArchive: imported.sourceArchive, operation: 'additive' })!
    expect(committed.items).toHaveLength(seed.items.length + 1)
    expect(committed.reviews).toHaveLength(1)
    expect(committed.cards.find((value) => value.id.includes(':card:2'))).toMatchObject({ suspended: false })
    const archiveDigest = createHash('sha256').update(imported.sourceArchive).digest('hex')
    const retainedPath = join(root, 'import-archives', `${archiveDigest}.apkg`)
    expect(await readFile(retainedPath)).toEqual(Buffer.from(imported.sourceArchive))
    await writeFile(retainedPath, 'partial archive left by an interrupted write')
    const repeated = store.commitWorkspaceV4Import({ document: imported.document, media: imported.mediaAssets, sourceArchive: imported.sourceArchive, operation: 'additive' })!
    expect(repeated.items).toHaveLength(seed.items.length + 1)
    expect(await readFile(retainedPath)).toEqual(Buffer.from(imported.sourceArchive))
    expect((await readdir(join(root, 'import-archives'))).some((name) => name.startsWith(`${archiveDigest}.apkg.corrupt-`))).toBe(true)
    expect(store.workspaceV4ExportPayload().media[0].dataUrl).toMatch(/^data:image\/png;base64,/)
    const recoveryFiles = store.listMigrationRecoveryFiles()
    expect(recoveryFiles.map((value) => value.kind).sort()).toEqual(['source-package', 'workspace-checkpoint'])
    for (const file of recoveryFiles) store.removeMigrationRecoveryFile(file.kind, file.name)
    expect(store.listMigrationRecoveryFiles()).toEqual([])
    expect(() => store.removeMigrationRecoveryFile('source-package', '../collection.apkg')).toThrow('invalid')
    store.close()
  })
})
