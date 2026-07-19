import { describe, expect, it } from 'vitest'
import { compareMarketplaceVersions, filterMarketplaceExtensions, parseMarketplaceCatalog, type MarketplaceCatalog } from './index'

const catalog: MarketplaceCatalog = { format: 'neo-anki-extension-catalog', schemaVersion: 1, extensions: [{ id: 'com.example.focus', name: 'Focus', summary: 'A focused queue.', description: 'Helps learners focus.', publisher: { name: 'Example', url: 'https://example.com' }, repository: 'https://github.com/example/focus', license: 'MIT', categories: ['study'], tags: ['focus'], release: { version: '1.2.0', publishedAt: '2026-07-19T00:00:00Z', packageUrl: 'https://github.com/example/focus/releases/download/v1.2.0/focus.neoanki-extension', sha256: 'a'.repeat(64), publisherKey: 'a'.repeat(40), minimumNeoAnkiVersion: '0.2.0', permissions: ['study:read'] } }] }

describe('marketplace catalog', () => {
  it('parses and searches valid entries', () => { const parsed = parseMarketplaceCatalog(catalog); expect(filterMarketplaceExtensions(parsed.extensions, 'learner')).toHaveLength(1); expect(filterMarketplaceExtensions(parsed.extensions, '', 'analytics')).toHaveLength(0) })
  it('rejects mutable package URLs', () => expect(() => parseMarketplaceCatalog({ ...catalog, extensions: [{ ...catalog.extensions[0], release: { ...catalog.extensions[0].release, packageUrl: 'https://example.com/latest.neoanki-extension' } }] })).toThrow(/immutable GitHub Release/))
  it('rejects packages published from a different repository', () => expect(() => parseMarketplaceCatalog({ ...catalog, extensions: [{ ...catalog.extensions[0], release: { ...catalog.extensions[0].release, packageUrl: 'https://github.com/attacker/focus/releases/download/v1.2.0/focus.neoanki-extension' } }] })).toThrow(/declared source repository/))
  it('orders semantic versions', () => { expect(compareMarketplaceVersions('1.2.0', '1.1.9')).toBeGreaterThan(0); expect(compareMarketplaceVersions('1.2.0-beta.1', '1.2.0')).toBeLessThan(0) })
})
