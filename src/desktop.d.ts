import type { ExtensionManifestV2 as ExtensionPackageManifest, ExtensionPermissionV2 as AnyExtensionPermission, ExtensionContentPageDto, ExtensionContentQuery, MediaCreateRequest } from '../packages/extension-sdk/src/index'
import type { WorkspaceChangeSet } from './lib/workspace-changes'
import type { AppData, MediaAsset } from './types'
import type { WorkspaceDocumentV4, WorkspacePatchV2 } from '../packages/compatibility-domain/src/index'
import type { SyncFieldConflict } from '../packages/sync-protocol/src/index'
import type { MarketplaceExtension } from '@neo-anki/extension-marketplace'

declare global {
  interface ExtensionNetworkBridgeRequest { operationId?: string; url: string; method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; headers?: Record<string, string>; bodyBase64?: string; timeoutMs?: number; maximumResponseBytes?: number }
  interface ExtensionNetworkBridgeResponse { status: number; statusText: string; headers: Record<string, string>; bodyBase64: string }
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
    workerEntryUrl?: string
    uiEntryUrls?: Array<{ id: string; surface: 'settings' | 'review' | 'page'; url: string }>
  }

  interface NeoAnkiExtensionCandidate {
    token: string
    manifest: ExtensionPackageManifest
    digest: string
    compressedBytes: number
    unpackedBytes: number
    currentVersion?: string
    isDowngrade: boolean
    addedPermissions: AnyExtensionPermission[]
  }

  interface NeoAnkiDesktopBridge {
    isDesktop: true
    rendererReady(): void
    loadData(): NeoAnkiDesktopLoadResult
    saveData(changes: WorkspaceChangeSet): Promise<void>
    exportBackup(): Promise<{ canceled: boolean; path?: string }>
    restoreBackup(): Promise<{ canceled: boolean }>
    resetData(): Promise<void>
    createImportCheckpoint(): Promise<string | null>
    listMigrationRecoveryFiles?(): Promise<Array<{ kind: 'source-package' | 'workspace-checkpoint'; name: string; byteLength: number; createdAt: string }>>
    removeMigrationRecoveryFile?(kind: 'source-package' | 'workspace-checkpoint', name: string): Promise<void>
    commitWorkspaceV4Import(input: { document: unknown; media: MediaAsset[]; sourceArchive?: Uint8Array; operation: 'additive' | 'replace-profile' }): Promise<AppData>
    loadWorkspaceV4ExportPayload(): Promise<{ document: unknown; media: MediaAsset[] }>
    loadWorkspaceV4Document(): Promise<WorkspaceDocumentV4>
    applyCoreWorkspacePatchV2(patch: WorkspacePatchV2): Promise<{ workspaceRevision: number; data: AppData }>
    reportDiagnostic(diagnostic: { source: 'renderer' | 'extension-host'; level: 'info' | 'warning' | 'error'; code: string; message: string; stack?: string }): Promise<void>
    exportDiagnostics(): Promise<{ canceled: boolean; path?: string }>
    getReleaseInfo(): Promise<NeoAnkiReleaseInfo>
    listExtensions(): Promise<NeoAnkiInstalledExtension[]>
    listMarketplaceExtensions(): Promise<MarketplaceExtension[]>
    stageMarketplaceExtension(id: string, version: string): Promise<NeoAnkiExtensionCandidate>
    chooseExtensionPackage(): Promise<{ canceled: boolean; candidate?: NeoAnkiExtensionCandidate }>
    installExtension(token: string): Promise<NeoAnkiInstalledExtension>
    discardExtension(token: string): Promise<void>
    setExtensionEnabled(id: string, enabled: boolean): Promise<void>
    uninstallExtension(id: string, deleteSecrets: boolean): Promise<void>
    reloadForExtensions(): Promise<void>
    claimExtensionCapability(id: string): Promise<string>
    extensionNetworkFetch(token: string, request: ExtensionNetworkBridgeRequest): Promise<ExtensionNetworkBridgeResponse>
    extensionApplyPatchV2(token: string, patch: WorkspacePatchV2): Promise<{ workspaceRevision: number; data: AppData }>
    extensionCreateMediaV2(token: string, request: MediaCreateRequest): Promise<{ id: string; sha256: string; byteLength: number; workspaceRevision: number }>
    extensionSecretReadBatchV2(token: string, keys: string[]): Promise<Record<string, string | null>>
    extensionSecretMutateBatchV2(token: string, changes: Array<{ op: 'set'; key: string; value: string } | { op: 'delete'; key: string }>): Promise<void>
    extensionConfigReadV2(token: string): Promise<unknown | null>
    extensionConfigWriteV2(token: string, value: unknown): Promise<{ workspaceRevision: number; data: AppData }>
    extensionContentListNotesV2(token: string, query: ExtensionContentQuery): Promise<ExtensionContentPageDto>
    extensionCancelV2(token: string, operationId: string): Promise<void>
    syncStatus(): Promise<NeoAnkiSyncStatus>
    syncListDevices(): Promise<NeoAnkiSyncDevice[]>
    syncCreateAccount(endpoint: string): Promise<{ recoveryBundle: string; status: NeoAnkiSyncStatus }>
    syncRecoverAccount(recoveryBundle: string): Promise<{ data: AppData; status: NeoAnkiSyncStatus }>
    syncNow(): Promise<{ data: AppData | null; status: NeoAnkiSyncStatus; sent: number; received: number }>
    syncResolveConflict(conflictId: string, choice: 'existing' | 'incoming'): Promise<{ data: AppData; status: NeoAnkiSyncStatus; sent: number; received: number }>
    syncRotateRecovery(): Promise<string>
    syncRevokeDevice(actorId: string): Promise<void>
    syncDisconnect(): Promise<void>
    syncDeleteAccount(): Promise<void>
    onNavigate(callback: (destination: string) => void): () => void
  }

  interface Window {
    neoAnkiDesktop?: NeoAnkiDesktopBridge
  }

  interface NeoAnkiReleaseInfo {
    currentVersion: string
    automaticUpdates: false
    releasesUrl: string
  }

  interface NeoAnkiSyncStatus {
    configured: boolean
    endpoint?: string
    accountId?: string
    workspaceId?: string
    actorId?: string
    pendingOperations: number
    conflicts: SyncFieldConflict[]
    pendingCommit?: boolean
    lastSuccessAt?: string
    lastError?: string
  }

  interface NeoAnkiSyncDevice { actorId: string; createdAt: string; revokedAt?: string; current: boolean }
}

export {}
