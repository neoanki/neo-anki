import { describe, expect, it } from 'vitest'
import { createSeedData } from '../data/seed'
import { loadData, migrateData, parseBackupText, saveData } from './storage'

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
  it('saves, loads, validates, and safely falls back from corruption', async () => {
    const data = createSeedData(); await saveData(data)
    expect(loadData().items).toHaveLength(data.items.length)
    expect(parseBackupText(JSON.stringify(data)).version).toBe(3)
    expect(() => parseBackupText('{}')).toThrow(/valid Neo Anki/)
    localStorage.setItem('neo-anki:data:v1', '{bad')
    expect(loadData().version).toBe(3)
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
      reportDiagnostic: async () => undefined,
      exportDiagnostics: async () => ({ canceled: true }),
      getReleaseInfo: async () => ({ currentVersion: '0.1.0', channel: 'development', automaticUpdates: false, releasesUrl: 'https://github.com/neoanki/neo-anki/releases' }),
      listExtensions: async () => [],
      chooseExtensionPackage: async () => ({ canceled: true }),
      installExtension: async () => { throw new Error('not used') },
      discardExtension: async () => undefined,
      setExtensionEnabled: async () => undefined,
      uninstallExtension: async () => undefined,
      reloadForExtensions: async () => undefined,
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
    } finally {
      window.neoAnkiDesktop = original
    }
  })
})
