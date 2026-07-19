import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { ExtensionManifestV2 as ExtensionPackageManifest, ExtensionPermissionV2 as AnyExtensionPermission } from '../packages/extension-sdk/src/index.js'
import { createExtensionPackage, EXTENSION_SIGNATURE_PATH, normalizeExtensionPath, parseExtensionPackage, parseExtensionPackageSignature, type ParsedExtensionPackage } from '../packages/extension-sdk/src/package-format.js'

interface ExtensionStateEntry {
  manifest: ExtensionPackageManifest
  enabled: boolean
  directory: string
  digest: string
  installedAt: string
  updatedAt: string
}

interface ExtensionState {
  version: 2
  extensions: Record<string, ExtensionStateEntry>
}

interface StagedPackage {
  bytes: Uint8Array
  stagedAt: number
}

export interface InstalledExtensionRecord extends ExtensionStateEntry {
  workerEntryUrl?: string
  uiEntryUrls?: Array<{ id: string; surface: 'settings' | 'review' | 'page'; url: string }>
}

export interface ExtensionInstallCandidate {
  token: string
  manifest: ExtensionPackageManifest
  digest: string
  compressedBytes: number
  unpackedBytes: number
  currentVersion?: string
  isDowngrade: boolean
  addedPermissions: AnyExtensionPermission[]
}

const emptyState = (): ExtensionState => ({ version: 2, extensions: {} })
const MAX_STAGED_PACKAGES = 8
const STAGED_PACKAGE_TTL_MS = 10 * 60 * 1000

export const compareExtensionVersions = (left: string, right: string) => {
  const parse = (version: string) => {
    const [coreAndPre] = version.split('+')
    const [core, pre = ''] = coreAndPre.split('-', 2)
    return { core: core.split('.').map(Number), pre: pre ? pre.split('.') : [] }
  }
  const a = parse(left); const b = parse(right)
  for (let index = 0; index < 3; index += 1) if (a.core[index] !== b.core[index]) return a.core[index] - b.core[index]
  if (!a.pre.length || !b.pre.length) return a.pre.length ? -1 : b.pre.length ? 1 : 0
  for (let index = 0; index < Math.max(a.pre.length, b.pre.length); index += 1) {
    if (a.pre[index] === undefined || b.pre[index] === undefined) return a.pre[index] === undefined ? -1 : 1
    if (a.pre[index] === b.pre[index]) continue
    const aNumber = /^\d+$/.test(a.pre[index]) ? Number(a.pre[index]) : null
    const bNumber = /^\d+$/.test(b.pre[index]) ? Number(b.pre[index]) : null
    if (aNumber !== null || bNumber !== null) return aNumber === null ? 1 : bNumber === null ? -1 : aNumber - bNumber
    return a.pre[index].localeCompare(b.pre[index])
  }
  return 0
}

const verifyPackageSignature = (parsed: ParsedExtensionPackage) => {
  const signatureBytes = parsed.files[EXTENSION_SIGNATURE_PATH]
  if (!signatureBytes) throw new Error('Extension package is unsigned.')
  const metadata = parseExtensionPackageSignature(signatureBytes)
  if (metadata.publicKey !== parsed.manifest.publisherKey) throw new Error('Extension signature publisher key does not match its manifest.')
  const unsignedFiles = Object.fromEntries(Object.entries(parsed.files).filter(([path]) => path !== 'manifest.json' && path !== EXTENSION_SIGNATURE_PATH))
  const unsigned = createExtensionPackage(parsed.manifest, unsignedFiles)
  const digest = createHash('sha256').update(unsigned).digest('hex')
  if (digest !== metadata.unsignedDigest) throw new Error('Extension signed-content digest does not match the package.')
  let publicKey
  try { publicKey = createPublicKey({ key: Buffer.from(metadata.publicKey, 'base64'), format: 'der', type: 'spki' }) }
  catch { throw new Error('Extension publisher key is invalid.') }
  if (!verify(null, Buffer.from(digest, 'hex'), publicKey, Buffer.from(metadata.signature, 'base64'))) throw new Error('Extension publisher signature is invalid.')
}

export class ExtensionManager {
  private staged = new Map<string, StagedPackage>()

  constructor(private readonly userDataRoot: string) {}

  private root() { return join(this.userDataRoot, 'extensions') }
  private packagesRoot() { return join(this.root(), 'packages') }
  private statePath() { return join(this.root(), 'state.json') }
  private recoveryStatePath() { return join(this.root(), 'state.recovery.json') }

  private async loadState(): Promise<ExtensionState> {
    const source = existsSync(this.statePath()) ? this.statePath() : existsSync(this.recoveryStatePath()) ? this.recoveryStatePath() : null
    if (!source) return emptyState()
    const value = JSON.parse(await readFile(source, 'utf8')) as { version?: number; extensions?: Record<string, unknown> }
    if (!value.extensions || typeof value.extensions !== 'object' || (value.version !== 1 && value.version !== 2)) throw new Error('The installed-extension registry is damaged.')
    if (value.version === 1) {
      const supported = Object.entries(value.extensions).filter(([, entry]) => (entry as ExtensionStateEntry).manifest?.schemaVersion === 2)
      return { version: 2, extensions: Object.fromEntries(supported) as ExtensionState['extensions'] }
    }
    return value as unknown as ExtensionState
  }

  private async saveState(state: ExtensionState) {
    await mkdir(this.root(), { recursive: true })
    const temporary = join(this.root(), `state-${randomUUID()}.next`)
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    const hadCurrent = existsSync(this.statePath())
    if (hadCurrent) {
      await rm(this.recoveryStatePath(), { force: true })
      await rename(this.statePath(), this.recoveryStatePath())
    }
    try {
      await rename(temporary, this.statePath())
      await rm(this.recoveryStatePath(), { force: true })
    } catch (error) {
      if (hadCurrent && existsSync(this.recoveryStatePath()) && !existsSync(this.statePath())) await rename(this.recoveryStatePath(), this.statePath())
      throw error
    }
  }

  async list(): Promise<InstalledExtensionRecord[]> {
    const state = await this.loadState()
    return Object.values(state.extensions).sort((left, right) => left.manifest.name.localeCompare(right.manifest.name)).map((entry) => ({
      ...entry,
      workerEntryUrl: entry.manifest.workerEntry ? `neoanki://app/__extension-worker.js?id=${encodeURIComponent(entry.manifest.id)}&entry=${encodeURIComponent(entry.manifest.workerEntry)}&v=${entry.digest.slice(0, 16)}` : undefined,
      uiEntryUrls: entry.manifest.uiEntries?.map((value) => ({ id: value.id, surface: value.surface, url: `neoanki-extension://${entry.manifest.id}/${value.entry}?v=${entry.digest.slice(0, 16)}` })),
    }))
  }

  async stage(bytes: Uint8Array): Promise<ExtensionInstallCandidate> {
    const parsed = parseExtensionPackage(bytes)
    verifyPackageSignature(parsed)
    const digest = createHash('sha256').update(bytes).digest('hex')
    const state = await this.loadState()
    const current = state.extensions[parsed.manifest.id]
    const token = randomUUID()
    const now = Date.now()
    for (const [candidateToken, candidate] of this.staged) if (now - candidate.stagedAt > STAGED_PACKAGE_TTL_MS) this.staged.delete(candidateToken)
    while (this.staged.size >= MAX_STAGED_PACKAGES) this.staged.delete(this.staged.keys().next().value!)
    this.staged.set(token, { bytes: new Uint8Array(bytes), stagedAt: now })
    return {
      token,
      manifest: parsed.manifest,
      digest,
      compressedBytes: parsed.compressedBytes,
      unpackedBytes: parsed.unpackedBytes,
      currentVersion: current?.manifest.version,
      isDowngrade: Boolean(current && compareExtensionVersions(parsed.manifest.version, current.manifest.version) < 0),
      addedPermissions: parsed.manifest.permissions.filter((permission) => !current?.manifest.permissions.some((value) => value === permission)),
    }
  }

  discard(token: string) { this.staged.delete(token) }

  async install(token: string): Promise<InstalledExtensionRecord> {
    const staged = this.staged.get(token)
    this.staged.delete(token)
    if (!staged || Date.now() - staged.stagedAt > STAGED_PACKAGE_TTL_MS) throw new Error('The extension install review expired. Choose the package again.')
    const { bytes } = staged
    const parsed = parseExtensionPackage(bytes)
    verifyPackageSignature(parsed)
    const digest = createHash('sha256').update(bytes).digest('hex')
    const state = await this.loadState()
    const previous = state.extensions[parsed.manifest.id]
    const timestamp = new Date().toISOString()
    const directory = `${parsed.manifest.version}-${digest.slice(0, 12)}`
    const finalRoot = join(this.packagesRoot(), parsed.manifest.id, directory)
    const temporaryRoot = join(this.packagesRoot(), parsed.manifest.id, `.install-${randomUUID()}`)

    if (previous?.digest === digest && previous.directory === directory && existsSync(finalRoot)) {
      state.extensions[parsed.manifest.id] = { ...previous, manifest: parsed.manifest, enabled: true, updatedAt: timestamp }
      await this.saveState(state)
      return (await this.list()).find((entry) => entry.manifest.id === parsed.manifest.id)!
    }

    await mkdir(temporaryRoot, { recursive: true })
    let displacedRoot: string | null = null
    try {
      for (const [path, contents] of Object.entries(parsed.files)) {
        const target = join(temporaryRoot, normalizeExtensionPath(path))
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, contents, { mode: 0o600 })
      }
      if (existsSync(finalRoot)) {
        displacedRoot = `${finalRoot}.recovery-${randomUUID()}`
        await rename(finalRoot, displacedRoot)
      }
      await rename(temporaryRoot, finalRoot)
      state.extensions[parsed.manifest.id] = {
        manifest: parsed.manifest,
        enabled: true,
        directory,
        digest,
        installedAt: previous?.installedAt || timestamp,
        updatedAt: timestamp,
      }
      await this.saveState(state)
      if (previous && previous.directory !== directory) await rm(join(this.packagesRoot(), parsed.manifest.id, previous.directory), { recursive: true, force: true })
      if (displacedRoot) await rm(displacedRoot, { recursive: true, force: true })
    } catch (error) {
      await rm(temporaryRoot, { recursive: true, force: true })
      if (displacedRoot && existsSync(displacedRoot)) {
        await rm(finalRoot, { recursive: true, force: true })
        await rename(displacedRoot, finalRoot)
      }
      throw error
    }
    return (await this.list()).find((entry) => entry.manifest.id === parsed.manifest.id)!
  }

  async installFile(path: string) {
    const candidate = await this.stage(new Uint8Array(await readFile(path)))
    return this.install(candidate.token)
  }

  async setEnabled(id: string, enabled: boolean) {
    const state = await this.loadState()
    const entry = state.extensions[id]
    if (!entry) throw new Error(`Extension ${id} is not installed.`)
    entry.enabled = enabled
    entry.updatedAt = new Date().toISOString()
    await this.saveState(state)
  }

  async requireEnabled(id: string) {
    const state = await this.loadState()
    const entry = state.extensions[id]
    if (!entry?.enabled) throw new Error(`Extension ${id} is not installed or enabled.`)
    return entry.manifest
  }

  async requirePermission(id: string, permission: AnyExtensionPermission) {
    const manifest = await this.requireEnabled(id)
    if (!manifest.permissions.some((value) => value === permission)) throw new Error(`Extension ${id} does not have ${permission}.`)
    return manifest
  }

  async uninstall(id: string) {
    const state = await this.loadState()
    if (!state.extensions[id]) return
    delete state.extensions[id]
    await this.saveState(state)
    await rm(join(this.packagesRoot(), id), { recursive: true, force: true })
  }

  async resolveAsset(id: string, requestedPath: string) {
    const state = await this.loadState()
    const entry = state.extensions[id]
    if (!entry?.enabled) return null
    const packageRoot = resolve(this.packagesRoot(), id, entry.directory)
    const safePath = normalizeExtensionPath(requestedPath)
    const target = resolve(packageRoot, safePath)
    if (relative(packageRoot, target).startsWith('..') || !target.startsWith(`${packageRoot}${sep}`) || !existsSync(target)) return null
    return target
  }

  async readWorkerEntry(id: string, requestedPath: string, digestPrefix: string) {
    const state = await this.loadState()
    const entry = state.extensions[id]
    const safePath = normalizeExtensionPath(requestedPath)
    if (!entry?.enabled || entry.manifest.workerEntry !== safePath || !digestPrefix || !entry.digest.startsWith(digestPrefix)) throw new Error('The reviewed extension worker entry is unavailable.')
    const target = await this.resolveAsset(id, safePath)
    if (!target) throw new Error('The reviewed extension worker entry is missing.')
    const bytes = await readFile(target)
    if (!bytes.byteLength || bytes.byteLength > 8 * 1024 * 1024) throw new Error('Extension worker entry is empty or exceeds 8 MiB.')
    return bytes
  }

}
