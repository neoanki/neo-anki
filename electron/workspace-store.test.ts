// @vitest-environment node
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
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

  it('checkpoints and validates extension-brokered Workspace v4 imports', async () => {
    const store = new WorkspaceStore(await temporaryRoot()), seed = createSeedData(), checkpoint = await store.createImportCheckpoint()
    expect(checkpoint).toBeNull()
    const committed = store.commitWorkspaceV4Import({ document: appDataToWorkspaceDocumentV4(seed), media: [], operation: 'replace-profile' })
    expect(committed?.items).toHaveLength(seed.items.length)
    expect(await store.createImportCheckpoint()).toBeTruthy()
    store.close()
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

  it('keeps bounded rolling backups of the latest accepted workspace state', async () => {
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
    expect(backups).toHaveLength(7)
    const retainedMinutes = backups.map((name) => {
      const backup = new DatabaseSync(join(root, 'backups', name), { readOnly: true })
      const json = (backup.prepare('SELECT settings_json FROM workspace_meta WHERE id = 1').get() as { settings_json: string }).settings_json
      backup.close()
      return (JSON.parse(json) as { dailyMinutes: number }).dailyMinutes
    })
    expect(retainedMinutes).toContain(40)
    expect(Math.max(...retainedMinutes)).toBe(40)
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
