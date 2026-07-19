import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { MARKETPLACE_CATALOG_URL } from '@neo-anki/extension-marketplace'
import { MarketplaceClient } from './marketplace-client'
import type { ExtensionManager, ExtensionInstallCandidate } from './extension-manager'

const bytes = new TextEncoder().encode('signed package fixture')
const digest = createHash('sha256').update(bytes).digest('hex')
const entry = { id: 'com.example.focus', name: 'Focus', summary: 'Focused study.', description: 'Helps focus.', publisher: { name: 'Example Publisher', url: 'https://example.com' }, repository: 'https://github.com/example/focus', license: 'MIT', categories: ['study'], tags: ['focus'], release: { version: '1.0.0', publishedAt: '2026-07-19T00:00:00Z', packageUrl: 'https://github.com/example/focus/releases/download/v1.0.0/focus.neoanki-extension', sha256: digest, publisherKey: 'a'.repeat(40), minimumNeoAnkiVersion: '0.2.0', permissions: ['study:read'] } }
const catalog = { format: 'neo-anki-extension-catalog', schemaVersion: 1, extensions: [entry] }
const candidate = { token: 'candidate', manifest: { format: 'neo-anki-extension', schemaVersion: 2, sdkVersion: 2, id: entry.id, name: entry.name, version: entry.release.version, publisher: entry.publisher.name, publisherKey: entry.release.publisherKey, permissions: entry.release.permissions, workerEntry: 'worker.js', provenance: { sourceCommit: 'a'.repeat(40), buildSystem: 'fixture' } }, digest, compressedBytes: bytes.byteLength, unpackedBytes: bytes.byteLength, isDowngrade: false, addedPermissions: ['study:read'] } as ExtensionInstallCandidate

describe('MarketplaceClient', () => {
  it('pins an approved release before staging it for user review', async () => {
    const stage = vi.fn(async (_bytes: Uint8Array) => candidate); const discard = vi.fn()
    const fetcher = vi.fn(async (url: string) => url === MARKETPLACE_CATALOG_URL ? new Response(JSON.stringify(catalog), { status: 200, headers: { 'content-type': 'application/json' } }) : new Response(bytes, { status: 200, headers: { 'content-type': 'application/octet-stream' } }))
    const client = new MarketplaceClient({ stage, discard } as unknown as ExtensionManager, fetcher, '0.2.0')
    await expect(client.stage(entry.id, entry.release.version)).resolves.toEqual(candidate)
    expect(fetcher).toHaveBeenNthCalledWith(1, MARKETPLACE_CATALOG_URL, expect.objectContaining({ redirect: 'follow' }))
    expect(fetcher).toHaveBeenNthCalledWith(2, entry.release.packageUrl, expect.objectContaining({ redirect: 'follow' }))
    expect(Array.from(stage.mock.calls[0][0])).toEqual(Array.from(bytes))
    expect(discard).not.toHaveBeenCalled()
  })

  it('rejects a package whose digest differs from the approved catalog', async () => {
    const changed = new TextEncoder().encode('different package')
    const fetcher = async (url: string) => url === MARKETPLACE_CATALOG_URL ? new Response(JSON.stringify(catalog)) : new Response(changed)
    const client = new MarketplaceClient({ stage: vi.fn() } as unknown as ExtensionManager, fetcher, '0.2.0')
    await expect(client.stage(entry.id, entry.release.version)).rejects.toThrow(/SHA-256/)
  })
})
