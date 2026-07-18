import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { createExtensionPackage, parseExtensionPackage, validateExtensionPackageManifest } from './package-format'
import type { ExtensionPackageManifest } from '../../packages/extension-sdk/src/index'

const manifest: ExtensionPackageManifest = {
  format: 'neo-anki-extension', schemaVersion: 2, sdkVersion: 2,
  id: 'com.example.study-pulse', name: 'Study Pulse', version: '2.0.0', publisher: 'Example Studio', publisherKey: 'ed25519:fixture',
  description: 'A small extension fixture.', permissions: ['study:signals', 'ui:settings'],
  workerEntry: 'dist/worker.js', uiEntries: [{ id: 'settings', surface: 'settings', entry: 'dist/settings.js' }],
  provenance: { sourceCommit: 'a'.repeat(40), coreCommit: 'b'.repeat(40), buildSystem: 'npm-ci' },
}

const files = { 'dist/worker.js': 'export {}', 'dist/settings.js': 'export {}' }

describe('installable extension package format', () => {
  it('round-trips SDK 2 entries reproducibly', () => {
    const archive = createExtensionPackage(manifest, files)
    const reordered = createExtensionPackage(manifest, { 'z.txt': 'last', ...files, 'a.txt': 'first' })
    const reorderedAgain = createExtensionPackage(manifest, { 'a.txt': 'first', ...files, 'z.txt': 'last' })
    const parsed = parseExtensionPackage(archive)
    expect(parsed.manifest).toEqual(manifest)
    expect(new TextDecoder().decode(parsed.files['dist/worker.js'])).toBe('export {}')
    expect(reordered).toEqual(reorderedAgain)
  })

  it('rejects SDK 1 instead of offering a compatibility runtime', () => {
    expect(() => validateExtensionPackageManifest({ ...manifest, schemaVersion: 1, sdkVersion: 1, entry: 'dist/index.js' })).toThrow('Only Neo Anki extension SDK 2 packages are supported')
  })

  it('rejects unknown permissions, invalid identifiers, and mismatched SDKs', () => {
    expect(() => validateExtensionPackageManifest({ ...manifest, id: 'Bad Id' })).toThrow('reverse-domain')
    expect(() => validateExtensionPackageManifest({ ...manifest, sdkVersion: 1 })).toThrow('Only Neo Anki extension SDK 2 packages are supported')
    expect(() => validateExtensionPackageManifest({ ...manifest, permissions: ['system:everything'] })).toThrow('unknown permission')
  })

  it('rejects traversal paths and missing entry modules', () => {
    const unsafe = zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)), '../escape.js': strToU8('bad') })
    expect(() => parseExtensionPackage(unsafe)).toThrow('Unsafe extension path')
    const missing = zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)) })
    expect(() => parseExtensionPackage(missing)).toThrow('entry dist/worker.js is missing')
  })

  it('rejects duplicate permissions, invalid versions, and unpinned provenance', () => {
    expect(() => validateExtensionPackageManifest({ ...manifest, permissions: ['ui:settings', 'ui:settings'] })).toThrow('duplicates')
    expect(() => validateExtensionPackageManifest({ ...manifest, version: 'tomorrow' })).toThrow('semantic versioning')
    expect(() => createExtensionPackage({ ...manifest, provenance: { ...manifest.provenance, sourceCommit: 'main' } }, files)).toThrow(/complete Git object ids/)
  })

  it('validates declared network domains and their permission', () => {
    const valid = validateExtensionPackageManifest({ ...manifest, permissions: ['network:fetch', 'secrets:device'], networkDomains: ['api.example.com', '*.speech.example.com'] })
    expect(valid.networkDomains).toEqual(['api.example.com', '*.speech.example.com'])
    expect(() => validateExtensionPackageManifest({ ...manifest, networkDomains: ['api.example.com'] })).toThrow('require network:fetch')
    expect(() => validateExtensionPackageManifest({ ...manifest, permissions: ['network:fetch'], networkDomains: ['https://example.com/path'] })).toThrow('domains are invalid')
  })
})
