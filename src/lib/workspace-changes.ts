import type { AppData, KnowledgeItem, LearningGoal, MediaAsset, PackConflict, PackSubscription, PracticeCard, ReviewEvent, SavedView, TrashEntry, UserSettings } from '../types.js'

export interface WorkspaceChangeSet {
  version: 1
  meta?: { deviceId: string; settings: UserSettings; updatedAt: string }
  upsert: {
    items: KnowledgeItem[]
    cards: PracticeCard[]
    reviews: ReviewEvent[]
    assets: MediaAsset[]
    goals: LearningGoal[]
    views: SavedView[]
    packs: PackSubscription[]
    packConflicts: PackConflict[]
    trash: TrashEntry[]
  }
  remove: {
    items: string[]
    cards: string[]
    reviews: string[]
    assets: string[]
    goals: string[]
    views: string[]
    packs: string[]
    packConflicts: string[]
    trash: string[]
  }
}

const changed = <T extends { id: string }>(previous: T[], current: T[]) => {
  const before = new Map(previous.map((value) => [value.id, value]))
  const afterIds = new Set(current.map((value) => value.id))
  return {
    upsert: current.filter((value) => {
      const existing = before.get(value.id)
      return !existing || (existing !== value && JSON.stringify(existing) !== JSON.stringify(value))
    }),
    remove: previous.filter((value) => !afterIds.has(value.id)).map((value) => value.id),
  }
}

export const createWorkspaceChangeSet = (previous: AppData | null, current: AppData): WorkspaceChangeSet => {
  const items = changed(previous?.items || [], current.items)
  const cards = changed(previous?.cards || [], current.cards)
  const reviews = changed(previous?.reviews || [], current.reviews)
  const assets = changed(previous?.assets || [], current.assets)
  const goals = changed(previous?.goals || [], current.goals)
  const views = changed(previous?.views || [], current.views)
  const packs = changed(previous?.packs || [], current.packs)
  const packConflicts = changed(previous?.packConflicts || [], current.packConflicts)
  const trash = changed(previous?.trash || [], current.trash)
  const metaChanged = !previous || previous.deviceId !== current.deviceId || previous.settings !== current.settings || previous.updatedAt !== current.updatedAt
  return {
    version: 1,
    meta: metaChanged ? { deviceId: current.deviceId, settings: current.settings, updatedAt: current.updatedAt } : undefined,
    upsert: { items: items.upsert, cards: cards.upsert, reviews: reviews.upsert, assets: assets.upsert, goals: goals.upsert, views: views.upsert, packs: packs.upsert, packConflicts: packConflicts.upsert, trash: trash.upsert },
    remove: { items: items.remove, cards: cards.remove, reviews: reviews.remove, assets: assets.remove, goals: goals.remove, views: views.remove, packs: packs.remove, packConflicts: packConflicts.remove, trash: trash.remove },
  }
}

export const hasWorkspaceChanges = (changes: WorkspaceChangeSet) => Boolean(changes.meta)
  || Object.values(changes.upsert).some((values) => values.length > 0)
  || Object.values(changes.remove).some((values) => values.length > 0)
