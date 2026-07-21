import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { createExtensionPackage, parseExtensionPackage, validateExtensionPackageManifest } from './package-format'
import type { ExtensionPackageManifest } from '../../packages/extension-sdk/src/index'

const manifest: ExtensionPackageManifest = {
  format: 'neo-anki-extension', schemaVersion: 2, sdkVersion: 2,
  id: 'com.example.study-pulse', name: 'Study Pulse', version: '2.0.0', publisher: 'Example Studio', publisherKey: 'ed25519:fixture',
  description: 'A small extension fixture.', minimumNeoAnkiVersion: '0.3.1', permissions: ['study:signals', 'config:sync'],
  workerEntry: 'dist/worker.js', settings: { schemaVersion: 1, label: 'Study Pulse', sections: [{ id: 'general', title: 'General', controls: [{ id: 'enabled', kind: 'toggle', path: '/enabled', label: 'Enabled', defaultValue: true }] }] },
  provenance: { sourceCommit: 'a'.repeat(40), coreCommit: 'b'.repeat(40), buildSystem: 'npm-ci' },
}

const files = { 'dist/worker.js': 'export {}' }

describe('installable extension package format', () => {
  it('is byte-reproducible across host timezones', () => {
    const previous = process.env.TZ
    try {
      process.env.TZ = 'UTC'
      const utc = createExtensionPackage(manifest, files)
      process.env.TZ = 'Europe/Kyiv'
      const kyiv = createExtensionPackage(manifest, files)
      expect(kyiv).toEqual(utc)
    } finally {
      if (previous === undefined) delete process.env.TZ
      else process.env.TZ = previous
    }
  })

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
    expect(() => validateExtensionPackageManifest({ ...manifest, permissions: ['config:sync', 'config:sync'] })).toThrow('duplicates')
    expect(() => validateExtensionPackageManifest({ ...manifest, version: 'tomorrow' })).toThrow('semantic versioning')
    expect(() => createExtensionPackage({ ...manifest, provenance: { ...manifest.provenance, sourceCommit: 'main' } }, files)).toThrow(/complete Git object ids/)
  })

  it('validates declared network domains and their permission', () => {
    const valid = validateExtensionPackageManifest({ ...manifest, permissions: ['network:fetch', 'secrets:device', 'config:sync'], networkDomains: ['api.example.com', '*.speech.example.com'] })
    expect(valid.networkDomains).toEqual(['api.example.com', '*.speech.example.com'])
    expect(() => validateExtensionPackageManifest({ ...manifest, networkDomains: ['api.example.com'] })).toThrow('require network:fetch')
    expect(() => validateExtensionPackageManifest({ ...manifest, permissions: ['network:fetch', 'config:sync'], networkDomains: ['https://example.com/path'] })).toThrow('domains are invalid')
  })

  it('preserves additive UI, prompt, and authoring metadata', () => {
    const validated = validateExtensionPackageManifest({
      ...manifest,
      permissions: ['study:signals', 'study:prompt-types', 'config:sync', 'ui:page'],
      settings: { ...manifest.settings, label: 'Speech settings', description: 'Choose voices.', helpText: 'Credentials stay on this device.', icon: 'volume-2' },
      uiEntries: [{ id: 'page', surface: 'page', entry: 'dist/page.js', label: 'Speech tools' }],
      contributions: {
        promptTypes: [{ id: 'audio-answer', label: 'Audio answer', description: 'Recall from speech.', authoringHint: 'Attach a recording.', requiredFields: ['prompt', 'audio'] }],
        authoringActions: [{ id: 'generate-audio', label: 'Generate offline audio', description: 'Create a portable file after saving.', defaultSelected: false, availability: 'status-required', configurationDestination: 'extensions/configure' }],
      },
    })
    expect(validated.settings).toMatchObject({ label: 'Speech settings', icon: 'volume-2' })
    expect(validated.contributions?.promptTypes?.[0]).toMatchObject({ requiredFields: ['prompt', 'audio'] })
    expect(validated).toMatchObject({ minimumNeoAnkiVersion: '0.3.1' })
    expect(validated.contributions?.authoringActions?.[0]).toMatchObject({ id: 'generate-audio', defaultSelected: false, availability: 'status-required', configurationDestination: 'extensions/configure' })
  })

  it('rejects malformed minimum app versions', () => {
    expect(() => validateExtensionPackageManifest({ ...manifest, minimumNeoAnkiVersion: 'next' })).toThrow('minimum Neo Anki version')
  })

  it('accepts bounded nested declarative settings and rejects executable settings UI', () => {
    const validated = validateExtensionPackageManifest({
      ...manifest,
      permissions: ['config:sync', 'secrets:device'],
      settings: { schemaVersion: 1, sections: [{ id: 'profiles', title: 'Profiles', controls: [
        { id: 'privacy', kind: 'notice', text: 'Credentials stay on this device.', tone: 'privacy' },
        { id: 'key', kind: 'secret', label: 'API key', secretKey: 'provider.api-key' },
        { id: 'profiles-list', kind: 'group', path: '/profiles', label: 'Profiles', itemIdPath: '/id', itemLabelPath: '/name', maxItems: 50, newItem: { name: 'New profile' }, fields: [
          { id: 'profile-name', kind: 'text', path: '/name', label: 'Name', required: true, maxLength: 100 },
          { id: 'tracks', kind: 'group', path: '/tracks', label: 'Tracks', maxItems: 12, fields: [{ id: 'track-speed', kind: 'number', path: '/speed', label: 'Speed', min: .5, max: 2, defaultValue: 1 }] },
        ] },
      ] }] },
    })
    expect(validated.settings?.sections[0].controls).toHaveLength(3)
    expect(() => validateExtensionPackageManifest({ ...manifest, uiEntries: [{ id: 'settings', surface: 'settings', entry: 'dist/settings.js' }] })).toThrow(/declarative settings contract/)
    expect(() => validateExtensionPackageManifest({ ...manifest, settings: { schemaVersion: 1, sections: [{ id: 'bad', title: 'Bad', controls: [{ id: 'run', kind: 'action', command: 'process' }] }] } })).toThrow(/cannot declare actions/)
  })

  it('enforces declarative settings permissions, paths, ids, options, and group depth', () => {
    const section = (controls: unknown[]) => ({ schemaVersion: 1, sections: [{ id: 'general', title: 'General', controls }] })
    expect(() => validateExtensionPackageManifest({ ...manifest, permissions: [], settings: section([{ id: 'enabled', kind: 'toggle', path: '/enabled' }]) })).toThrow(/require config:sync/)
    expect(() => validateExtensionPackageManifest({ ...manifest, permissions: ['config:sync'], settings: section([{ id: 'key', kind: 'secret', secretKey: 'provider.key' }]) })).toThrow(/require secrets:device/)
    expect(() => validateExtensionPackageManifest({ ...manifest, settings: section([{ id: 'bad', kind: 'text', path: '/__proto__/value' }]) })).toThrow(/unsafe/)
    expect(() => validateExtensionPackageManifest({ ...manifest, settings: section([{ id: 'same', kind: 'toggle', path: '/a' }, { id: 'same', kind: 'toggle', path: '/b' }]) })).toThrow(/duplicated/)
    expect(() => validateExtensionPackageManifest({ ...manifest, settings: section([{ id: 'dynamic', kind: 'select', path: '/voice', options: [{ value: 'one', label: 'One' }], optionsProvider: 'voices.list' }]) })).toThrow(/not supported/)
    expect(() => validateExtensionPackageManifest({ ...manifest, settings: section([{ id: 'many', kind: 'select', path: '/choice', options: Array.from({ length: 101 }, (_, index) => ({ value: `v${index}`, label: `Value ${index}` })) }]) })).toThrow(/between 1 and 100/)
    expect(() => validateExtensionPackageManifest({ ...manifest, settings: section([{ id: 'outer', kind: 'group', path: '/outer', fields: [{ id: 'middle', kind: 'group', path: '/middle', fields: [{ id: 'inner', kind: 'group', path: '/inner', fields: [{ id: 'value', kind: 'text', path: '/value' }] }] }] }]) })).toThrow(/at most two levels/)
  })

  it('accepts empty text defaults and rejects more than 128 controls', () => {
    const validated = validateExtensionPackageManifest({ ...manifest, settings: { schemaVersion: 1, sections: [{ id: 'general', title: 'General', controls: [{ id: 'optional', kind: 'text', path: '/optional', defaultValue: '' }] }] } })
    expect((validated.settings?.sections[0].controls[0] as { defaultValue?: string }).defaultValue).toBe('')
    expect(() => validateExtensionPackageManifest({ ...manifest, settings: { schemaVersion: 1, sections: [{ id: 'general', title: 'General', controls: Array.from({ length: 129 }, (_, index) => ({ id: `control-${index}`, kind: 'toggle', path: `/value-${index}` })) }] } })).toThrow(/at most 128 controls/)
  })
})
