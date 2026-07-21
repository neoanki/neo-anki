import { afterEach, describe, expect, it } from 'vitest'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compareExtensionVersions, ExtensionManager } from './extension-manager.js'
import { createExtensionPackage, EXTENSION_SIGNATURE_PATH } from '../packages/extension-sdk/src/package-format.js'
import type { ExtensionPackageManifestV2 } from '../packages/extension-sdk/src/index.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

const fixture = (version = '2.0.0', workerSource = 'export {}', minimumNeoAnkiVersion?: string) => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const publisherKey = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
  const manifest: ExtensionPackageManifestV2 = {
    format: 'neo-anki-extension', schemaVersion: 2, sdkVersion: 2, id: 'org.neoanki.fixture.signed', name: 'Signed fixture', version, publisher: 'Fixture publisher', publisherKey,
    permissions: ['study:signals'], workerEntry: 'dist/worker.js', minimumNeoAnkiVersion, provenance: { sourceCommit: 'a'.repeat(40), buildSystem: 'vitest' },
  }
  const files = { 'dist/worker.js': workerSource }
  const unsigned = createExtensionPackage(manifest, files)
  const unsignedDigest = createHash('sha256').update(unsigned).digest('hex')
  const signature = sign(null, Buffer.from(unsignedDigest, 'hex'), privateKey).toString('base64')
  const signatureFile = `${JSON.stringify({ version: 1, algorithm: 'ed25519', publicKey: publisherKey, unsignedDigest, signature })}\n`
  return { manifest, files, signatureFile, signed: createExtensionPackage(manifest, { ...files, [EXTENSION_SIGNATURE_PATH]: signatureFile }) }
}

describe('SDK v2 extension package trust', () => {
  it('uses full SemVer precedence for prereleases', () => {
    expect(compareExtensionVersions('1.0.0-beta.2', '1.0.0-beta.11')).toBeLessThan(0)
    expect(compareExtensionVersions('1.0.0-beta.11', '1.0.0')).toBeLessThan(0)
    expect(compareExtensionVersions('1.0.0+build.2', '1.0.0+build.1')).toBe(0)
  })
  it('accepts a valid publisher signature and rejects unsigned or changed content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'neoanki-extension-manager-')); roots.push(root)
    const manager = new ExtensionManager(root)
    const value = fixture()
    const candidate = await manager.stage(value.signed)
    expect(candidate).toMatchObject({ manifest: { id: value.manifest.id }, isDowngrade: false })
    await manager.install(candidate.token)
    const entry = await manager.resolveAsset(value.manifest.id, 'dist/worker.js')
    expect(entry && await readFile(entry, 'utf8')).toBe('export {}')
    expect(new TextDecoder().decode(await manager.readWorkerEntry(value.manifest.id, 'dist/worker.js', candidate.digest.slice(0, 16)))).toBe('export {}')
    await expect(manager.readWorkerEntry(value.manifest.id, 'signature.json', candidate.digest.slice(0, 16))).rejects.toThrow(/reviewed extension worker entry/i)
    await expect(manager.readWorkerEntry(value.manifest.id, 'dist/worker.js', 'deadbeef')).rejects.toThrow(/reviewed extension worker entry/i)
    await expect(manager.resolveAsset(value.manifest.id, '../outside.js')).rejects.toThrow(/unsafe extension path/i)
    await expect(manager.stage(createExtensionPackage(value.manifest, value.files))).rejects.toThrow(/unsigned/)
    await expect(manager.stage(createExtensionPackage(value.manifest, { 'dist/worker.js': 'export const changed = true', [EXTENSION_SIGNATURE_PATH]: value.signatureFile }))).rejects.toThrow(/digest/)
  })

  it('does not expose a package that requires a newer core release', async () => {
    const root = await mkdtemp(join(tmpdir(), 'neoanki-extension-compatibility-')); roots.push(root)
    const manager = new ExtensionManager(root, '0.3.1')
    await expect(manager.stage(fixture('2.0.0', 'export {}', '0.4.0').signed)).rejects.toThrow('requires Neo Anki 0.4.0 or later')
    await expect(manager.stage(fixture('2.0.0', 'export {}', '0.3.1').signed)).resolves.toMatchObject({ manifest: { minimumNeoAnkiVersion: '0.3.1' } })
  })

  it('keeps an update recoverable until activation is confirmed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'neoanki-extension-rollback-')); roots.push(root)
    const manager = new ExtensionManager(root)
    const first = fixture('2.0.0', 'export const version = 1')
    await manager.install((await manager.stage(first.signed)).token)
    await manager.confirmActivation(first.manifest.id)

    const update = fixture('2.1.0', 'export const version = 2')
    await manager.install((await manager.stage(update.signed)).token)
    expect((await manager.list())[0]).toMatchObject({ manifest: { version: '2.1.0' }, pendingActivation: true, previous: { manifest: { version: '2.0.0' } } })
    expect(await manager.rollbackActivation(update.manifest.id)).toBe(true)
    expect((await manager.list())[0]).toMatchObject({ manifest: { version: '2.0.0' } })
    expect(new TextDecoder().decode(await manager.readWorkerEntry(update.manifest.id, 'dist/worker.js', (await manager.list())[0].digest.slice(0, 16)))).toContain('version = 1')
  })

  it('removes a first install that fails activation and deletes rollback state after success', async () => {
    const root = await mkdtemp(join(tmpdir(), 'neoanki-extension-activation-')); roots.push(root)
    const manager = new ExtensionManager(root)
    const value = fixture()
    await manager.install((await manager.stage(value.signed)).token)
    expect(await manager.rollbackActivation(value.manifest.id)).toBe(true)
    expect(await manager.list()).toEqual([])

    await manager.install((await manager.stage(value.signed)).token)
    await manager.confirmActivation(value.manifest.id)
    expect((await manager.list())[0]).not.toHaveProperty('pendingActivation')
    expect((await manager.list())[0]).not.toHaveProperty('previous')
  })

  it('covers enabled-state, permission, repeated-install, file-install, and uninstall lifecycle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'neoanki-extension-lifecycle-')); roots.push(root)
    const manager = new ExtensionManager(root, '0.4.0')
    const value = fixture('2.0.0', 'export const lifecycle = true', '0.4.0')

    await manager.install((await manager.stage(value.signed)).token)
    await manager.confirmActivation(value.manifest.id)
    await manager.install((await manager.stage(value.signed)).token)
    await manager.confirmActivation(value.manifest.id)
    expect(await manager.requirePermission(value.manifest.id, 'study:signals')).toMatchObject({ id: value.manifest.id })
    await expect(manager.requirePermission(value.manifest.id, 'content:read')).rejects.toThrow(/does not have content:read/)

    await manager.setEnabled(value.manifest.id, false)
    await expect(manager.requireEnabled(value.manifest.id)).rejects.toThrow(/not installed or enabled/)
    expect(await manager.resolveAsset(value.manifest.id, 'dist/worker.js')).toBeNull()
    await manager.setEnabled(value.manifest.id, true)
    expect(await manager.requireEnabled(value.manifest.id)).toMatchObject({ version: '2.0.0' })

    const discarded = await manager.stage(value.signed)
    manager.discard(discarded.token)
    await expect(manager.install(discarded.token)).rejects.toThrow(/expired/)
    await manager.confirmActivation('org.neoanki.missing')
    await expect(manager.rollbackActivation('org.neoanki.missing')).resolves.toBe(false)
    await manager.uninstall('org.neoanki.missing')
    await manager.uninstall(value.manifest.id)
    expect(await manager.list()).toEqual([])

    const packagePath = join(root, 'fixture.neoanki-extension')
    await writeFile(packagePath, value.signed)
    await manager.installFile(packagePath)
    expect(await manager.list()).toHaveLength(1)
  })
})
