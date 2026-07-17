import type { ExtensionPackageManifest, ExtensionPermission } from './extensions/sdk'
import type { WorkspaceChangeSet } from './lib/workspace-changes'

declare global {
  interface NeoAnkiDesktopLoadResult {
    data: unknown | null
    storagePath: string
    recoveredFromBackup: boolean
    migratedLegacyData?: boolean
    error?: string
  }

  interface NeoAnkiInstalledExtension {
    manifest: ExtensionPackageManifest
    enabled: boolean
    directory: string
    digest: string
    installedAt: string
    updatedAt: string
    entryUrl: string
  }

  interface NeoAnkiExtensionCandidate {
    token: string
    manifest: ExtensionPackageManifest
    digest: string
    compressedBytes: number
    unpackedBytes: number
    currentVersion?: string
    isDowngrade: boolean
    addedPermissions: ExtensionPermission[]
  }

  interface NeoAnkiDesktopBridge {
    isDesktop: true
    loadData(): NeoAnkiDesktopLoadResult
    saveData(changes: WorkspaceChangeSet): Promise<void>
    exportBackup(): Promise<{ canceled: boolean; path?: string }>
    restoreBackup(): Promise<{ canceled: boolean }>
    resetData(): Promise<void>
    reportDiagnostic(diagnostic: { source: 'renderer' | 'extension-host'; level: 'info' | 'warning' | 'error'; code: string; message: string; stack?: string }): Promise<void>
    exportDiagnostics(): Promise<{ canceled: boolean; path?: string }>
    getUpdateState(): Promise<NeoAnkiUpdateState>
    checkForUpdates(): Promise<NeoAnkiUpdateState>
    downloadUpdate(): Promise<NeoAnkiUpdateState>
    installUpdate(): Promise<void>
    listExtensions(): Promise<NeoAnkiInstalledExtension[]>
    chooseExtensionPackage(): Promise<{ canceled: boolean; candidate?: NeoAnkiExtensionCandidate }>
    installExtension(token: string): Promise<NeoAnkiInstalledExtension>
    discardExtension(token: string): Promise<void>
    setExtensionEnabled(id: string, enabled: boolean): Promise<void>
    uninstallExtension(id: string): Promise<void>
    reloadForExtensions(): Promise<void>
    onNavigate(callback: (destination: string) => void): () => void
    onUpdateState(callback: (state: NeoAnkiUpdateState) => void): () => void
  }

  interface Window {
    neoAnkiDesktop?: NeoAnkiDesktopBridge
  }

  interface NeoAnkiUpdateState {
    phase: 'development' | 'idle' | 'checking' | 'available' | 'current' | 'downloading' | 'ready' | 'error'
    currentVersion: string
    version?: string
    percent?: number
    error?: string
  }
}

export {}
