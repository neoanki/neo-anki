// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
})
