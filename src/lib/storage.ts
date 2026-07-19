import type { AppData } from '../types'
import { createSeedData } from '../data/seed'
import { migrateWorkspaceData, parseWorkspaceData, type LegacyWorkspaceData } from './workspace-schema'
import { createWorkspaceChangeSet, hasWorkspaceChanges } from './workspace-changes'

const STORAGE_KEY = 'neo-anki:data:v1'

export interface StorageStatus {
  mode: 'desktop' | 'browser'
  path?: string
  recoveredFromBackup: boolean
  migratedLegacyData?: boolean
  loadError?: string
}

let storageStatus: StorageStatus = { mode: window.neoAnkiDesktop ? 'desktop' : 'browser', recoveredFromBackup: false }
let lastPersisted: AppData | null = null
let desktopSaveQueue: Promise<void> = Promise.resolve()

/** Adopt state returned by a desktop transaction that has already committed. */
export const adoptPersistedData = (data: AppData) => {
  parseWorkspaceData(data)
  lastPersisted = data
}

export const migrateData = migrateWorkspaceData

export const loadData = (): AppData => {
  if (window.neoAnkiDesktop) {
    const result = window.neoAnkiDesktop.loadData()
    storageStatus = {
      mode: 'desktop',
      path: result.storagePath,
      recoveredFromBackup: result.recoveredFromBackup,
      migratedLegacyData: result.migratedLegacyData,
      loadError: result.error,
    }
    if (!result.data) return createSeedData()
    try {
      const data = migrateData(result.data as LegacyWorkspaceData)
      lastPersisted = data
      return data
    } catch {
      storageStatus.loadError = 'The desktop data file could not be migrated. A fresh workspace was opened without overwriting it.'
      return createSeedData()
    }
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return createSeedData()
    return migrateData(JSON.parse(raw) as LegacyWorkspaceData)
  } catch {
    return createSeedData()
  }
}

export const getStorageStatus = () => storageStatus

export const saveData = async (data: AppData) => {
  if (window.neoAnkiDesktop) {
    const snapshot = structuredClone(parseWorkspaceData(data))
    const save = desktopSaveQueue.catch(() => undefined).then(async () => {
      const changes = createWorkspaceChangeSet(lastPersisted, snapshot)
      if (!hasWorkspaceChanges(changes)) return
      await window.neoAnkiDesktop!.saveData(changes)
      lastPersisted = snapshot
    })
    desktopSaveQueue = save
    return save
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

/** Wait for every accepted desktop mutation before an out-of-band v4 command. */
export const flushPendingSaves = () => desktopSaveQueue.catch(() => undefined)

export const downloadBackup = async (data: AppData) => {
  if (window.neoAnkiDesktop) return window.neoAnkiDesktop.exportBackup()
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
  await flushPendingSaves()
  if (window.neoAnkiDesktop) await window.neoAnkiDesktop.resetData()
  else localStorage.removeItem(STORAGE_KEY)
}

export const parseBackupText = (text: string): AppData => {
  const parsed = JSON.parse(text) as LegacyWorkspaceData
  if (!Array.isArray(parsed.items) || !Array.isArray(parsed.cards)) throw new Error('This is not a valid Neo Anki backup.')
  return migrateData(parsed)
}

export const parseBackup = async (file: File): Promise<AppData> => parseBackupText(await file.text())
