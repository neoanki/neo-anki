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
    parseWorkspaceData(data)
    const changes = createWorkspaceChangeSet(lastPersisted, data)
    if (!hasWorkspaceChanges(changes)) return
    await window.neoAnkiDesktop.saveData(changes)
    lastPersisted = data
    return
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

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
  if (window.neoAnkiDesktop) await window.neoAnkiDesktop.resetData()
  else localStorage.removeItem(STORAGE_KEY)
}

export const parseBackupText = (text: string): AppData => {
  const parsed = JSON.parse(text) as LegacyWorkspaceData
  if (!Array.isArray(parsed.items) || !Array.isArray(parsed.cards)) throw new Error('This is not a valid Neo Anki backup.')
  return migrateData(parsed)
}

export const parseBackup = async (file: File): Promise<AppData> => parseBackupText(await file.text())
