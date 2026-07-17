import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { ExtensionPackageManifest, ExtensionPermission } from '../packages/extension-sdk/src/index.js'
import { normalizeExtensionPath, parseExtensionPackage } from '../packages/extension-sdk/src/package-format.js'

interface ExtensionStateEntry {
  manifest: ExtensionPackageManifest
  enabled: boolean
  directory: string
  digest: string
  installedAt: string
  updatedAt: string
}

interface ExtensionState {
  version: 1
  extensions: Record<string, ExtensionStateEntry>
}

export interface InstalledExtensionRecord extends ExtensionStateEntry {
  entryUrl: string
}

export interface ExtensionInstallCandidate {
  token: string
  manifest: ExtensionPackageManifest
  digest: string
  compressedBytes: number
  unpackedBytes: number
  currentVersion?: string
  isDowngrade: boolean
  addedPermissions: ExtensionPermission[]
}

const emptyState = (): ExtensionState => ({ version: 1, extensions: {} })

const compareVersions = (left: string, right: string) => {
  const values = (version: string) => version.split(/[+-]/)[0].split('.').map(Number)
  const a = values(left)
  const b = values(right)
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] - b[index]
  return 0
}

export class ExtensionManager {
  private staged = new Map<string, Uint8Array>()

  constructor(private readonly userDataRoot: string) {}

  private root() { return join(this.userDataRoot, 'extensions') }
  private packagesRoot() { return join(this.root(), 'packages') }
  private statePath() { return join(this.root(), 'state.json') }
  private recoveryStatePath() { return join(this.root(), 'state.recovery.json') }

  private async loadState(): Promise<ExtensionState> {
    const source = existsSync(this.statePath()) ? this.statePath() : existsSync(this.recoveryStatePath()) ? this.recoveryStatePath() : null
    if (!source) return emptyState()
    const value = JSON.parse(await readFile(source, 'utf8')) as Partial<ExtensionState>
    if (value.version !== 1 || !value.extensions || typeof value.extensions !== 'object') throw new Error('The installed-extension registry is damaged.')
    return value as ExtensionState
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
      entryUrl: `neoanki-extension://${entry.manifest.id}/${entry.manifest.entry}?v=${entry.digest.slice(0, 16)}`,
    }))
  }

  async stage(bytes: Uint8Array): Promise<ExtensionInstallCandidate> {
    const parsed = parseExtensionPackage(bytes)
    const digest = createHash('sha256').update(bytes).digest('hex')
    const state = await this.loadState()
    const current = state.extensions[parsed.manifest.id]
    const token = randomUUID()
    this.staged.set(token, new Uint8Array(bytes))
    return {
      token,
      manifest: parsed.manifest,
      digest,
      compressedBytes: parsed.compressedBytes,
      unpackedBytes: parsed.unpackedBytes,
      currentVersion: current?.manifest.version,
      isDowngrade: Boolean(current && compareVersions(parsed.manifest.version, current.manifest.version) < 0),
      addedPermissions: parsed.manifest.permissions.filter((permission) => !current?.manifest.permissions.includes(permission)),
    }
  }

  discard(token: string) { this.staged.delete(token) }

  async install(token: string): Promise<InstalledExtensionRecord> {
    const bytes = this.staged.get(token)
    this.staged.delete(token)
    if (!bytes) throw new Error('The extension install review expired. Choose the package again.')
    const parsed = parseExtensionPackage(bytes)
    const digest = createHash('sha256').update(bytes).digest('hex')
    const state = await this.loadState()
    const previous = state.extensions[parsed.manifest.id]
    const timestamp = new Date().toISOString()
    const directory = `${parsed.manifest.version}-${digest.slice(0, 12)}`
    const finalRoot = join(this.packagesRoot(), parsed.manifest.id, directory)
    const temporaryRoot = join(this.packagesRoot(), parsed.manifest.id, `.install-${randomUUID()}`)
    await mkdir(temporaryRoot, { recursive: true })
    try {
      for (const [path, contents] of Object.entries(parsed.files)) {
        const target = join(temporaryRoot, normalizeExtensionPath(path))
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, contents, { mode: 0o600 })
      }
      if (existsSync(finalRoot)) await rm(finalRoot, { recursive: true, force: true })
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
    } catch (error) {
      await rm(temporaryRoot, { recursive: true, force: true })
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

  async requirePermission(id: string, permission: ExtensionPermission) {
    const manifest = await this.requireEnabled(id)
    if (!manifest.permissions.includes(permission)) throw new Error(`Extension ${id} does not have ${permission}.`)
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
}
