import type { AppData } from '../types'

const byIdNewest = <T extends { id: string; updatedAt?: string }>(left: T[], right: T[]) => {
  const merged = new Map<string, T>()
  for (const value of [...left, ...right]) {
    const existing = merged.get(value.id)
    if (!existing || (value.updatedAt || '') >= (existing.updatedAt || '')) merged.set(value.id, value)
  }
  return [...merged.values()]
}

export const mergeAppData = (local: AppData, remote: AppData): AppData => {
  const localIsNewer = local.updatedAt >= remote.updatedAt
  return {
    version: 2,
    deviceId: local.deviceId,
    items: byIdNewest(local.items, remote.items),
    cards: byIdNewest(local.cards, remote.cards),
    reviews: byIdNewest(local.reviews.map((review) => ({ ...review, updatedAt: review.reviewedAt })), remote.reviews.map((review) => ({ ...review, updatedAt: review.reviewedAt }))).map(({ updatedAt: _updatedAt, ...review }) => review),
    assets: byIdNewest(local.assets, remote.assets),
    goals: byIdNewest(local.goals, remote.goals),
    views: byIdNewest(local.views, remote.views),
    packs: byIdNewest(local.packs, remote.packs),
    packConflicts: byIdNewest(local.packConflicts.map((conflict) => ({ ...conflict, updatedAt: conflict.createdAt })), remote.packConflicts.map((conflict) => ({ ...conflict, updatedAt: conflict.createdAt }))).map(({ updatedAt: _updatedAt, ...conflict }) => conflict),
    settings: localIsNewer ? local.settings : remote.settings,
    updatedAt: local.updatedAt >= remote.updatedAt ? local.updatedAt : remote.updatedAt,
  }
}

export interface SyncTransport {
  publish(data: AppData): void | Promise<void>
  subscribe(listener: (data: AppData) => void): () => void
  close?(): void
}

export const createTabSyncTransport = (channelName = 'neo-anki-sync'): SyncTransport | null => {
  if (typeof BroadcastChannel === 'undefined') return null
  const channel = new BroadcastChannel(channelName)
  return {
    publish: (data) => channel.postMessage(data),
    subscribe: (listener) => {
      const handler = (event: MessageEvent<AppData>) => listener(event.data)
      channel.addEventListener('message', handler)
      return () => channel.removeEventListener('message', handler)
    },
    close: () => channel.close(),
  }
}
