import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'
import type { ExtensionPackageManifest, ExtensionPermissionV2 } from './index.js'

export const EXTENSION_PACKAGE_SUFFIX = '.neoanki-extension'
export const EXTENSION_SIGNATURE_PATH = 'signature.json'
export const MAX_EXTENSION_PACKAGE_BYTES = 12 * 1024 * 1024
export const MAX_EXTENSION_UNPACKED_BYTES = 32 * 1024 * 1024
export const MAX_EXTENSION_FILES = 128

export const extensionPermissions: ExtensionPermissionV2[] = ['study:read', 'study:signals', 'study:prompt-types', 'study:queue-policies', 'content:read', 'content:patch-own', 'content:migrate', 'media:create', 'network:fetch', 'secrets:device', 'config:sync', 'ui:settings', 'ui:review', 'ui:page', 'ui:create', 'ui:workspace', 'ui:migration']

const permissionSet = new Set<string>(extensionPermissions)
const extensionIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const commitPattern = /^(?:[a-f\d]{40}|[a-f\d]{64})$/i
const networkDomainPattern = /^(?:\*\.)?(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i

export interface ParsedExtensionPackage {
  manifest: ExtensionPackageManifest
  files: Record<string, Uint8Array>
  compressedBytes: number
  unpackedBytes: number
}

export interface ExtensionPackageSignatureV1 {
  version: 1
  algorithm: 'ed25519'
  publicKey: string
  unsignedDigest: string
  signature: string
}

export const parseExtensionPackageSignature = (bytes: Uint8Array): ExtensionPackageSignatureV1 => {
  let value: unknown
  try { value = JSON.parse(strFromU8(bytes)) }
  catch { throw new Error('Extension signature is not valid JSON.') }
  const candidate = value as Partial<ExtensionPackageSignatureV1>
  if (candidate.version !== 1 || candidate.algorithm !== 'ed25519' || typeof candidate.publicKey !== 'string' || !candidate.publicKey || !/^[a-f\d]{64}$/i.test(candidate.unsignedDigest || '') || typeof candidate.signature !== 'string' || !candidate.signature) throw new Error('Extension signature metadata is invalid.')
  return candidate as ExtensionPackageSignatureV1
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
  if (candidate.format !== 'neo-anki-extension' || candidate.schemaVersion !== 2 || candidate.sdkVersion !== 2) throw new Error('Only Neo Anki extension SDK 2 packages are supported.')
  const id = requireText(candidate.id, 'id', 120)
  if (!extensionIdPattern.test(id)) throw new Error('Extension id must use lowercase reverse-domain notation.')
  const version = requireText(candidate.version, 'version', 64)
  if (!semverPattern.test(version)) throw new Error('Extension version must be valid semantic versioning.')
  const permissions = candidate.permissions as ExtensionPermissionV2[] | undefined
  if (!Array.isArray(permissions) || permissions.some((permission) => !permissionSet.has(permission))) throw new Error('Extension manifest contains an unknown permission.')
  if (new Set(permissions).size !== permissions.length) throw new Error('Extension permissions must not contain duplicates.')
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
  const networkDomains = candidate.networkDomains
  if (networkDomains !== undefined) {
    if (!Array.isArray(networkDomains) || networkDomains.length > 32 || networkDomains.some((domain) => typeof domain !== 'string' || !networkDomainPattern.test(domain))) throw new Error('Extension network domains are invalid.')
    if (!permissions.includes('network:fetch') && networkDomains.length) throw new Error('Extension network domains require network:fetch.')
  }
  const common = { format: 'neo-anki-extension' as const, id, name: requireText(candidate.name, 'name', 80), version, publisher: requireText(candidate.publisher, 'publisher', 100), description: candidate.description ? requireText(candidate.description, 'description', 300) : undefined, homepage: homepage || undefined, networkDomains: networkDomains ? [...new Set(networkDomains.map((domain) => domain.toLowerCase()))] : undefined }
  const v2 = candidate
  const workerEntry = v2.workerEntry ? normalizeExtensionPath(requireText(v2.workerEntry, 'workerEntry', 240)) : undefined
  if (workerEntry && !/\.(?:js|mjs)$/.test(workerEntry)) throw new Error('Extension worker entry must be a JavaScript module.')
  const uiEntries = v2.uiEntries?.map((entry) => ({ id: requireText(entry.id, 'uiEntries.id', 80), surface: entry.surface, entry: normalizeExtensionPath(requireText(entry.entry, 'uiEntries.entry', 240)) }))
  if (uiEntries?.some((entry) => !['settings', 'review', 'page', 'create', 'workspace', 'migration'].includes(entry.surface) || !/\.(?:js|mjs)$/.test(entry.entry))) throw new Error('Extension UI entries are invalid.')
  const surfacePermission = { settings: 'ui:settings', review: 'ui:review', page: 'ui:page', create: 'ui:create', workspace: 'ui:workspace', migration: 'ui:migration' } as const
  if (uiEntries?.some((entry) => !permissions.includes(surfacePermission[entry.surface]))) throw new Error('Extension UI entries require their matching UI permission.')
  if (!workerEntry && !uiEntries?.length) throw new Error('SDK v2 extension needs a worker or UI entry.')
  if (uiEntries && new Set(uiEntries.map((entry) => entry.id)).size !== uiEntries.length) throw new Error('Extension UI entry ids must be unique.')
  const provenance = v2.provenance
  if (!provenance || typeof provenance !== 'object') throw new Error('SDK v2 extension provenance is required.')
  const sourceCommit = requireText(provenance.sourceCommit, 'provenance.sourceCommit', 128)
  const coreCommit = provenance.coreCommit ? requireText(provenance.coreCommit, 'provenance.coreCommit', 128) : undefined
  if (!commitPattern.test(sourceCommit) || (coreCommit && !commitPattern.test(coreCommit))) throw new Error('Extension provenance commits must be complete Git object ids.')
  const contributions = v2.contributions
  const parseContributions = (values: unknown, field: string) => values === undefined ? undefined : Array.isArray(values) && values.length <= 64 ? values.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Extension ${field} contributions are invalid.`)
    const entry = value as { id?: unknown; label?: unknown }
    return { id: requireText(entry.id, `${field}.id`, 80), label: requireText(entry.label, `${field}.label`, 80) }
  }) : (() => { throw new Error(`Extension ${field} contributions are invalid.`) })()
  const normalizedContributions = contributions ? {
    promptTypes: parseContributions(contributions.promptTypes, 'promptTypes'),
    queuePolicies: parseContributions(contributions.queuePolicies, 'queuePolicies'),
    libraryPresets: parseContributions(contributions.libraryPresets, 'libraryPresets'),
  } : undefined
  for (const values of Object.values(normalizedContributions || {})) if (values && new Set(values.map((entry) => entry.id)).size !== values.length) throw new Error('Extension contribution ids must be unique within their type.')
  if (normalizedContributions?.promptTypes?.length && !permissions.includes('study:prompt-types')) throw new Error('Prompt type contributions require study:prompt-types.')
  if (normalizedContributions?.queuePolicies?.length && !permissions.includes('study:queue-policies')) throw new Error('Queue policy contributions require study:queue-policies.')
  return { ...common, schemaVersion: 2, sdkVersion: 2, permissions: [...permissions], publisherKey: requireText(v2.publisherKey, 'publisherKey', 4096), workerEntry, uiEntries, contributions: normalizedContributions, provenance: { sourceCommit, coreCommit, buildSystem: requireText(provenance.buildSystem, 'provenance.buildSystem', 200) } }
}

export const parseExtensionPackage = (bytes: Uint8Array): ParsedExtensionPackage => {
  if (!bytes.byteLength || bytes.byteLength > MAX_EXTENSION_PACKAGE_BYTES) throw new Error('Extension package is empty or larger than 12 MB.')
  let filesSeen = 0
  let unpackedBytes = 0
  const unpacked = unzipSync(bytes, {
    filter: (file) => {
      filesSeen += 1
      unpackedBytes += file.originalSize
      if (filesSeen > MAX_EXTENSION_FILES) throw new Error('Extension package contains too many files.')
      if (unpackedBytes > MAX_EXTENSION_UNPACKED_BYTES) throw new Error('Extension package expands beyond 32 MB.')
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
  const entries = [manifest.workerEntry, ...(manifest.uiEntries || []).map((value) => value.entry)].filter((value): value is string => Boolean(value))
  for (const entry of entries) if (!files[entry]) throw new Error(`Extension entry ${entry} is missing from the package.`)
  return { manifest, files, compressedBytes: bytes.byteLength, unpackedBytes }
}

export const createExtensionPackage = (manifest: ExtensionPackageManifest, files: Record<string, Uint8Array | string>) => {
  const validated = validateExtensionPackageManifest(manifest)
  const raw: Record<string, Uint8Array> = { 'manifest.json': strToU8(`${JSON.stringify(validated, null, 2)}\n`) }
  for (const [path, value] of Object.entries(files)) raw[normalizeExtensionPath(path)] = typeof value === 'string' ? strToU8(value) : value
  const entries = [validated.workerEntry, ...(validated.uiEntries || []).map((value) => value.entry)].filter((value): value is string => Boolean(value))
  for (const entry of entries) if (!raw[entry]) throw new Error(`Extension entry ${entry} is missing.`)
  // ZIP stores DOS wall-clock fields without a timezone. Construct midnight in
  // the active timezone so every builder/runtime writes the same fields. A UTC
  // instant here shifts the stored hour by the local offset and makes signed
  // packages unverifiable when build and install happen in different zones.
  const epoch = new Date(1980, 0, 1, 0, 0, 0, 0)
  const contents: Zippable = Object.fromEntries(Object.keys(raw).sort().map((path) => [path, [raw[path], { level: 9, mtime: epoch }]]))
  const archive = zipSync(contents, { level: 9, mtime: epoch })
  parseExtensionPackage(archive)
  return archive
}
