import { describe, expect, it, vi } from 'vitest'
import { createEmptyWorkspaceData, createSeedData } from '../data/seed'
import { adoptPersistedData, clearStoredData, downloadBackup, exportRecoverySource, loadData, loadWorkspaceData, migrateData, parseBackupText, saveData, unlockPersistence } from './storage'
import { appDataToWorkspaceDocumentV4, workspaceDocumentV4ToAppData } from './workspace-v4'

describe('storage and migrations', () => {
  it('migrates v1 items and cards without data loss', () => {
    const seed = createSeedData()
    const legacy = { ...seed, version: 1, deviceId: undefined, goals: undefined, views: undefined, packs: undefined, packConflicts: undefined, assets: undefined, settings: { ...seed.settings, recoveryStrategy: undefined }, items: seed.items.map(({ citations: _c, mediaIds: _m, occlusions: _o, ...item }) => item), cards: seed.cards.map(({ createdAt: _c, updatedAt: _u, ...card }) => card) }
    const migrated = migrateData(legacy as never)
    expect(migrated.version).toBe(3)
    expect(migrated.items).toHaveLength(seed.items.length)
    expect(migrated.cards[0].createdAt).toBeTruthy()
    expect(migrated.settings.recoveryStrategy).toBe('risk')
  })
  it('starts empty, saves, loads, validates, and reports corruption without substituting data', async () => {
    const empty = loadWorkspaceData()
    expect(empty.ok && empty.data).toEqual(expect.objectContaining({ items: [], cards: [], goals: [], views: [] }))
    const data = createSeedData(); await saveData(data)
    expect(loadData().items).toHaveLength(data.items.length)
    expect(parseBackupText(JSON.stringify(data)).version).toBe(3)
    expect(() => parseBackupText('{}')).toThrow(/valid Neo Anki/)
    localStorage.setItem('neo-anki:data:v1', '{bad')
    const failed = loadWorkspaceData()
    expect(failed).toEqual(expect.objectContaining({ ok: false, failure: expect.objectContaining({ code: 'parse', canExportOriginal: true }) }))
    expect(() => loadData()).toThrow()
    await expect(saveData(createEmptyWorkspaceData())).rejects.toThrow(/blocked until workspace recovery/i)
  })

  it('never includes demo content in the production empty factory', () => {
    const empty = createEmptyWorkspaceData()
    expect(empty.items).toEqual([])
    expect(empty.cards).toEqual([])
    expect(empty.reviews).toEqual([])
    expect(empty.assets).toEqual([])
    expect(empty.goals).toEqual([])
    expect(empty.views).toEqual([])
  })

  it('exports a browser recovery checkpoint before unlocking destructive recovery', async () => {
    const createObjectUrl = vi.fn(() => 'blob:neoanki-recovery')
    const revokeObjectUrl = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    localStorage.setItem('neo-anki:data:v1', '{damaged')

    expect(loadWorkspaceData()).toMatchObject({ ok: false, failure: { code: 'parse', mode: 'browser', canExportOriginal: true } })
    await expect(exportRecoverySource()).resolves.toEqual({ canceled: false })
    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob))
    expect(click).toHaveBeenCalledOnce()
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:neoanki-recovery')

    const empty = createEmptyWorkspaceData()
    unlockPersistence(empty)
    await saveData(empty)
    await expect(exportRecoverySource()).rejects.toThrow(/no longer available/)
    await downloadBackup(empty)
    expect(click).toHaveBeenCalledTimes(2)
    await clearStoredData()
    expect(localStorage.getItem('neo-anki:data:v1')).toBeNull()
  })

  it('keeps the validated native template graph authoritative in browser storage', async () => {
    const document = appDataToWorkspaceDocumentV4(createSeedData())
    document.workspace.templates[0].name = 'Browser-native recall'
    document.workspace.templates[0].revision += 1
    document.workspace.templates[0].updatedAt = new Date().toISOString()
    document.workspace.revision += 1
    const projection = workspaceDocumentV4ToAppData(document)
    projection.workspaceDocumentV4 = document

    await saveData(projection)
    const loaded = loadData()
    expect(loaded.workspaceDocumentV4).toBeTruthy()
    expect(appDataToWorkspaceDocumentV4(loaded).workspace.templates[0].name).toBe('Browser-native recall')
  })

  it('reports desktop read and migration failures and uses preserved-source export', async () => {
    const original = window.neoAnkiDesktop
    const exportDesktop = vi.fn(async () => ({ canceled: false, path: '/tmp/recovery.sqlite' }))
    try {
      window.neoAnkiDesktop = { loadData: () => ({ data: null, storagePath: '/tmp/workspace.sqlite', recoveredFromBackup: false, error: 'SQLite read failed', recoverySourcePath: '/tmp/recovery.sqlite' }), exportRecoverySource: exportDesktop } as never
      expect(loadWorkspaceData()).toMatchObject({ ok: false, failure: { code: 'read', mode: 'desktop', sourcePath: '/tmp/recovery.sqlite', canExportOriginal: true } })
      await expect(exportRecoverySource()).resolves.toEqual({ canceled: false, path: '/tmp/recovery.sqlite' })
      expect(exportDesktop).toHaveBeenCalledOnce()

      window.neoAnkiDesktop = { loadData: () => ({ data: { version: 999 }, storagePath: '/tmp/workspace.sqlite', recoveredFromBackup: false }), exportRecoverySource: exportDesktop } as never
      expect(loadWorkspaceData()).toMatchObject({ ok: false, failure: { code: 'migration', mode: 'desktop', sourcePath: '/tmp/workspace.sqlite' } })
      unlockPersistence()
    } finally {
      window.neoAnkiDesktop = original
    }
  })

  it('uses the narrow desktop bridge instead of browser storage when available', async () => {
    const data = createSeedData()
    const saved: unknown[] = []
    const original = window.neoAnkiDesktop
    window.neoAnkiDesktop = {
      isDesktop: true,
      rendererReady: () => undefined,
      loadData: () => ({ data, storagePath: '/tmp/neo-anki-data.json', recoveredFromBackup: false }),
      saveData: async (value) => { saved.push(value) },
      exportBackup: async () => ({ canceled: false, path: '/tmp/backup.json' }),
      restoreBackup: async () => ({ canceled: true }),
      resetData: async () => undefined,
      createImportCheckpoint: async () => '',
      commitWorkspaceV4Import: async () => data,
      loadWorkspaceV4ExportPayload: async () => ({ document: {}, media: [] }),
      loadWorkspaceV4Document: async () => ({} as never), applyCoreWorkspacePatchV2: async () => ({ workspaceRevision: 1, data } as never),
      extensionApplyPatchV2: async () => ({ workspaceRevision: 1, data }), extensionCreateMediaV2: async () => ({ id: 'media', sha256: 'a'.repeat(64), byteLength: 1, workspaceRevision: 1 }), extensionSecretReadBatchV2: async () => ({}), extensionSecretMutateBatchV2: async () => undefined, extensionConfigReadV2: async () => null, extensionConfigWriteV2: async () => ({ workspaceRevision: 1, data }), extensionContentListNotesV2: async () => ({ workspaceRevision: 1, notes: [], availableMediaIds: [] }), extensionMigrationExportV2: async () => ({ document: {}, media: [] }), extensionMigrationCommitV2: async () => ({ workspaceRevision: 1, summary: { notes: data.items.length, cards: data.cards.length }, data }), extensionCancelV2: async () => undefined,
      reportDiagnostic: async () => undefined,
      exportDiagnostics: async () => ({ canceled: true }),
      getReleaseInfo: async () => ({ currentVersion: '0.1.0', automaticUpdates: false, releasesUrl: 'https://github.com/neoanki/neo-anki/releases' }),
      listExtensions: async () => [],
      listMarketplaceExtensions: async () => [],
      stageMarketplaceExtension: async () => { throw new Error('not used') },
      chooseExtensionPackage: async () => ({ canceled: true }),
      installExtension: async () => { throw new Error('not used') },
      discardExtension: async () => undefined,
      setExtensionEnabled: async () => undefined,
      uninstallExtension: async () => undefined,
      reloadForExtensions: async () => undefined,
      claimExtensionCapability: async () => 'token',
      extensionNetworkFetch: async () => ({ status: 200, statusText: 'OK', headers: {}, bodyBase64: '' }),
      syncStatus: async () => ({ configured: false, pendingOperations: 0, conflicts: [] }),
      syncListDevices: async () => [],
      syncCreateAccount: async () => ({ recoveryBundle: '', status: { configured: false, pendingOperations: 0, conflicts: [] } }),
      syncRecoverAccount: async () => ({ data, status: { configured: false, pendingOperations: 0, conflicts: [] } }),
      syncNow: async () => ({ data: null, status: { configured: false, pendingOperations: 0, conflicts: [] }, sent: 0, received: 0 }),
      syncResolveConflict: async () => ({ data, status: { configured: false, pendingOperations: 0, conflicts: [] }, sent: 0, received: 0 }),
      syncRotateRecovery: async () => '',
      syncRevokeDevice: async () => undefined,
      syncDisconnect: async () => undefined,
      syncDeleteAccount: async () => undefined,
      onNavigate: () => () => undefined,
    }

    try {
      const loaded = loadData()
      expect(loaded.deviceId).toBe(data.deviceId)
      const changed = { ...loaded, settings: { ...loaded.settings, dailyMinutes: 45 }, updatedAt: new Date(Date.now() + 1000).toISOString() }
      await saveData(changed)
      expect(saved).toHaveLength(1)
      expect(saved[0]).toEqual(expect.objectContaining({ meta: expect.objectContaining({ settings: expect.objectContaining({ dailyMinutes: 45 }) }) }))
      expect((saved[0] as { upsert: { items: unknown[] } }).upsert.items).toHaveLength(0)

      const importedItems = changed.items.slice(0, 2)
      const importedIds = new Set(importedItems.map((item) => item.id))
      const directlyCommitted = { ...changed, reviews: [], items: importedItems, cards: changed.cards.filter((card) => importedIds.has(card.itemId)), trash: [], updatedAt: new Date(Date.now() + 2000).toISOString() }
      adoptPersistedData(directlyCommitted)
      const afterDirectCommit = { ...directlyCommitted, items: directlyCommitted.items.map((item, index) => index ? item : { ...item, tags: [...item.tags, 'after-import'], updatedAt: new Date(Date.now() + 3000).toISOString() }), updatedAt: new Date(Date.now() + 3000).toISOString() }
      await saveData(afterDirectCommit)
      const directChanges = saved[1] as { upsert: { items: unknown[] }; remove: { reviews: string[]; items: string[] } }
      expect(directChanges.upsert.items).toHaveLength(1)
      expect(directChanges.remove.reviews).toEqual([])
      expect(directChanges.remove.items).toEqual([])

      let releaseFirst!: () => void
      const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve })
      window.neoAnkiDesktop!.saveData = async (value) => { saved.push(value); if (saved.length === 3) await firstBlocked }
      const card = afterDirectCommit.cards[0]
      const reviewA = { id: 'rapid-review-a', cardId: card.id, rating: 3 as const, kind: 'review' as const, reviewedAt: '2026-07-19T10:00:00.000Z', durationSeconds: 3, previousDue: card.fsrs.due, nextDue: card.fsrs.due }
      const reviewB = { ...reviewA, id: 'rapid-review-b', reviewedAt: '2026-07-19T10:00:01.000Z' }
      const firstRapid = { ...afterDirectCommit, reviews: [reviewA], updatedAt: reviewA.reviewedAt }
      const secondRapid = { ...firstRapid, reviews: [reviewA, reviewB], updatedAt: reviewB.reviewedAt }
      const firstSave = saveData(firstRapid)
      const secondSave = saveData(secondRapid)
      releaseFirst()
      await Promise.all([firstSave, secondSave])
      expect(saved).toHaveLength(3)
      expect((saved[2] as { upsert: { reviews: Array<{ id: string }> } }).upsert.reviews.map((value) => value.id)).toEqual([
        'rapid-review-a',
        'rapid-review-b',
      ])
    } finally {
      window.neoAnkiDesktop = original
    }
  })
})
