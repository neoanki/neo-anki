import { describe, expect, it } from 'vitest'
import { createSeedData } from '../data/seed'
import { loadData, migrateData, parseBackupText, saveData } from './storage'

describe('storage and migrations', () => {
  it('migrates v1 items and cards without data loss', () => {
    const seed = createSeedData()
    const legacy = { ...seed, version: 1, deviceId: undefined, goals: undefined, views: undefined, packs: undefined, packConflicts: undefined, assets: undefined, settings: { ...seed.settings, recoveryStrategy: undefined }, items: seed.items.map(({ citations: _c, mediaIds: _m, occlusions: _o, ...item }) => item), cards: seed.cards.map(({ createdAt: _c, updatedAt: _u, ...card }) => card) }
    const migrated = migrateData(legacy as never)
    expect(migrated.version).toBe(2)
    expect(migrated.items).toHaveLength(seed.items.length)
    expect(migrated.cards[0].createdAt).toBeTruthy()
    expect(migrated.settings.recoveryStrategy).toBe('risk')
  })
  it('saves, loads, validates, and safely falls back from corruption', () => {
    const data = createSeedData(); saveData(data)
    expect(loadData().items).toHaveLength(data.items.length)
    expect(parseBackupText(JSON.stringify(data)).version).toBe(2)
    expect(() => parseBackupText('{}')).toThrow(/valid Neo Anki/)
    localStorage.setItem('neo-anki:data:v1', '{bad')
    expect(loadData().version).toBe(2)
  })
})
