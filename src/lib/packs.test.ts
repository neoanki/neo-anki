import { describe, expect, it } from 'vitest'
import { createSeedData } from '../data/seed'
import { applyPackPatch, exportPack, installPack, resolvePackConflict, validatePackManifest, validatePackPatch } from './packs'
import type { PackManifest, PackPatch } from '../types'

const manifest: PackManifest = { format: 'neo-anki-pack', schemaVersion: 1, id: 'bio', name: 'Biology', description: 'Core biology', author: 'Teacher', version: '1.0.0', license: 'CC-BY', items: [{ sourceId: 'cell', prompt: 'Cell?', answer: 'Unit of life', context: '', collection: 'Biology', tags: ['cell'], variants: ['forward'] }] }

describe('shared pack three-way merge', () => {
  it('installs cards and applies clean updates without resetting scheduling', () => {
    const installed = installPack(createSeedData(), manifest).data
    const itemId = installed.packs.at(-1)!.itemMap.cell
    const card = installed.cards.find((candidate) => candidate.itemId === itemId)!
    card.fsrs.reps = 7
    const patch: PackPatch = { format: 'neo-anki-patch', schemaVersion: 1, packId: 'bio', fromVersion: '1.0.0', toVersion: '1.1.0', changelog: 'Clearer', changes: [{ type: 'update', sourceId: 'cell', item: { answer: 'Smallest unit of life' } }] }
    const updated = applyPackPatch(installed, patch).data
    expect(updated.items.find((item) => item.id === itemId)?.answer).toBe('Smallest unit of life')
    expect(updated.cards.find((candidate) => candidate.id === card.id)?.fsrs.reps).toBe(7)
  })
  it('surfaces conflicting local edits and resolves either side', () => {
    const installed = installPack(createSeedData(), manifest).data
    const itemId = installed.packs.at(-1)!.itemMap.cell
    installed.items.find((item) => item.id === itemId)!.answer = 'My local answer'
    const patch: PackPatch = { format: 'neo-anki-patch', schemaVersion: 1, packId: 'bio', fromVersion: '1.0.0', toVersion: '2.0.0', changelog: '', changes: [{ type: 'update', sourceId: 'cell', item: { answer: 'Upstream answer' } }] }
    const result = applyPackPatch(installed, patch)
    expect(result.conflicts).toHaveLength(1)
    expect(resolvePackConflict(result.data, result.conflicts[0].id, 'upstream').items.find((item) => item.id === itemId)?.answer).toBe('Upstream answer')
  })
  it('validates formats, exports selected items, and supports add/delete changes', () => {
    expect(() => validatePackManifest({})).toThrow(/format/)
    expect(() => validatePackPatch({})).toThrow(/format/)
    let data = installPack(createSeedData(), manifest).data
    const patch: PackPatch = { format: 'neo-anki-patch', schemaVersion: 1, packId: 'bio', fromVersion: '1.0.0', toVersion: '1.1.0', changelog: '', changes: [{ type: 'add', item: { sourceId: 'dna', prompt: 'DNA?', answer: 'Genetic material', context: '', collection: 'Biology', tags: [] } }, { type: 'delete', sourceId: 'cell' }] }
    const result = applyPackPatch(data, patch)
    expect(result).toMatchObject({ added: 1, deleted: 1 })
    data = result.data
    const exported = exportPack(data, [data.packs[0].itemMap.dna], { id: 'out', name: 'Out', description: '', author: 'Me', version: '1', license: 'CC0' })
    expect(exported.items[0].sourceId).toBe('dna')
  })
  it('keeps a local conflict resolution and flags edited upstream deletes', () => {
    const installed = installPack(createSeedData(), manifest).data
    const itemId = installed.packs.at(-1)!.itemMap.cell
    installed.items.find((item) => item.id === itemId)!.prompt = 'Locally edited?'
    const patch: PackPatch = { format: 'neo-anki-patch', schemaVersion: 1, packId: 'bio', fromVersion: '1.0.0', toVersion: '2.0.0', changelog: '', changes: [{ type: 'delete', sourceId: 'cell' }] }
    const result = applyPackPatch(installed, patch)
    expect(result.conflicts[0].field).toBe('$delete')
    expect(resolvePackConflict(result.data, result.conflicts[0].id, 'local').items.some((item) => item.id === itemId)).toBe(true)
  })
})
