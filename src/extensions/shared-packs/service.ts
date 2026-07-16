import type { AppData, Citation, KnowledgeItem, PackConflict, PackManifest, PackManifestItem, PackPatch, PracticeCard, PromptVariant } from '../../types'
import { makeEmptyFSRSCard } from '../../lib/fsrs'

const clone = <T>(value: T): T => structuredClone(value)
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
const nowIso = () => new Date().toISOString()
const variantsFor = (item: PackManifestItem): PromptVariant[] => item.variants?.length ? item.variants : [item.prompt.includes('{{c') ? 'cloze' : 'forward']

const citationsFor = (citations: PackManifestItem['citations'] = []): Citation[] => citations.map((citation) => ({ ...citation, id: crypto.randomUUID() }))

const manifestItemToKnowledge = (pack: PackManifest, source: PackManifestItem, now: string): KnowledgeItem => ({
  id: crypto.randomUUID(),
  prompt: source.prompt,
  answer: source.answer,
  context: source.context,
  collection: source.collection,
  tags: [...source.tags],
  citations: citationsFor(source.citations),
  mediaIds: [],
  occlusions: [],
  provenance: { packId: pack.id, sourceItemId: source.sourceId, packVersion: pack.version },
  createdAt: now,
  updatedAt: now,
})

const cardsForItem = (itemId: string, variants: PromptVariant[], now: string): PracticeCard[] => variants.map((variant) => ({
  id: crypto.randomUUID(),
  itemId,
  variant,
  suspended: false,
  fsrs: makeEmptyFSRSCard(new Date(now)),
  estimatedSeconds: variant === 'image-occlusion' ? 18 : variant === 'typed' ? 20 : 14,
  createdAt: now,
  updatedAt: now,
}))

export const validatePackManifest = (value: unknown): PackManifest => {
  if (!value || typeof value !== 'object') throw new Error('Pack manifest must be an object.')
  const manifest = value as Partial<PackManifest>
  if (manifest.format !== 'neo-anki-pack' || manifest.schemaVersion !== 1) throw new Error('Unsupported Neo Anki pack format.')
  if (!manifest.id || !manifest.name || !manifest.author || !manifest.version || !manifest.license) throw new Error('Pack metadata is incomplete.')
  if (!Array.isArray(manifest.items) || manifest.items.some((item) => !item.sourceId || !item.prompt || !item.answer)) throw new Error('Pack items are invalid.')
  return manifest as PackManifest
}

export const validatePackPatch = (value: unknown): PackPatch => {
  if (!value || typeof value !== 'object') throw new Error('Pack patch must be an object.')
  const patch = value as Partial<PackPatch>
  if (patch.format !== 'neo-anki-patch' || patch.schemaVersion !== 1 || !patch.packId || !patch.fromVersion || !patch.toVersion || !Array.isArray(patch.changes)) throw new Error('Unsupported Neo Anki patch format.')
  return patch as PackPatch
}

export const installPack = (data: AppData, rawManifest: unknown) => {
  const manifest = validatePackManifest(rawManifest)
  if (data.packs.some((pack) => pack.packId === manifest.id)) throw new Error(`${manifest.name} is already installed.`)
  const next = clone(data)
  const timestamp = nowIso()
  const itemMap: Record<string, string> = {}
  for (const source of manifest.items) {
    const item = manifestItemToKnowledge(manifest, source, timestamp)
    itemMap[source.sourceId] = item.id
    next.items.push(item)
    next.cards.push(...cardsForItem(item.id, variantsFor(source), timestamp))
  }
  next.packs.push({
    id: crypto.randomUUID(),
    packId: manifest.id,
    name: manifest.name,
    description: manifest.description,
    author: manifest.author,
    installedVersion: manifest.version,
    license: manifest.license,
    sourceUrl: manifest.sourceUrl,
    itemMap,
    baseItems: Object.fromEntries(manifest.items.map((item) => [item.sourceId, clone(item)])),
    installedAt: timestamp,
    updatedAt: timestamp,
  })
  next.updatedAt = timestamp
  return { data: next, installedItems: manifest.items.length }
}

const knowledgeValueFromPack = (field: PackConflict['field'], item: PackManifestItem) => {
  if (field === 'citations') return item.citations || []
  if (field === '$delete') return item
  return item[field]
}

const localValueFor = (field: PackConflict['field'], item: KnowledgeItem) => {
  if (field === 'citations') return item.citations.map(({ id: _id, ...citation }) => citation)
  if (field === '$delete') return item
  return item[field]
}

const mergeField = (
  field: Exclude<PackConflict['field'], '$delete'>,
  local: KnowledgeItem,
  base: PackManifestItem,
  upstream: PackManifestItem,
  conflicts: PackConflict[],
  packId: string,
  sourceId: string,
  timestamp: string,
) => {
  const baseValue = knowledgeValueFromPack(field, base)
  const localValue = localValueFor(field, local)
  const upstreamValue = knowledgeValueFromPack(field, upstream)
  if (equal(localValue, baseValue) || equal(localValue, upstreamValue)) {
    if (field === 'citations') local.citations = citationsFor(upstream.citations)
    else (local as unknown as Record<string, unknown>)[field] = clone(upstreamValue)
    return
  }
  if (equal(upstreamValue, baseValue)) return
  conflicts.push({
    id: crypto.randomUUID(), packId, sourceItemId: sourceId, itemId: local.id, field,
    baseValue: clone(baseValue), localValue: clone(localValue), upstreamValue: clone(upstreamValue), createdAt: timestamp,
  })
}

export const applyPackPatch = (data: AppData, rawPatch: unknown) => {
  const patch = validatePackPatch(rawPatch)
  const next = clone(data)
  const subscription = next.packs.find((pack) => pack.packId === patch.packId)
  if (!subscription) throw new Error('Install the pack before applying this patch.')
  if (subscription.installedVersion !== patch.fromVersion) throw new Error(`Patch requires ${patch.fromVersion}, but ${subscription.installedVersion} is installed.`)
  const timestamp = nowIso()
  const conflicts: PackConflict[] = []
  let added = 0
  let updated = 0
  let deleted = 0

  for (const change of patch.changes) {
    if (change.type === 'add') {
      if (subscription.itemMap[change.item.sourceId]) continue
      const syntheticManifest: PackManifest = {
        format: 'neo-anki-pack', schemaVersion: 1, id: patch.packId, name: subscription.name,
        description: subscription.description, author: subscription.author, version: patch.toVersion,
        license: subscription.license, sourceUrl: subscription.sourceUrl, items: [change.item],
      }
      const item = manifestItemToKnowledge(syntheticManifest, change.item, timestamp)
      subscription.itemMap[change.item.sourceId] = item.id
      subscription.baseItems[change.item.sourceId] = clone(change.item)
      next.items.push(item)
      next.cards.push(...cardsForItem(item.id, variantsFor(change.item), timestamp))
      added += 1
      continue
    }

    const itemId = subscription.itemMap[change.sourceId]
    const local = next.items.find((item) => item.id === itemId)
    const base = subscription.baseItems[change.sourceId]
    if (!local || !base) continue

    if (change.type === 'delete') {
      const unchanged = ['prompt', 'answer', 'context', 'collection', 'tags', 'citations'].every((field) => equal(localValueFor(field as PackConflict['field'], local), knowledgeValueFromPack(field as PackConflict['field'], base)))
      if (unchanged) {
        const removedCardIds = new Set(next.cards.filter((card) => card.itemId === local.id).map((card) => card.id))
        next.items = next.items.filter((item) => item.id !== local.id)
        next.cards = next.cards.filter((card) => card.itemId !== local.id)
        next.reviews = next.reviews.filter((review) => !removedCardIds.has(review.cardId))
        delete subscription.itemMap[change.sourceId]
        delete subscription.baseItems[change.sourceId]
        deleted += 1
      } else {
        conflicts.push({
          id: crypto.randomUUID(), packId: patch.packId, sourceItemId: change.sourceId, itemId: local.id, field: '$delete',
          baseValue: clone(base), localValue: clone(local), upstreamValue: null, createdAt: timestamp,
        })
      }
      continue
    }

    const upstream: PackManifestItem = { ...clone(base), ...clone(change.item), sourceId: change.sourceId }
    for (const field of ['prompt', 'answer', 'context', 'collection', 'tags', 'citations'] as const) mergeField(field, local, base, upstream, conflicts, patch.packId, change.sourceId, timestamp)
    local.provenance = { packId: patch.packId, sourceItemId: change.sourceId, packVersion: patch.toVersion }
    local.updatedAt = timestamp
    subscription.baseItems[change.sourceId] = upstream
    updated += 1
  }

  subscription.installedVersion = patch.toVersion
  subscription.updatedAt = timestamp
  next.packConflicts.push(...conflicts)
  next.updatedAt = timestamp
  return { data: next, added, updated, deleted, conflicts }
}

export const resolvePackConflict = (data: AppData, conflictId: string, resolution: 'local' | 'upstream') => {
  const next = clone(data)
  const conflict = next.packConflicts.find((candidate) => candidate.id === conflictId)
  if (!conflict) throw new Error('Pack conflict not found.')
  const item = next.items.find((candidate) => candidate.id === conflict.itemId)
  if (!item) throw new Error('Conflicting item no longer exists.')
  if (resolution === 'upstream') {
    if (conflict.field === '$delete') {
      const removedCards = new Set(next.cards.filter((card) => card.itemId === item.id).map((card) => card.id))
      next.items = next.items.filter((candidate) => candidate.id !== item.id)
      next.cards = next.cards.filter((card) => card.itemId !== item.id)
      next.reviews = next.reviews.filter((review) => !removedCards.has(review.cardId))
    } else if (conflict.field === 'citations') {
      item.citations = citationsFor(conflict.upstreamValue as PackManifestItem['citations'])
    } else {
      (item as unknown as Record<string, unknown>)[conflict.field] = clone(conflict.upstreamValue)
      item.updatedAt = nowIso()
    }
  }
  next.packConflicts = next.packConflicts.filter((candidate) => candidate.id !== conflictId)
  next.updatedAt = nowIso()
  return next
}

export const exportPack = (data: AppData, itemIds: string[], metadata: Omit<PackManifest, 'format' | 'schemaVersion' | 'items'>): PackManifest => ({
  format: 'neo-anki-pack',
  schemaVersion: 1,
  ...metadata,
  items: data.items.filter((item) => itemIds.includes(item.id)).map((item) => ({
    sourceId: item.provenance?.sourceItemId || item.id,
    prompt: item.prompt,
    answer: item.answer,
    context: item.context,
    collection: item.collection,
    tags: [...item.tags],
    citations: item.citations.map(({ id: _id, ...citation }) => citation),
    variants: data.cards.filter((card) => card.itemId === item.id).map((card) => card.variant),
  })),
})
