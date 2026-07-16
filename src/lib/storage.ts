import type { AppData, KnowledgeItem, PracticeCard } from '../types'
import { createSeedData } from '../data/seed'

const STORAGE_KEY = 'neo-anki:data:v1'

export interface StorageStatus {
  mode: 'desktop' | 'browser'
  path?: string
  recoveredFromBackup: boolean
  loadError?: string
}

let storageStatus: StorageStatus = { mode: window.neoAnkiDesktop ? 'desktop' : 'browser', recoveredFromBackup: false }

type LegacyAppData = Partial<AppData> & {
  version?: number
  items?: Array<Partial<KnowledgeItem> & Pick<KnowledgeItem, 'id' | 'prompt' | 'answer' | 'collection' | 'createdAt' | 'updatedAt'>>
  cards?: Array<Partial<PracticeCard> & Pick<PracticeCard, 'id' | 'itemId' | 'variant' | 'suspended' | 'fsrs' | 'estimatedSeconds'>>
}

const timestamp = () => new Date().toISOString()

export const migrateData = (input: LegacyAppData): AppData => {
  const now = timestamp()
  const fallback = createSeedData()
  const items = (input.items || []).map((item) => ({
    id: item.id,
    prompt: item.prompt,
    answer: item.answer,
    context: item.context || '',
    collection: item.collection,
    tags: item.tags || [],
    source: item.source,
    citations: item.citations || (item.source ? [{ id: crypto.randomUUID(), title: item.source, url: item.source }] : []),
    mediaIds: item.mediaIds || [],
    occlusions: item.occlusions || [],
    provenance: item.provenance,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }))
  const cards = (input.cards || []).map((card) => ({
    id: card.id,
    itemId: card.itemId,
    variant: card.variant,
    occlusionId: card.occlusionId,
    suspended: card.suspended,
    fsrs: card.fsrs,
    estimatedSeconds: card.estimatedSeconds,
    createdAt: card.createdAt || now,
    updatedAt: card.updatedAt || card.fsrs.last_review || now,
  }))

  return {
    version: 2,
    deviceId: input.deviceId || crypto.randomUUID(),
    items,
    cards,
    reviews: input.reviews || [],
    assets: input.assets || [],
    goals: input.goals || [],
    views: input.views || [],
    packs: input.packs || [],
    packConflicts: input.packConflicts || [],
    settings: {
      dailyMinutes: input.settings?.dailyMinutes ?? fallback.settings.dailyMinutes,
      retention: input.settings?.retention ?? fallback.settings.retention,
      theme: input.settings?.theme ?? fallback.settings.theme,
      onboardingComplete: input.settings?.onboardingComplete ?? false,
      recoveryStrategy: input.settings?.recoveryStrategy ?? 'risk',
    },
    updatedAt: input.updatedAt || now,
  }
}

export const loadData = (): AppData => {
  if (window.neoAnkiDesktop) {
    const result = window.neoAnkiDesktop.loadData()
    storageStatus = {
      mode: 'desktop',
      path: result.storagePath,
      recoveredFromBackup: result.recoveredFromBackup,
      loadError: result.error,
    }
    if (!result.data) return createSeedData()
    try {
      return migrateData(result.data as LegacyAppData)
    } catch {
      storageStatus.loadError = 'The desktop data file could not be migrated. A fresh workspace was opened without overwriting it.'
      return createSeedData()
    }
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return createSeedData()
    return migrateData(JSON.parse(raw) as LegacyAppData)
  } catch {
    return createSeedData()
  }
}

export const getStorageStatus = () => storageStatus

export const saveData = async (data: AppData) => {
  if (window.neoAnkiDesktop) {
    await window.neoAnkiDesktop.saveData(data)
    return
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

export const downloadBackup = async (data: AppData) => {
  if (window.neoAnkiDesktop) return window.neoAnkiDesktop.exportBackup(data)
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `neo-anki-${new Date().toISOString().slice(0, 10)}.json`
  anchor.click()
  URL.revokeObjectURL(url)
  return { canceled: false }
}

export const clearStoredData = async () => {
  if (window.neoAnkiDesktop) await window.neoAnkiDesktop.resetData()
  else localStorage.removeItem(STORAGE_KEY)
}

export const parseBackupText = (text: string): AppData => {
  const parsed = JSON.parse(text) as LegacyAppData
  if (!Array.isArray(parsed.items) || !Array.isArray(parsed.cards)) throw new Error('This is not a valid Neo Anki backup.')
  return migrateData(parsed)
}

export const parseBackup = async (file: File): Promise<AppData> => parseBackupText(await file.text())
