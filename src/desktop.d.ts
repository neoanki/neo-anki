import type { ExtensionPackageManifest, ExtensionPermission } from './extensions/sdk'

declare global {
  interface NeoAnkiDesktopLoadResult {
    data: unknown | null
    storagePath: string
    recoveredFromBackup: boolean
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
    saveData(data: unknown): Promise<void>
    exportBackup(data: unknown): Promise<{ canceled: boolean; path?: string }>
    resetData(): Promise<void>
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
}

export {}
