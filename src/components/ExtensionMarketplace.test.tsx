import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MarketplaceExtension } from '@neo-anki/extension-marketplace'
import type { ExtensionPackageManifest } from '../../packages/extension-sdk/src/index'
import { ExtensionMarketplace } from './ExtensionMarketplace'

const listing: MarketplaceExtension = {
  id: 'com.example.fixture',
  name: 'Fixture Extension',
  summary: 'A marketplace fixture.',
  description: 'A marketplace extension used to verify one-click installation.',
  publisher: { name: 'Example Publisher', url: 'https://example.com' },
  repository: 'https://github.com/example/fixture',
  license: 'MIT',
  categories: ['study'],
  tags: ['fixture'],
  release: {
    version: '2.0.0',
    publishedAt: '2026-07-21T10:00:00Z',
    packageUrl: 'https://github.com/example/fixture/releases/download/v2.0.0/com.example.fixture-2.0.0.neoanki-extension',
    sha256: 'a'.repeat(64),
    publisherKey: 'ed25519:fixture',
    minimumNeoAnkiVersion: '0.4.0',
    permissions: ['ui:page'],
  },
}

const manifest: ExtensionPackageManifest = {
  format: 'neo-anki-extension', schemaVersion: 2, id: listing.id, name: listing.name, version: listing.release.version, sdkVersion: 2,
  publisher: listing.publisher.name, description: listing.description, publisherKey: listing.release.publisherKey, permissions: ['ui:page'],
  workerEntry: 'dist/worker.js', uiEntries: [{ id: 'page', surface: 'page', entry: 'dist/page.js' }], provenance: { sourceCommit: 'a'.repeat(40), buildSystem: 'fixture' },
}

afterEach(() => { window.neoAnkiDesktop = undefined; window.sessionStorage.clear() })

describe('extension marketplace', () => {
  it('installs immediately from details and reloads with marketplace state saved', async () => {
    const stageMarketplaceExtension = vi.fn(async () => ({ token: 'marketplace-token', manifest, digest: 'a'.repeat(64), compressedBytes: 100, unpackedBytes: 200, isDowngrade: false, addedPermissions: ['ui:page'] as const }))
    const installExtension = vi.fn(async () => ({ manifest, enabled: true, directory: 'fixture', digest: 'a'.repeat(64), installedAt: '', updatedAt: '' }))
    const reloadForExtensions = vi.fn(async () => undefined)
    window.neoAnkiDesktop = {
      isDesktop: true,
      listMarketplaceExtensions: async () => [listing],
      stageMarketplaceExtension,
      installExtension,
      discardExtension: async () => undefined,
      reloadForExtensions,
    } as unknown as NeoAnkiDesktopBridge

    render(<ExtensionMarketplace installed={[]} candidateActive={false}/>)
    await userEvent.click(await screen.findByRole('button', { name: /view details/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Install' }))

    expect(stageMarketplaceExtension).toHaveBeenCalledWith(listing.id, listing.release.version)
    expect(installExtension).toHaveBeenCalledWith('marketplace-token')
    expect(reloadForExtensions).toHaveBeenCalledOnce()
    expect(window.sessionStorage.getItem('neo-anki:extensions-marketplace:v1')).toContain('Fixture Extension is installed and ready.')
    expect(screen.queryByText('Review installation')).not.toBeInTheDocument()
  })
})
