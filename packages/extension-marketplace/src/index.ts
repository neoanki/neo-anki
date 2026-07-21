export const MARKETPLACE_CATALOG_URL = 'https://raw.githubusercontent.com/neoanki/extensions/main/catalog.json'
export const MARKETPLACE_REPOSITORY_URL = 'https://github.com/neoanki/extensions'
export const MAX_MARKETPLACE_CATALOG_BYTES = 2 * 1024 * 1024
export const MAX_MARKETPLACE_EXTENSIONS = 5000

export const marketplaceCategories = ['study', 'authoring', 'import-export', 'planning', 'analytics', 'accessibility', 'integration', 'appearance'] as const
export type MarketplaceCategory = typeof marketplaceCategories[number]
export type MarketplacePermission = 'study:read' | 'study:signals' | 'study:prompt-types' | 'study:queue-policies' | 'content:read' | 'content:patch-own' | 'content:migrate' | 'media:create' | 'network:fetch' | 'secrets:device' | 'config:sync' | 'ui:settings' | 'ui:review' | 'ui:page' | 'ui:create' | 'ui:workspace' | 'ui:migration'

export interface MarketplaceExtension {
  id: string
  name: string
  summary: string
  description: string
  publisher: { name: string; url: string }
  repository: string
  homepage?: string
  license: string
  categories: MarketplaceCategory[]
  tags: string[]
  release: {
    version: string
    publishedAt: string
    packageUrl: string
    sha256: string
    publisherKey: string
    minimumNeoAnkiVersion: string
    permissions: MarketplacePermission[]
  }
}

export interface MarketplaceCatalog {
  format: 'neo-anki-extension-catalog'
  schemaVersion: 1
  extensions: MarketplaceExtension[]
}

const idPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const packagePattern = /^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\/[^/]+\/[^/]+\.neoanki-extension$/
const permissionSet = new Set<MarketplacePermission>(['study:read', 'study:signals', 'study:prompt-types', 'study:queue-policies', 'content:read', 'content:patch-own', 'content:migrate', 'media:create', 'network:fetch', 'secrets:device', 'config:sync', 'ui:settings', 'ui:review', 'ui:page', 'ui:create', 'ui:workspace', 'ui:migration'])
const categorySet = new Set<MarketplaceCategory>(marketplaceCategories)

const fail = (message: string): never => { throw new Error(message) }
const record = (value: unknown, field: string): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail(`${field} must be an object.`)
const text = (value: unknown, field: string, maximum: number) => typeof value === 'string' && value.trim() && value.length <= maximum ? value.trim() : fail(`${field} must be non-empty text of at most ${maximum} characters.`)
const strings = (value: unknown, field: string, maximum: number) => Array.isArray(value) && value.length <= maximum && value.every(item => typeof item === 'string') && new Set(value).size === value.length ? value as string[] : fail(`${field} must be a unique string array with at most ${maximum} values.`)
const url = (value: unknown, field: string) => {
  const source = text(value, field, 500)
  try { const parsed = new URL(source); if (parsed.protocol !== 'https:') fail(`${field} must use HTTPS.`); return source }
  catch (error) { if (error instanceof Error && error.message.endsWith('use HTTPS.')) throw error; return fail(`${field} must be a valid HTTPS URL.`) }
}

const parseEntry = (value: unknown): MarketplaceExtension => {
  const candidate = record(value, 'Marketplace extension')
  const id = text(candidate.id, 'Extension id', 120)
  if (!idPattern.test(id)) fail(`${id}: extension id must use lowercase reverse-domain notation.`)
  const publisher = record(candidate.publisher, `${id}.publisher`)
  const repository = url(candidate.repository, `${id}.repository`)
  const repositoryUrl = new URL(repository)
  if (repositoryUrl.hostname !== 'github.com' || repositoryUrl.pathname.split('/').filter(Boolean).length !== 2) fail(`${id}.repository must be a GitHub repository URL.`)
  const release = record(candidate.release, `${id}.release`)
  const version = text(release.version, `${id}.release.version`, 64)
  const minimumNeoAnkiVersion = text(release.minimumNeoAnkiVersion, `${id}.release.minimumNeoAnkiVersion`, 64)
  if (!semverPattern.test(version) || !semverPattern.test(minimumNeoAnkiVersion)) fail(`${id}: release versions must use semantic versioning.`)
  const packageUrl = url(release.packageUrl, `${id}.release.packageUrl`)
  if (!packagePattern.test(packageUrl)) fail(`${id}: package URL must be an immutable GitHub Release asset.`)
  const packageUrlValue = new URL(packageUrl)
  if (packageUrlValue.pathname.split('/').filter(Boolean).slice(0, 2).join('/').toLocaleLowerCase() !== repositoryUrl.pathname.split('/').filter(Boolean).join('/').toLocaleLowerCase()) fail(`${id}: package release must belong to the declared source repository.`)
  const sha256 = text(release.sha256, `${id}.release.sha256`, 64)
  if (!/^[a-f0-9]{64}$/.test(sha256)) fail(`${id}: package digest must be a lowercase SHA-256 value.`)
  const publishedAt = text(release.publishedAt, `${id}.release.publishedAt`, 64)
  if (!Number.isFinite(Date.parse(publishedAt))) fail(`${id}: release date is invalid.`)
  const categories = strings(candidate.categories, `${id}.categories`, 4)
  if (!categories.length || categories.some(item => !categorySet.has(item as MarketplaceCategory))) fail(`${id}: unsupported marketplace category.`)
  const tags = strings(candidate.tags, `${id}.tags`, 12)
  if (tags.some(item => item.length > 32 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item))) fail(`${id}: marketplace tags must be lowercase slugs.`)
  const permissions = strings(release.permissions, `${id}.release.permissions`, permissionSet.size)
  if (permissions.some(item => !permissionSet.has(item as MarketplacePermission))) fail(`${id}: unsupported extension permission.`)
  return {
    id,
    name: text(candidate.name, `${id}.name`, 80),
    summary: text(candidate.summary, `${id}.summary`, 160),
    description: text(candidate.description, `${id}.description`, 1000),
    publisher: { name: text(publisher.name, `${id}.publisher.name`, 100), url: url(publisher.url, `${id}.publisher.url`) },
    repository,
    homepage: candidate.homepage === undefined ? undefined : url(candidate.homepage, `${id}.homepage`),
    license: text(candidate.license, `${id}.license`, 64),
    categories: categories as MarketplaceCategory[], tags,
    release: { version, publishedAt, packageUrl, sha256, publisherKey: text(release.publisherKey, `${id}.release.publisherKey`, 4096), minimumNeoAnkiVersion, permissions: permissions as MarketplacePermission[] },
  }
}

export const parseMarketplaceCatalog = (value: unknown): MarketplaceCatalog => {
  const candidate = record(value, 'Marketplace catalog')
  const rawExtensions = candidate.extensions
  if (candidate.format !== 'neo-anki-extension-catalog' || candidate.schemaVersion !== 1) fail('Marketplace catalog format is unsupported or invalid.')
  if (!Array.isArray(rawExtensions)) throw new Error('Marketplace catalog extensions must be an array.')
  const rawList: unknown[] = rawExtensions
  if (rawList.length > MAX_MARKETPLACE_EXTENSIONS) fail('Marketplace catalog has too many extensions.')
  const extensions = rawList.map(parseEntry)
  if (new Set(extensions.map(extension => extension.id)).size !== extensions.length) fail('Marketplace extension ids must be unique.')
  return { format: 'neo-anki-extension-catalog', schemaVersion: 1, extensions }
}

export const compareMarketplaceVersions = (left: string, right: string) => {
  const parse = (version: string) => { const [coreAndPre] = version.split('+'); const [core, pre = ''] = coreAndPre.split('-', 2); return { core: core.split('.').map(Number), pre: pre ? pre.split('.') : [] } }
  const a = parse(left); const b = parse(right)
  for (let index = 0; index < 3; index += 1) if (a.core[index] !== b.core[index]) return a.core[index] - b.core[index]
  if (!a.pre.length || !b.pre.length) return a.pre.length ? -1 : b.pre.length ? 1 : 0
  for (let index = 0; index < Math.max(a.pre.length, b.pre.length); index += 1) {
    if (a.pre[index] === undefined || b.pre[index] === undefined) return a.pre[index] === undefined ? -1 : 1
    if (a.pre[index] === b.pre[index]) continue
    const an = /^\d+$/.test(a.pre[index]) ? Number(a.pre[index]) : null; const bn = /^\d+$/.test(b.pre[index]) ? Number(b.pre[index]) : null
    if (an !== null || bn !== null) return an === null ? 1 : bn === null ? -1 : an - bn
    return a.pre[index].localeCompare(b.pre[index])
  }
  return 0
}

export const filterMarketplaceExtensions = (extensions: readonly MarketplaceExtension[], query: string, category?: MarketplaceCategory | 'all') => {
  const normalized = query.trim().toLocaleLowerCase()
  return extensions.filter(extension => (!category || category === 'all' || extension.categories.includes(category)) && (!normalized || [extension.name, extension.summary, extension.description, extension.publisher.name, extension.id, ...extension.tags].some(value => value.toLocaleLowerCase().includes(normalized))))
}
