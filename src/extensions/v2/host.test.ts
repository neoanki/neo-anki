import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareExtensionHost } from '../host'
import { createExtensionHostV2 } from './host'

const bridge = () => ({
  claimExtensionCapability: vi.fn(async () => 'capability-token'),
  extensionApplyPatchV2: vi.fn(async () => ({ workspaceRevision: 3, data: { id: 'workspace' } })),
  extensionCreateMediaV2: vi.fn(async () => ({ id: 'media', sha256: 'a'.repeat(64), byteLength: 2, workspaceRevision: 4 })),
  extensionNetworkFetch: vi.fn(async () => ({ status: 200, headers: { test: 'yes' }, bodyBase64: btoa('\u0001\u0002') })),
  extensionCancelV2: vi.fn(async () => undefined),
  extensionSecretReadBatchV2: vi.fn(async () => ({ key: 'value' })),
  extensionSecretMutateBatchV2: vi.fn(async () => undefined),
  extensionConfigReadV2: vi.fn(async () => ({ enabled: true })),
  extensionConfigWriteV2: vi.fn(async () => ({ workspaceRevision: 5, data: { id: 'configured' } })),
  extensionContentListNotesV2: vi.fn(async () => ({ workspaceRevision: 5, notes: [], availableMediaIds: [] })),
  extensionMigrationExportV2: vi.fn(async () => ({ document: {}, media: [] })),
  extensionMigrationCommitV2: vi.fn(async () => ({ workspaceRevision: 6, data: { id: 'migrated' } })),
})
const patch = { version: 2 as const, idempotencyKey: 'host-test', owner: { type: 'extension' as const, extensionId: 'org.neoanki.host-test', scopes: ['records'] }, expectedWorkspaceRevision: 1, operations: [] }

describe('SDK v2 desktop host', () => {
  beforeEach(() => { delete window.neoAnkiDesktop })

  it('rejects every capability outside the desktop host', async () => {
    const host = createExtensionHostV2('org.neoanki.unavailable')
    await expect(host.applyPatch(patch)).rejects.toThrow(/desktop app/)
    await expect(host.config.read()).rejects.toThrow(/desktop app/)
    await expect(host.migration.exportWorkspace()).rejects.toThrow(/desktop app/)
  })

  it('forwards binary and state-changing calls through one claimed capability', async () => {
    const desktop = bridge()
    window.neoAnkiDesktop = desktop as never
    await prepareExtensionHost('org.neoanki.host-test')
    const host = createExtensionHostV2('org.neoanki.host-test')
    const updates: unknown[] = []
    window.addEventListener('neo-anki:workspace-updated-v4', (event) => updates.push((event as CustomEvent).detail))

    await expect(host.applyPatch({ ...patch, expectedWorkspaceRevision: 2 })).resolves.toEqual({ workspaceRevision: 3 })
    await expect(host.fetch({ operationId: 'network', url: 'https://example.com', body: new Uint8Array([3, 4]) })).resolves.toEqual({ status: 200, headers: { test: 'yes' }, body: new Uint8Array([1, 2]) })
    await expect(host.config.write({ enabled: false })).resolves.toEqual({ workspaceRevision: 5 })
    await expect(host.migration.commit({ document: {}, media: [], operation: 'additive' })).resolves.toEqual({ workspaceRevision: 6 })
    expect(desktop.extensionNetworkFetch).toHaveBeenCalledWith('capability-token', expect.objectContaining({ bodyBase64: 'AwQ=' }))
    expect(updates).toEqual([{ id: 'workspace' }, { id: 'configured' }, { id: 'migrated' }])
  })
})
