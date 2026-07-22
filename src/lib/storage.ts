import type { AppData } from '../types'
import { createEmptyWorkspaceData } from '../data/seed'
import { migrateWorkspaceData, parseWorkspaceData, type LegacyWorkspaceData } from './workspace-schema'
import { createWorkspaceChangeSet, hasWorkspaceChanges } from './workspace-changes'

const STORAGE_KEY = 'neo-anki:data:v1'

export interface WorkspaceLoadFailure {
  code: 'read' | 'parse' | 'migration'
  message: string
  mode: 'desktop' | 'browser'
  sourcePath?: string
  canExportOriginal: boolean
}

export type WorkspaceLoadResult =
  | { ok: true; data: AppData }
  | { ok: false; failure: WorkspaceLoadFailure }

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
let persistenceBlocked = false
let browserRecoverySource: string | null = null

/** Adopt state returned by a desktop transaction that has already committed. */
export const adoptPersistedData = (data: AppData) => {
  parseWorkspaceData(data)
  lastPersisted = data
}

/** Adopt a value returned by a validated, committed desktop transaction. */
export const adoptTrustedDesktopData = (data: AppData) => { lastPersisted = data }

export const migrateData = migrateWorkspaceData

const adoptDesktopLoad = (result: NeoAnkiDesktopLoadResult): WorkspaceLoadResult => {
    storageStatus = {
      mode: 'desktop',
      path: result.storagePath,
      recoveredFromBackup: result.recoveredFromBackup,
      migratedLegacyData: result.migratedLegacyData,
      loadError: result.error,
    }
    if (!result.data && result.error) {
      persistenceBlocked = true
      return { ok: false, failure: { code: 'read', message: result.error, mode: 'desktop', sourcePath: result.recoverySourcePath, canExportOriginal: Boolean(result.recoverySourcePath) } }
    }
    if (!result.data) {
      const data = createEmptyWorkspaceData()
      persistenceBlocked = false
      lastPersisted = null
      return { ok: true, data }
    }
    try {
      const data = migrateData(result.data as LegacyWorkspaceData)
      lastPersisted = data
      persistenceBlocked = false
      return { ok: true, data }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The desktop workspace could not be migrated.'
      storageStatus.loadError = message
      persistenceBlocked = true
      return { ok: false, failure: { code: 'migration', message, mode: 'desktop', sourcePath: result.recoverySourcePath || result.storagePath, canExportOriginal: true } }
    }
}

export const loadWorkspaceData = (): WorkspaceLoadResult => {
  if (window.neoAnkiDesktop) {
    return adoptDesktopLoad(window.neoAnkiDesktop.loadData())
  }
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    storageStatus = { mode: 'browser', recoveredFromBackup: false }
    browserRecoverySource = null
    persistenceBlocked = false
    lastPersisted = null
    return { ok: true, data: createEmptyWorkspaceData() }
  }
  try {
    const parsed = JSON.parse(raw) as LegacyWorkspaceData
    try {
      const data = migrateData(parsed)
      browserRecoverySource = null
      persistenceBlocked = false
      lastPersisted = data
      storageStatus = { mode: 'browser', recoveredFromBackup: false }
      return { ok: true, data }
    } catch (error) {
      browserRecoverySource = raw
      persistenceBlocked = true
      const message = error instanceof Error ? error.message : 'The browser workspace could not be migrated.'
      storageStatus = { mode: 'browser', recoveredFromBackup: false, loadError: message }
      return { ok: false, failure: { code: 'migration', message, mode: 'browser', canExportOriginal: true } }
    }
  } catch (error) {
    browserRecoverySource = raw
    persistenceBlocked = true
    const message = error instanceof Error ? error.message : 'The browser workspace is not valid JSON.'
    storageStatus = { mode: 'browser', recoveredFromBackup: false, loadError: message }
    return { ok: false, failure: { code: 'parse', message, mode: 'browser', canExportOriginal: true } }
  }
}

export const reloadWorkspaceData = async (): Promise<WorkspaceLoadResult> => {
  const bridge = window.neoAnkiDesktop
  return bridge?.loadDataAsync ? adoptDesktopLoad(await bridge.loadDataAsync()) : loadWorkspaceData()
}

export const loadData = (): AppData => {
  const result = loadWorkspaceData()
  if (!result.ok) throw new Error(result.failure.message)
  return result.data
}

export const getStorageStatus = () => storageStatus

export const saveData = async (data: AppData) => {
  if (persistenceBlocked) throw new Error('Saving is blocked until workspace recovery is complete.')
  if (window.neoAnkiDesktop) {
    if (data === lastPersisted) return
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

export const unlockPersistence = (data?: AppData) => {
  if (data) parseWorkspaceData(data)
  persistenceBlocked = false
  browserRecoverySource = null
  storageStatus = { ...storageStatus, loadError: undefined }
}

export const exportRecoverySource = async () => {
  if (window.neoAnkiDesktop) {
    if (!window.neoAnkiDesktop.exportRecoverySource) throw new Error('This Neo Anki build cannot export the preserved recovery source.')
    return window.neoAnkiDesktop.exportRecoverySource()
  }
  if (browserRecoverySource == null) throw new Error('The original browser workspace is no longer available to export.')
  const blob = new Blob([browserRecoverySource], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `neo-anki-recovery-${new Date().toISOString().slice(0, 10)}.json`
  anchor.click()
  URL.revokeObjectURL(url)
  return { canceled: false }
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
  lastPersisted = null
  persistenceBlocked = false
  browserRecoverySource = null
}

export const parseBackupText = (text: string): AppData => {
  const parsed = JSON.parse(text) as LegacyWorkspaceData
  if (!Array.isArray(parsed.items) || !Array.isArray(parsed.cards)) throw new Error('This is not a valid Neo Anki backup.')
  return migrateData(parsed)
}

export const parseBackup = async (file: File): Promise<AppData> => parseBackupText(await file.text())
