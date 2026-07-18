import type { AppData, ImportSummary } from '../types'
import { parseWorkspaceData } from './workspace-schema'

export interface ImportMergeResult {
  data: AppData
  remapped: { items: number; cards: number; assets: number }
}

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
const uniqueIds = <T extends { id: string }>(label: string, values: T[]) => {
  if (new Set(values.map((value) => value.id)).size !== values.length) throw new Error(`The import contains duplicate ${label} identifiers.`)
}

/** Atomically remaps a complete import graph instead of independently dropping collisions. */
export const mergeImportGraph = (current: AppData, imported: Pick<ImportSummary, 'items' | 'cards' | 'assets'>): ImportMergeResult => {
  uniqueIds('item', imported.items); uniqueIds('card', imported.cards); uniqueIds('asset', imported.assets)
  const existingItems = new Map(current.items.map((value) => [value.id, value]))
  const existingCards = new Map(current.cards.map((value) => [value.id, value]))
  const existingAssets = new Map(current.assets.map((value) => [value.id, value]))
  const incomingItemIds = new Set(imported.items.map((value) => value.id))
  const incomingAssetIds = new Set(imported.assets.map((value) => value.id))
  const itemIds = new Map<string, string>()
  const assetIds = new Map<string, string>()
  const cardIds = new Map<string, string>()
  const remapped = { items: 0, cards: 0, assets: 0 }

  for (const item of imported.items) {
    const existing = existingItems.get(item.id)
    const nextId = !existing || same(existing, item) ? item.id : crypto.randomUUID()
    itemIds.set(item.id, nextId)
    if (nextId !== item.id) remapped.items += 1
  }
  for (const asset of imported.assets) {
    const existing = existingAssets.get(asset.id)
    const equivalent = existing && existing.hash === asset.hash && existing.byteLength === asset.byteLength && existing.mimeType === asset.mimeType
    const nextId = !existing || equivalent ? asset.id : crypto.randomUUID()
    assetIds.set(asset.id, nextId)
    if (nextId !== asset.id) remapped.assets += 1
  }
  for (const card of imported.cards) {
    const existing = existingCards.get(card.id)
    const nextId = !existing || same(existing, card) ? card.id : crypto.randomUUID()
    cardIds.set(card.id, nextId)
    if (nextId !== card.id) remapped.cards += 1
  }

  const items = imported.items.flatMap((item) => {
    const id = itemIds.get(item.id)!
    if (id === item.id && existingItems.has(id) && same(existingItems.get(id), item)) return []
    const mediaIds = item.mediaIds.map((assetId) => {
      const mapped = assetIds.get(assetId)
      if (mapped) return mapped
      if (existingAssets.has(assetId)) return assetId
      throw new Error(`Imported item ${item.id} references missing media ${assetId}.`)
    })
    return [{ ...structuredClone(item), id, mediaIds }]
  })
  const assets = imported.assets.flatMap((asset) => {
    const id = assetIds.get(asset.id)!
    if (id === asset.id && existingAssets.has(id)) return []
    return [{ ...structuredClone(asset), id }]
  })
  const cards = imported.cards.flatMap((card) => {
    const id = cardIds.get(card.id)!
    const mappedItemId = itemIds.get(card.itemId)
    if (!mappedItemId && !existingItems.has(card.itemId)) throw new Error(`Imported card ${card.id} references missing item ${card.itemId}.`)
    if (!incomingItemIds.has(card.itemId) && !existingItems.has(card.itemId)) throw new Error(`Imported card ${card.id} has an external item reference.`)
    if (id === card.id && existingCards.has(id) && same(existingCards.get(id), card)) return []
    return [{ ...structuredClone(card), id, itemId: mappedItemId || card.itemId }]
  })

  // Assets not referenced by an item are allowed for source-package fidelity, but
  // every referenced incoming id must have been present in the same graph.
  imported.items.flatMap((item) => item.mediaIds).forEach((assetId) => {
    if (!incomingAssetIds.has(assetId) && !existingAssets.has(assetId)) throw new Error(`The import graph is missing media ${assetId}.`)
  })

  return {
    data: parseWorkspaceData({
      ...current,
      items: [...current.items, ...items],
      cards: [...current.cards, ...cards],
      assets: [...current.assets, ...assets],
      updatedAt: new Date().toISOString(),
    }),
    remapped,
  }
}
