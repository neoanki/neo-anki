import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExtensionPackageManifest } from '../extensions/sdk'
import { ExtensionManagerPanel } from './ExtensionManagerPanel'

const manifest: ExtensionPackageManifest = {
  format: 'neo-anki-extension',
  schemaVersion: 1,
  id: 'com.example.fixture',
  name: 'Fixture Extension',
  version: '1.0.0',
  sdkVersion: 1,
  publisher: 'Example Publisher',
  description: 'A fixture extension.',
  permissions: ['ui:pages'],
  entry: 'dist/index.js',
}

afterEach(() => { window.neoAnkiDesktop = undefined })

describe('extension manager', () => {
  it('reviews permissions and trust before installing a local package', async () => {
    const installExtension = vi.fn(async () => ({ manifest, enabled: true, directory: 'fixture', digest: 'a'.repeat(64), installedAt: '', updatedAt: '', entryUrl: '' }))
    window.neoAnkiDesktop = {
      isDesktop: true,
      loadData: () => ({ data: null, storagePath: '', recoveredFromBackup: false }),
      saveData: async () => undefined,
      exportBackup: async () => ({ canceled: true }),
      restoreBackup: async () => ({ canceled: true }),
      resetData: async () => undefined,
      reportDiagnostic: async () => undefined,
      exportDiagnostics: async () => ({ canceled: true }),
      getUpdateState: async () => ({ phase: 'development', currentVersion: '0.1.0' }),
      checkForUpdates: async () => ({ phase: 'development', currentVersion: '0.1.0' }),
      downloadUpdate: async () => ({ phase: 'development', currentVersion: '0.1.0' }),
      installUpdate: async () => undefined,
      listExtensions: async () => [],
      chooseExtensionPackage: async () => ({ canceled: false, candidate: { token: 'review-token', manifest, digest: 'a'.repeat(64), compressedBytes: 2048, unpackedBytes: 4096, isDowngrade: false, addedPermissions: ['ui:pages'] } }),
      installExtension,
      discardExtension: async () => undefined,
      setExtensionEnabled: async () => undefined,
      uninstallExtension: async () => undefined,
      reloadForExtensions: async () => undefined,
      onNavigate: () => () => undefined,
      onUpdateState: () => () => undefined,
    }

    render(<ExtensionManagerPanel />)
    await userEvent.click(screen.getByRole('button', { name: /install from file/i }))
    const heading = await screen.findByRole('heading', { name: 'Fixture Extension' })
    expect(heading).toBeVisible()
    const review = heading.closest('section')!
    expect(within(review).getByText('Add application pages')).toBeVisible()
    expect(within(review).getByText(/not a security sandbox/i)).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Install extension' }))
    expect(installExtension).toHaveBeenCalledWith('review-token')
    expect(await screen.findByText(/reload to activate it/i)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Reload now' })).toBeVisible()
  })
})
