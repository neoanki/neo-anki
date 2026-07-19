import { describe, expect, it } from 'vitest'
import { createSeedData } from '../data/seed'
import { mergeImportGraph } from './import-merge'

describe('atomic import graph merge', () => {
  it('remaps colliding item, card, and asset identifiers together', () => {
    const current = createSeedData()
    const sourceItem = structuredClone(current.items[0])
    const sourceCard = structuredClone(current.cards.find((card) => card.itemId === sourceItem.id)!)
    const now = new Date().toISOString()
    const asset = { id: 'shared-id', filename: 'a.txt', mimeType: 'text/plain', dataUrl: 'data:text/plain;base64,YQ==', byteLength: 1, hash: 'different', altText: '', createdAt: now, updatedAt: now }
    current.assets.push({ ...asset, hash: 'existing', dataUrl: 'data:text/plain;base64,Yg==' })
    sourceItem.answer = 'Imported answer with a colliding id'
    sourceItem.mediaIds = [asset.id]
    sourceCard.variant = 'typed'

    const result = mergeImportGraph(current, { items: [sourceItem], cards: [sourceCard], assets: [asset] })
    const importedItem = result.data.items.find((item) => item.answer === sourceItem.answer)!
    const importedCard = result.data.cards.find((card) => card.itemId === importedItem.id)!
    expect(importedItem.id).not.toBe(sourceItem.id)
    expect(importedCard.id).not.toBe(sourceCard.id)
    expect(importedItem.mediaIds[0]).not.toBe(asset.id)
    expect(result.remapped).toEqual({ items: 1, cards: 1, assets: 1 })
  })

  it('rejects a partial graph without mutating the current workspace', () => {
    const current = createSeedData()
    const before = structuredClone(current)
    const card = { ...structuredClone(current.cards[0]), id: 'imported-card', itemId: 'missing-item' }
    expect(() => mergeImportGraph(current, { items: [], cards: [card], assets: [] })).toThrow('references missing item')
    expect(current).toEqual(before)
  })
})
