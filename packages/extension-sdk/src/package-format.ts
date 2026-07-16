import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import type { ExtensionPackageManifest, ExtensionPermission } from './index.js'

export const EXTENSION_PACKAGE_SUFFIX = '.neoanki-extension'
export const MAX_EXTENSION_PACKAGE_BYTES = 5 * 1024 * 1024
export const MAX_EXTENSION_UNPACKED_BYTES = 15 * 1024 * 1024
export const MAX_EXTENSION_FILES = 128

export const extensionPermissions: ExtensionPermission[] = [
  'prompts:contribute',
  'imports:files',
  'exports:files',
  'planning:signals',
  'planning:policies',
  'sync:transport',
  'ui:pages',
  'ui:workspace-panels',
  'ui:create-panels',
  'ui:library-presets',
  'content:transactions',
]

const permissionSet = new Set<string>(extensionPermissions)
const extensionIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

export interface ParsedExtensionPackage {
  manifest: ExtensionPackageManifest
  files: Record<string, Uint8Array>
  compressedBytes: number
  unpackedBytes: number
}

export const normalizeExtensionPath = (value: string) => {
  if (!value || value.includes('\\') || value.includes('\0') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) throw new Error(`Unsafe extension path: ${value || '(empty)'}.`)
  const parts = value.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) throw new Error(`Unsafe extension path: ${value}.`)
  return parts.join('/')
}

const requireText = (value: unknown, field: string, maximum: number) => {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new Error(`Extension manifest field ${field} is invalid.`)
  return value.trim()
}

export const validateExtensionPackageManifest = (value: unknown): ExtensionPackageManifest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Extension manifest must be an object.')
  const candidate = value as Partial<ExtensionPackageManifest>
  if (candidate.format !== 'neo-anki-extension' || candidate.schemaVersion !== 1) throw new Error('Unsupported Neo Anki extension package format.')
  const id = requireText(candidate.id, 'id', 120)
  if (!extensionIdPattern.test(id)) throw new Error('Extension id must use lowercase reverse-domain notation.')
  const version = requireText(candidate.version, 'version', 64)
  if (!semverPattern.test(version)) throw new Error('Extension version must be valid semantic versioning.')
  if (candidate.sdkVersion !== 1) throw new Error('This extension requires an unsupported SDK version.')
  if (!Array.isArray(candidate.permissions) || candidate.permissions.some((permission) => !permissionSet.has(permission))) throw new Error('Extension manifest contains an unknown permission.')
  if (new Set(candidate.permissions).size !== candidate.permissions.length) throw new Error('Extension permissions must not contain duplicates.')
  const entry = normalizeExtensionPath(requireText(candidate.entry, 'entry', 240))
  if (!/\.(?:js|mjs)$/.test(entry)) throw new Error('Extension entry must be a JavaScript module.')
  const homepage = candidate.homepage?.trim()
  if (homepage) {
    try {
      const url = new URL(homepage)
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Extension homepage must use HTTP or HTTPS.')
    } catch (error) {
      if (error instanceof Error && error.message.includes('must use')) throw error
      throw new Error('Extension homepage must be a valid HTTP or HTTPS URL.')
    }
  }
  return {
    format: 'neo-anki-extension',
    schemaVersion: 1,
    id,
    name: requireText(candidate.name, 'name', 80),
    version,
    sdkVersion: 1,
    publisher: requireText(candidate.publisher, 'publisher', 100),
    permissions: [...candidate.permissions],
    entry,
    description: candidate.description ? requireText(candidate.description, 'description', 300) : undefined,
    homepage: homepage || undefined,
  }
}

export const parseExtensionPackage = (bytes: Uint8Array): ParsedExtensionPackage => {
  if (!bytes.byteLength || bytes.byteLength > MAX_EXTENSION_PACKAGE_BYTES) throw new Error('Extension package is empty or larger than 5 MB.')
  let filesSeen = 0
  let unpackedBytes = 0
  const unpacked = unzipSync(bytes, {
    filter: (file) => {
      filesSeen += 1
      unpackedBytes += file.originalSize
      if (filesSeen > MAX_EXTENSION_FILES) throw new Error('Extension package contains too many files.')
      if (unpackedBytes > MAX_EXTENSION_UNPACKED_BYTES) throw new Error('Extension package expands beyond 15 MB.')
      normalizeExtensionPath(file.name.endsWith('/') ? file.name.slice(0, -1) : file.name)
      return !file.name.endsWith('/')
    },
  })
  const files = Object.fromEntries(Object.entries(unpacked).map(([path, contents]) => [normalizeExtensionPath(path), contents]))
  const manifestBytes = files['manifest.json']
  if (!manifestBytes || manifestBytes.byteLength > 64 * 1024) throw new Error('Extension package needs a small root manifest.json.')
  let rawManifest: unknown
  try { rawManifest = JSON.parse(strFromU8(manifestBytes)) as unknown }
  catch { throw new Error('Extension manifest is not valid JSON.') }
  const manifest = validateExtensionPackageManifest(rawManifest)
  if (!files[manifest.entry]) throw new Error(`Extension entry ${manifest.entry} is missing from the package.`)
  return { manifest, files, compressedBytes: bytes.byteLength, unpackedBytes }
}

export const createExtensionPackage = (manifest: ExtensionPackageManifest, files: Record<string, Uint8Array | string>) => {
  const validated = validateExtensionPackageManifest(manifest)
  const contents: Record<string, Uint8Array> = { 'manifest.json': strToU8(`${JSON.stringify(validated, null, 2)}\n`) }
  for (const [path, value] of Object.entries(files)) contents[normalizeExtensionPath(path)] = typeof value === 'string' ? strToU8(value) : value
  if (!contents[validated.entry]) throw new Error(`Extension entry ${validated.entry} is missing.`)
  const archive = zipSync(contents, { level: 9 })
  parseExtensionPackage(archive)
  return archive
}
