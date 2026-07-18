import { afterEach, describe, expect, it } from 'vitest'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compareExtensionVersions, ExtensionManager } from './extension-manager.js'
import { createExtensionPackage, EXTENSION_SIGNATURE_PATH } from '../packages/extension-sdk/src/package-format.js'
import type { ExtensionPackageManifestV2 } from '../packages/extension-sdk/src/index.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

const fixture = () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const publisherKey = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
  const manifest: ExtensionPackageManifestV2 = {
    format: 'neo-anki-extension', schemaVersion: 2, sdkVersion: 2, id: 'org.neoanki.fixture.signed', name: 'Signed fixture', version: '2.0.0', publisher: 'Fixture publisher', publisherKey,
    permissions: ['study:signals'], workerEntry: 'dist/worker.js', provenance: { sourceCommit: 'a'.repeat(40), buildSystem: 'vitest' },
  }
  const files = { 'dist/worker.js': 'export {}' }
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
})
