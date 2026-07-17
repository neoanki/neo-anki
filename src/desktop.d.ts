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
    rendererReady(): void
    loadData(): NeoAnkiDesktopLoadResult
    saveData(changes: WorkspaceChangeSet): Promise<void>
    exportBackup(): Promise<{ canceled: boolean; path?: string }>
    restoreBackup(): Promise<{ canceled: boolean }>
    resetData(): Promise<void>
    createImportCheckpoint(): Promise<string>
    reportDiagnostic(diagnostic: { source: 'renderer' | 'extension-host'; level: 'info' | 'warning' | 'error'; code: string; message: string; stack?: string }): Promise<void>
    exportDiagnostics(): Promise<{ canceled: boolean; path?: string }>
    getReleaseInfo(): Promise<NeoAnkiReleaseInfo>
    listExtensions(): Promise<NeoAnkiInstalledExtension[]>
    chooseExtensionPackage(): Promise<{ canceled: boolean; candidate?: NeoAnkiExtensionCandidate }>
    installExtension(token: string): Promise<NeoAnkiInstalledExtension>
    discardExtension(token: string): Promise<void>
    setExtensionEnabled(id: string, enabled: boolean): Promise<void>
    uninstallExtension(id: string): Promise<void>
    reloadForExtensions(): Promise<void>
    onNavigate(callback: (destination: string) => void): () => void
  }

  interface Window {
    neoAnkiDesktop?: NeoAnkiDesktopBridge
  }

  interface NeoAnkiReleaseInfo {
    currentVersion: string
    channel: 'community' | 'development'
    automaticUpdates: false
    releasesUrl: string
  }
}

export {}
