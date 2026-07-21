import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExtensionPackageManifest } from '../../packages/extension-sdk/src/index'
import { createSeedData } from '../data/seed'
import { ExtensionManagerPanel } from './ExtensionManagerPanel'

const manifest: ExtensionPackageManifest = {
  format: 'neo-anki-extension',
  schemaVersion: 2,
  id: 'com.example.fixture',
  name: 'Fixture Extension',
  version: '2.0.0',
  sdkVersion: 2,
  publisher: 'Example Publisher',
  description: 'A fixture extension.',
  publisherKey: 'ed25519:fixture',
  permissions: ['ui:page'],
  workerEntry: 'dist/worker.js',
  uiEntries: [{ id: 'page', surface: 'page', entry: 'dist/page.js' }],
  provenance: { sourceCommit: 'a'.repeat(40), buildSystem: 'fixture' },
}

afterEach(() => { window.neoAnkiDesktop = undefined; window.sessionStorage.clear() })

describe('extension manager', () => {
  it('reviews a local package, installs it, and reloads automatically', async () => {
    const installExtension = vi.fn(async () => ({ manifest, enabled: true, directory: 'fixture', digest: 'a'.repeat(64), installedAt: '', updatedAt: '' }))
    const reloadForExtensions = vi.fn(async () => undefined)
    window.neoAnkiDesktop = {
      isDesktop: true,
      rendererReady: () => undefined,
      loadData: () => ({ data: null, storagePath: '', recoveredFromBackup: false }),
      saveData: async () => undefined,
      exportBackup: async () => ({ canceled: true }),
      restoreBackup: async () => ({ canceled: true }),
      resetData: async () => undefined,
      createImportCheckpoint: async () => '',
      commitWorkspaceV4Import: async () => createSeedData(),
      loadWorkspaceV4ExportPayload: async () => ({ document: {}, media: [] }),
      loadWorkspaceV4Document: async () => ({} as never), applyCoreWorkspacePatchV2: async () => ({ workspaceRevision: 1, data: createSeedData() }),
      extensionApplyPatchV2: async () => ({ workspaceRevision: 1, data: createSeedData() }), extensionCreateMediaV2: async () => ({ id: 'media', sha256: 'a'.repeat(64), byteLength: 1, workspaceRevision: 1 }), extensionSecretReadBatchV2: async () => ({}), extensionSecretMutateBatchV2: async () => undefined, extensionConfigReadV2: async () => null, extensionConfigWriteV2: async () => ({ workspaceRevision: 1, data: createSeedData() }), extensionContentListNotesV2: async () => ({ workspaceRevision: 1, notes: [], availableMediaIds: [] }), extensionMigrationExportV2: async () => ({ document: {}, media: [] }), extensionMigrationCommitV2: async () => ({ workspaceRevision: 1, data: createSeedData() }), extensionCancelV2: async () => undefined,
      reportDiagnostic: async () => undefined,
      exportDiagnostics: async () => ({ canceled: true }),
      getReleaseInfo: async () => ({ currentVersion: '0.1.0', automaticUpdates: false, releasesUrl: 'https://github.com/neoanki/neo-anki/releases' }),
      listExtensions: async () => [],
      listMarketplaceExtensions: async () => [],
      stageMarketplaceExtension: async () => { throw new Error('not used') },
      chooseExtensionPackage: async () => ({ canceled: false, candidate: { token: 'review-token', manifest, digest: 'a'.repeat(64), compressedBytes: 2048, unpackedBytes: 4096, isDowngrade: false, addedPermissions: ['ui:page'] } }),
      installExtension,
      discardExtension: async () => undefined,
      setExtensionEnabled: async () => undefined,
      uninstallExtension: async () => undefined,
      reloadForExtensions,
      claimExtensionCapability: async () => 'token',
      extensionNetworkFetch: async () => ({ status: 200, statusText: 'OK', headers: {}, bodyBase64: '' }),
      syncStatus: async () => ({ configured: false, pendingOperations: 0, conflicts: [] }),
      syncListDevices: async () => [],
      syncCreateAccount: async () => ({ recoveryBundle: '', status: { configured: false, pendingOperations: 0, conflicts: [] } }),
      syncRecoverAccount: async () => ({ data: createSeedData(), status: { configured: false, pendingOperations: 0, conflicts: [] } }),
      syncNow: async () => ({ data: null, status: { configured: false, pendingOperations: 0, conflicts: [] }, sent: 0, received: 0 }),
      syncResolveConflict: async () => ({ data: createSeedData(), status: { configured: false, pendingOperations: 0, conflicts: [] }, sent: 0, received: 0 }),
      syncRotateRecovery: async () => '',
      syncRevokeDevice: async () => undefined,
      syncDisconnect: async () => undefined,
      syncDeleteAccount: async () => undefined,
      onNavigate: () => () => undefined,
    }

    render(<ExtensionManagerPanel />)
    await userEvent.click(screen.getByRole('button', { name: /install from file/i }))
    const heading = await screen.findByRole('heading', { name: 'Fixture Extension' })
    expect(heading).toBeVisible()
    const review = heading.closest('section')!
    expect(within(review).getByText('Add an isolated application page')).toBeVisible()
    expect(within(review).getByText(/valid signature proves package integrity/i)).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Install extension' }))
    expect(installExtension).toHaveBeenCalledWith('review-token')
    expect(reloadForExtensions).toHaveBeenCalledOnce()
    expect(window.sessionStorage.getItem('neo-anki:extensions-hub:v1')).toContain('Fixture Extension installed and ready.')
  })

  it('shows every declared network destination during install review', async () => {
    const networkManifest: ExtensionPackageManifest = { ...manifest, permissions: ['network:fetch'], networkDomains: ['api.example.com'], name: 'Network Fixture' }
    window.neoAnkiDesktop = {
      isDesktop: true, rendererReady: () => undefined, loadData: () => ({ data: null, storagePath: '', recoveredFromBackup: false }), saveData: async () => undefined,
      exportBackup: async () => ({ canceled: true }), restoreBackup: async () => ({ canceled: true }), resetData: async () => undefined, createImportCheckpoint: async () => '', commitWorkspaceV4Import: async () => createSeedData(), loadWorkspaceV4ExportPayload: async () => ({ document: {}, media: [] }), loadWorkspaceV4Document: async () => ({} as never), applyCoreWorkspacePatchV2: async () => ({ workspaceRevision: 1, data: createSeedData() }), extensionApplyPatchV2: async () => ({ workspaceRevision: 1, data: createSeedData() }), extensionCreateMediaV2: async () => ({ id: 'media', sha256: 'a'.repeat(64), byteLength: 1, workspaceRevision: 1 }), extensionSecretReadBatchV2: async () => ({}), extensionSecretMutateBatchV2: async () => undefined, extensionConfigReadV2: async () => null, extensionConfigWriteV2: async () => ({ workspaceRevision: 1, data: createSeedData() }), extensionContentListNotesV2: async () => ({ workspaceRevision: 1, notes: [], availableMediaIds: [] }), extensionMigrationExportV2: async () => ({ document: {}, media: [] }), extensionMigrationCommitV2: async () => ({ workspaceRevision: 1, data: createSeedData() }), extensionCancelV2: async () => undefined, reportDiagnostic: async () => undefined,
      exportDiagnostics: async () => ({ canceled: true }), getReleaseInfo: async () => ({ currentVersion: '0.1.0', automaticUpdates: false, releasesUrl: '' }), listExtensions: async () => [], listMarketplaceExtensions: async () => [], stageMarketplaceExtension: async () => { throw new Error('not used') },
      chooseExtensionPackage: async () => ({ canceled: false, candidate: { token: 'network', manifest: networkManifest, digest: 'b'.repeat(64), compressedBytes: 100, unpackedBytes: 200, isDowngrade: false, addedPermissions: ['network:fetch'] } }),
      installExtension: async () => { throw new Error('not used') }, discardExtension: async () => undefined, setExtensionEnabled: async () => undefined, uninstallExtension: async () => undefined, reloadForExtensions: async () => undefined,
      claimExtensionCapability: async () => 'token', extensionNetworkFetch: async () => ({ status: 200, statusText: 'OK', headers: {}, bodyBase64: '' }), onNavigate: () => () => undefined,
      syncStatus: async () => ({ configured: false, pendingOperations: 0, conflicts: [] }), syncListDevices: async () => [], syncCreateAccount: async () => ({ recoveryBundle: '', status: { configured: false, pendingOperations: 0, conflicts: [] } }), syncRecoverAccount: async () => ({ data: createSeedData(), status: { configured: false, pendingOperations: 0, conflicts: [] } }), syncNow: async () => ({ data: null, status: { configured: false, pendingOperations: 0, conflicts: [] }, sent: 0, received: 0 }), syncResolveConflict: async () => ({ data: createSeedData(), status: { configured: false, pendingOperations: 0, conflicts: [] }, sent: 0, received: 0 }), syncRotateRecovery: async () => '', syncRevokeDevice: async () => undefined, syncDisconnect: async () => undefined, syncDeleteAccount: async () => undefined,
    }
    render(<ExtensionManagerPanel />)
    await userEvent.click(screen.getByRole('button', { name: /install from file/i }))
    expect(await screen.findByText('HTTPS · api.example.com')).toBeVisible()
  })
})
