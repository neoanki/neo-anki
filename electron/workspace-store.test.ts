// @vitest-environment node
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createSeedData } from '../src/data/seed.js'
import { createWorkspaceChangeSet } from '../src/lib/workspace-changes.js'
import type { MediaAsset } from '../src/types.js'
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
})
