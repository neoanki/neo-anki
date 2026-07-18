import type { AppData, Citation, KnowledgeItem, PackConflict, PackManifest, PackManifestItem, PackPatch, PracticeCard } from '../../types'
import { makeEmptyFSRSCard } from '../../lib/fsrs'

const clone = <T>(value: T): T => structuredClone(value)
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
const nowIso = () => new Date().toISOString()
type PackCardSpec = NonNullable<PackManifestItem['cards']>[number]
const cardSpecsFor = (item: PackManifestItem): PackCardSpec[] => item.cards?.length
  ? clone(item.cards)
  : (item.variants?.length ? item.variants : [item.prompt.includes('{{c') ? 'cloze' : 'forward']).map((variant, index) => ({ id: `legacy:${index}:${variant}`, variant }))
const requireString = (value: unknown, field: string) => { if (typeof value !== 'string' || !value.trim() || value.length > 10_000) throw new Error(`Pack ${field} is invalid.`); return value }
const assertManifestItem = (value: unknown, field: string): PackManifestItem => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Pack ${field} is invalid.`)
  const item = value as PackManifestItem
  requireString(item.sourceId, `${field}.sourceId`); requireString(item.prompt, `${field}.prompt`); requireString(item.answer, `${field}.answer`)
  if (typeof item.context !== 'string' || typeof item.collection !== 'string' || !Array.isArray(item.tags) || item.tags.some((tag) => typeof tag !== 'string')) throw new Error(`Pack ${field} fields are invalid.`)
  if (item.variants && (!Array.isArray(item.variants) || item.variants.some((variant) => typeof variant !== 'string' || !variant.trim()) || new Set(item.variants).size !== item.variants.length)) throw new Error(`Pack ${field} variants are invalid.`)
  if (item.cards && (!Array.isArray(item.cards) || item.cards.some((card) => !card || typeof card.id !== 'string' || !card.id.trim() || typeof card.variant !== 'string' || !card.variant.trim()) || new Set(item.cards.map((card) => card.id)).size !== item.cards.length)) throw new Error(`Pack ${field} cards are invalid.`)
  return item
}

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

const cardsForItem = (itemId: string, specs: PackCardSpec[], now: string): PracticeCard[] => specs.map((spec) => ({
  id: crypto.randomUUID(),
  itemId,
  variant: spec.variant,
  promptData: spec.promptData ? clone(spec.promptData) : undefined,
  occlusionId: spec.occlusionId,
  suspended: false,
  fsrs: makeEmptyFSRSCard(new Date(now)),
  estimatedSeconds: spec.variant === 'image-occlusion' ? 18 : spec.variant === 'typed' ? 20 : 14,
  createdAt: now,
  updatedAt: now,
}))

export const validatePackManifest = (value: unknown): PackManifest => {
  if (!value || typeof value !== 'object') throw new Error('Pack manifest must be an object.')
  const manifest = value as Partial<PackManifest>
  if (manifest.format !== 'neo-anki-pack' || manifest.schemaVersion !== 1) throw new Error('Unsupported Neo Anki pack format.')
  requireString(manifest.id, 'id'); requireString(manifest.name, 'name'); requireString(manifest.author, 'author'); requireString(manifest.version, 'version'); requireString(manifest.license, 'license')
  if (!Array.isArray(manifest.items)) throw new Error('Pack items are invalid.')
  manifest.items.forEach((item, index) => assertManifestItem(item, `items.${index}`))
  if (new Set(manifest.items.map((item) => item.sourceId)).size !== manifest.items.length) throw new Error('Pack source IDs must be unique.')
  return manifest as PackManifest
}

export const validatePackPatch = (value: unknown): PackPatch => {
  if (!value || typeof value !== 'object') throw new Error('Pack patch must be an object.')
  const patch = value as Partial<PackPatch>
  if (patch.format !== 'neo-anki-patch' || patch.schemaVersion !== 1 || !patch.packId || !patch.fromVersion || !patch.toVersion || !Array.isArray(patch.changes)) throw new Error('Unsupported Neo Anki patch format.')
  const sourceIds = patch.changes.map((change, index) => {
    if (!change || typeof change !== 'object' || !['add', 'update', 'delete'].includes(change.type)) throw new Error(`Pack patch change ${index} is invalid.`)
    if (change.type === 'add') return assertManifestItem(change.item, `changes.${index}.item`).sourceId
    requireString(change.sourceId, `changes.${index}.sourceId`)
    if (change.type === 'update' && (!change.item || typeof change.item !== 'object' || Array.isArray(change.item))) throw new Error(`Pack patch change ${index} update is invalid.`)
    return change.sourceId
  })
  if (new Set(sourceIds).size !== sourceIds.length) throw new Error('A pack patch may change each source ID only once.')
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
    next.cards.push(...cardsForItem(item.id, cardSpecsFor(source), timestamp))
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
  if (field === '$variants') return cardSpecsFor(item)
  if (field === '$delete') return item
  return item[field]
}

const localValueFor = (field: PackConflict['field'], item: KnowledgeItem) => {
  if (field === 'citations') return item.citations.map(({ id: _id, ...citation }) => citation)
  if (field === '$variants') return undefined
  if (field === '$delete') return item
  return item[field]
}

const localCardSpecs = (data: AppData, itemId: string): PackCardSpec[] => data.cards.filter((card) => card.itemId === itemId).map((card) => ({ id: card.id, variant: card.variant, promptData: card.promptData ? clone(card.promptData) : undefined, occlusionId: card.occlusionId }))
const reconcileVariants = (data: AppData, itemId: string, specs: PackCardSpec[], timestamp: string) => {
  data.cards = data.cards.filter((card) => card.itemId !== itemId)
  data.cards.push(...cardsForItem(itemId, specs, timestamp))
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
      if (subscription.itemMap[change.item.sourceId]) throw new Error(`Pack item ${change.item.sourceId} already exists; the patch was not applied.`)
      const syntheticManifest: PackManifest = {
        format: 'neo-anki-pack', schemaVersion: 1, id: patch.packId, name: subscription.name,
        description: subscription.description, author: subscription.author, version: patch.toVersion,
        license: subscription.license, sourceUrl: subscription.sourceUrl, items: [change.item],
      }
      const item = manifestItemToKnowledge(syntheticManifest, change.item, timestamp)
      subscription.itemMap[change.item.sourceId] = item.id
      subscription.baseItems[change.item.sourceId] = clone(change.item)
      next.items.push(item)
      next.cards.push(...cardsForItem(item.id, cardSpecsFor(change.item), timestamp))
      added += 1
      continue
    }

    const itemId = subscription.itemMap[change.sourceId]
    const local = next.items.find((item) => item.id === itemId)
    const base = subscription.baseItems[change.sourceId]
    if (!itemId || !local || !base) throw new Error(`Pack item ${change.sourceId} drifted from its installed base; the patch was not applied.`)

    if (change.type === 'delete') {
      const unchanged = ['prompt', 'answer', 'context', 'collection', 'tags', 'citations'].every((field) => equal(localValueFor(field as PackConflict['field'], local), knowledgeValueFromPack(field as PackConflict['field'], base)))
      if (unchanged) {
        next.items = next.items.filter((item) => item.id !== local.id)
        next.cards = next.cards.filter((card) => card.itemId !== local.id)
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
    const baseVariants = cardSpecsFor(base)
    const upstreamVariants = cardSpecsFor(upstream)
    if (!equal(baseVariants, upstreamVariants)) {
      const localVariants = localCardSpecs(next, local.id)
      const comparableLocal = localVariants.map(({ id: _id, ...value }) => value)
      const comparableBase = baseVariants.map(({ id: _id, ...value }) => value)
      const comparableUpstream = upstreamVariants.map(({ id: _id, ...value }) => value)
      if (equal(comparableLocal, comparableBase) || equal(comparableLocal, comparableUpstream)) reconcileVariants(next, local.id, upstreamVariants, timestamp)
      else conflicts.push({ id: crypto.randomUUID(), packId: patch.packId, sourceItemId: change.sourceId, itemId: local.id, field: '$variants', baseValue: baseVariants, localValue: localVariants, upstreamValue: upstreamVariants, createdAt: timestamp })
    }
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
      next.items = next.items.filter((candidate) => candidate.id !== item.id)
      next.cards = next.cards.filter((card) => card.itemId !== item.id)
      const subscription = next.packs.find((candidate) => candidate.packId === conflict.packId)
      if (subscription) { delete subscription.itemMap[conflict.sourceItemId]; delete subscription.baseItems[conflict.sourceItemId]; subscription.updatedAt = nowIso() }
    } else if (conflict.field === '$variants') {
      reconcileVariants(next, item.id, conflict.upstreamValue as PackCardSpec[], nowIso())
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
    cards: data.cards.filter((card) => card.itemId === item.id).map((card) => ({ id: card.id, variant: card.variant, promptData: card.promptData ? clone(card.promptData) : undefined, occlusionId: card.occlusionId })),
  })),
})
