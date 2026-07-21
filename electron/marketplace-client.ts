import { createHash } from 'node:crypto'
import { MARKETPLACE_CATALOG_URL, MAX_MARKETPLACE_CATALOG_BYTES, compareMarketplaceVersions, parseMarketplaceCatalog, type MarketplaceCatalog } from '@neo-anki/extension-marketplace'
import { MAX_EXTENSION_PACKAGE_BYTES } from '../packages/extension-sdk/src/package-format.js'
import type { ExtensionManager, ExtensionInstallCandidate } from './extension-manager.js'

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>

const readBounded = async (response: Response, maximum: number, label: string) => {
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > maximum) throw new Error(`${label} is larger than allowed.`)
  if (!response.body) throw new Error(`${label} response was empty.`)
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let total = 0
  while (true) {
    const { value, done } = await reader.read(); if (done) break
    total += value.byteLength
    if (total > maximum) { await reader.cancel(); throw new Error(`${label} is larger than allowed.`) }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes
}

const allowedAssetResponse = (source: string) => {
  const url = new URL(source)
  return url.protocol === 'https:' && ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'].includes(url.hostname)
}

export class MarketplaceClient {
  constructor(private readonly extensionManager: ExtensionManager, private readonly fetcher: Fetcher, private readonly appVersion: string) {}

  private async catalog(): Promise<MarketplaceCatalog> {
    const response = await this.fetcher(MARKETPLACE_CATALOG_URL, { signal: AbortSignal.timeout(15_000), redirect: 'follow', headers: { accept: 'application/json' } })
    if (!response.ok) throw new Error(`Marketplace catalog returned ${response.status}.`)
    const bytes = await readBounded(response, MAX_MARKETPLACE_CATALOG_BYTES, 'Marketplace catalog')
    let value: unknown
    try { value = JSON.parse(new TextDecoder().decode(bytes)) }
    catch { throw new Error('Marketplace catalog is not valid JSON.') }
    return parseMarketplaceCatalog(value)
  }

  async list() { return (await this.catalog()).extensions.filter((extension) => compareMarketplaceVersions(this.appVersion, extension.release.minimumNeoAnkiVersion) >= 0) }

  async stage(id: string, version: string): Promise<ExtensionInstallCandidate> {
    const extension = (await this.catalog()).extensions.find(entry => entry.id === id && entry.release.version === version)
    if (!extension) throw new Error('That marketplace release is no longer approved. Refresh the catalog and try again.')
    if (compareMarketplaceVersions(this.appVersion, extension.release.minimumNeoAnkiVersion) < 0) throw new Error(`${extension.name} requires NeoAnki ${extension.release.minimumNeoAnkiVersion} or later.`)
    const response = await this.fetcher(extension.release.packageUrl, { signal: AbortSignal.timeout(60_000), redirect: 'follow', headers: { accept: 'application/octet-stream' } })
    if (!response.ok) throw new Error(`Extension package returned ${response.status}.`)
    if (!allowedAssetResponse(response.url || extension.release.packageUrl)) throw new Error('Extension package redirected to an unapproved download host.')
    const bytes = await readBounded(response, MAX_EXTENSION_PACKAGE_BYTES, 'Extension package')
    const digest = createHash('sha256').update(bytes).digest('hex')
    if (digest !== extension.release.sha256) throw new Error('Downloaded extension does not match the marketplace SHA-256 digest.')
    const candidate = await this.extensionManager.stage(bytes)
    const manifest = candidate.manifest
    if (manifest.id !== extension.id || manifest.name !== extension.name || manifest.publisher !== extension.publisher.name || manifest.version !== extension.release.version || manifest.publisherKey !== extension.release.publisherKey || JSON.stringify(manifest.permissions) !== JSON.stringify(extension.release.permissions)) {
      this.extensionManager.discard(candidate.token)
      throw new Error('Signed extension metadata does not match the approved marketplace listing.')
    }
    return candidate
  }
}
