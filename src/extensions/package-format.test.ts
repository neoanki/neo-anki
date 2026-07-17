import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { createExtensionPackage, parseExtensionPackage, validateExtensionPackageManifest } from './package-format'
import type { ExtensionPackageManifest } from './sdk'

const manifest: ExtensionPackageManifest = {
  format: 'neo-anki-extension',
  schemaVersion: 1,
  id: 'com.example.study-pulse',
  name: 'Study Pulse',
  version: '1.0.0',
  sdkVersion: 1,
  publisher: 'Example Studio',
  description: 'A small extension fixture.',
  permissions: ['ui:pages'],
  entry: 'dist/index.js',
}

describe('third-party extension package format', () => {
  it('round-trips a valid deterministic package', () => {
    const archive = createExtensionPackage(manifest, { 'dist/index.js': 'export default {}' })
    const parsed = parseExtensionPackage(archive)
    expect(parsed.manifest).toEqual(manifest)
    expect(new TextDecoder().decode(parsed.files['dist/index.js'])).toBe('export default {}')
  })

  it('rejects unknown permissions, invalid identifiers, and unsupported SDKs', () => {
    expect(() => validateExtensionPackageManifest({ ...manifest, id: 'Bad Id' })).toThrow('reverse-domain')
    expect(() => validateExtensionPackageManifest({ ...manifest, sdkVersion: 2 })).toThrow('unsupported SDK')
    expect(() => validateExtensionPackageManifest({ ...manifest, permissions: ['system:everything'] })).toThrow('unknown permission')
  })

  it('rejects traversal paths and missing entry modules', () => {
    const unsafe = zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)), '../escape.js': strToU8('bad') })
    expect(() => parseExtensionPackage(unsafe)).toThrow('Unsafe extension path')
    const missing = zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)) })
    expect(() => parseExtensionPackage(missing)).toThrow('entry dist/index.js is missing')
  })

  it('rejects duplicate permissions and non-semver versions', () => {
    expect(() => validateExtensionPackageManifest({ ...manifest, permissions: ['ui:pages', 'ui:pages'] })).toThrow('duplicates')
    expect(() => validateExtensionPackageManifest({ ...manifest, version: 'tomorrow' })).toThrow('semantic versioning')
  })

  it('accepts public review-tool and settings-panel permissions', () => {
    expect(validateExtensionPackageManifest({ ...manifest, permissions: ['ui:settings-panels', 'review:tools'] }).permissions).toEqual(['ui:settings-panels', 'review:tools'])
  })
})
