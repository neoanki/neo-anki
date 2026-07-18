import {
  downloadEncryptedMedia,
  EncryptedWorkspaceSyncClient,
  applySyncConflictResolution,
  uploadEncryptedMedia,
  type EncryptedSyncTransport,
  type PortableSyncClientState,
} from '../../packages/sync-client/src/index.js'
import {
  exportAccountMasterKey,
  generateAccountMasterKey,
  generateDeviceSigningKeys,
  importAccountMasterKey,
  type EncryptedMediaChunk,
  type EncryptedMediaManifest,
  type EncryptedSnapshot,
  type EncryptedSnapshotChunk,
  type EncryptedSnapshotManifest,
  type PortableAccountKey,
  type SyncFieldConflict,
} from '../../packages/sync-protocol/src/index.js'
import { parseWorkspaceDocumentV4, type WorkspaceDocumentV4 } from '../../packages/compatibility-domain/src/index.js'
import type { MediaAsset } from '../types.js'

interface BrowserSyncConfig {
  version: 1
  endpoint: string
  accountId: string
  workspaceId: string
  actorId: string
  publicKeyJwk: JsonWebKey
  token: string
  recoveryToken: string
  baseline: WorkspaceDocumentV4
  client: PortableSyncClientState
  createdAt: string
  lastSuccessAt?: string
  lastError?: string
  pendingCommit?: { document: WorkspaceDocumentV4; client: PortableSyncClientState; sent: number; received: number; completedAt: string }
}

interface BrowserSyncRecord { config: BrowserSyncConfig; accountKey: CryptoKey; signingPrivateKey: CryptoKey }
export interface BrowserSyncStatus { configured: boolean; endpoint?: string; accountId?: string; workspaceId?: string; actorId?: string; pendingOperations: number; conflicts: SyncFieldConflict[]; pendingCommit?: boolean; lastSuccessAt?: string; lastError?: string }
export interface BrowserRecoveryBundle { version: 1; endpoint: string; accountId: string; workspaceId: string; accountKey: PortableAccountKey; recoveryToken: string }
export interface BrowserSyncStore { read(): Promise<BrowserSyncRecord | null>; write(value: BrowserSyncRecord): Promise<void>; clear(): Promise<void> }
export interface BrowserSynchronizedWorkspacePayload { document: WorkspaceDocumentV4; media: MediaAsset[]; sent: number; received: number }
export type CommitBrowserSynchronizedWorkspace = (payload: BrowserSynchronizedWorkspacePayload) => void | Promise<void>

const DB_NAME = 'neo-anki-secure-sync-v1'
const SYNC_REQUEST_TIMEOUT_MS = 30_000
const MAX_SYNC_RESPONSE_BYTES = 64 * 1024 * 1024
const STORE_NAME = 'device'
const RECORD_KEY = 'active'
const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, 1)
  request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME) }
  request.onerror = () => reject(request.error || new Error('Browser secure sync storage could not be opened.'))
  request.onsuccess = () => resolve(request.result)
})
const transact = async <T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) => {
  const database = await openDatabase()
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode)
      let value: T
      const request = action(transaction.objectStore(STORE_NAME))
      request.onsuccess = () => { value = request.result }
      request.onerror = () => reject(request.error || new Error('Browser secure sync storage request failed.'))
      transaction.oncomplete = () => resolve(value)
      transaction.onerror = () => reject(transaction.error || new Error('Browser secure sync storage failed.'))
      transaction.onabort = () => reject(transaction.error || new Error('Browser secure sync storage transaction was aborted.'))
    })
  } finally { database.close() }
}

export class IndexedDbBrowserSyncStore implements BrowserSyncStore {
  async read() { return (await transact<BrowserSyncRecord | undefined>('readonly', (store) => store.get(RECORD_KEY))) || null }
  write(value: BrowserSyncRecord) { return transact<IDBValidKey>('readwrite', (store) => store.put(value, RECORD_KEY)).then(() => undefined) }
  clear() { return transact<undefined>('readwrite', (store) => store.delete(RECORD_KEY)).then(() => undefined) }
}

const textToBase64Url = (value: string) => {
  const bytes = new TextEncoder().encode(value); let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}
const base64UrlToText = (value: string) => {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(normalized); return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)))
}
const safeEndpoint = (value: string) => {
  const url = new URL(value); const local = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('Sync requires HTTPS, except for a local development service.')
  url.pathname = url.pathname.replace(/\/+$/, ''); url.search = ''; url.hash = ''; return url.toString().replace(/\/$/, '')
}
const encodeRecovery = (value: BrowserRecoveryBundle) => textToBase64Url(JSON.stringify(value))
export const parseBrowserRecoveryBundle = (value: string): BrowserRecoveryBundle => {
  try {
    const result = JSON.parse(base64UrlToText(value.trim())) as BrowserRecoveryBundle
    if (result.version !== 1 || !result.accountId || !result.workspaceId || !result.recoveryToken || result.accountKey?.algorithm !== 'AES-GCM-256') throw new Error()
    return result
  } catch { throw new Error('The recovery bundle is invalid.') }
}
const dataUrlBytes = (value: string) => {
  const match = /^data:[^;,]*(;base64)?,(.*)$/s.exec(value); if (!match) throw new Error('Sync media is not available as local bytes.')
  if (match[1]) return Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0))
  return new TextEncoder().encode(decodeURIComponent(match[2]))
}
const bytesDataUrl = (mimeType: string, bytes: Uint8Array) => { let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return `data:${mimeType};base64,${btoa(binary)}` }
const boundedJson = async (response: Response) => {
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > MAX_SYNC_RESPONSE_BYTES) throw new Error('Sync service response exceeds the 64 MiB safety limit.')
  if (!response.body) return {}
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0
  while (true) {
    const { done, value } = await reader.read(); if (done) break
    length += value.byteLength; if (length > MAX_SYNC_RESPONSE_BYTES) { await reader.cancel(); throw new Error('Sync service response exceeds the 64 MiB safety limit.') }
    chunks.push(value)
  }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  try { return JSON.parse(new TextDecoder().decode(bytes)) as unknown } catch { return {} }
}

export class BrowserSyncManager {
  private syncQueue: Promise<unknown> = Promise.resolve()
  constructor(private readonly store: BrowserSyncStore = new IndexedDbBrowserSyncStore(), private readonly fetcher: typeof fetch = globalThis.fetch) {}

  private async request<T>(endpoint: string, path: string, token: string | null, method: string, body?: unknown): Promise<T> {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), SYNC_REQUEST_TIMEOUT_MS)
    let response: Response
    try { response = await this.fetcher(`${endpoint}${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', cache: 'no-store', credentials: 'omit', signal: controller.signal }) }
    catch (error) { if (controller.signal.aborted) throw new Error('Sync service request timed out. Check the connection and try again.'); throw error }
    finally { clearTimeout(timeout) }
    const result = await boundedJson(response) as { error?: string }
    if (!response.ok) throw new Error(result.error || `Sync service returned HTTP ${response.status}.`)
    return result as T
  }

  private transport(endpoint: string, token: string): EncryptedSyncTransport & { putMediaChunk(chunk: EncryptedMediaChunk): Promise<void>; commitMediaManifest(manifest: EncryptedMediaManifest): Promise<void>; getMediaChunk(mediaId: string, index: number): Promise<EncryptedMediaChunk | null> } {
    return {
      push: async (operations) => (await this.request<{ cursor: Record<string, number> }>(endpoint, '/v1/operations', token, 'POST', { operations })).cursor,
      pull: (after, limit) => this.request(endpoint, '/v1/pull', token, 'POST', { after, limit }),
      acknowledge: async (cursor) => { await this.request(endpoint, '/v1/acknowledgements', token, 'POST', { cursor }) },
      devicePublicKey: async (actorId) => crypto.subtle.importKey('jwk', await this.request<JsonWebKey>(endpoint, `/v1/devices/${encodeURIComponent(actorId)}/key`, token, 'GET'), { name: 'Ed25519' }, false, ['verify']),
      putSnapshot: async (snapshot: EncryptedSnapshot) => { await this.request(endpoint, '/v1/snapshots', token, 'POST', { snapshot }) },
      putSnapshotChunk: async (chunk: EncryptedSnapshotChunk) => { await this.request(endpoint, `/v1/snapshots/${encodeURIComponent(chunk.snapshotId)}/chunks/${chunk.index}`, token, 'PUT', { chunk }) },
      commitSnapshotManifest: async (manifest: EncryptedSnapshotManifest) => { await this.request(endpoint, '/v1/snapshot-manifests', token, 'POST', { manifest }) },
      getSnapshotChunk: async (snapshotId: string, index: number) => (await this.request<{ chunk: EncryptedSnapshotChunk | null }>(endpoint, `/v1/snapshots/${encodeURIComponent(snapshotId)}/chunks/${index}`, token, 'GET')).chunk,
      putMediaChunk: async (chunk) => { await this.request(endpoint, `/v1/media/${encodeURIComponent(chunk.mediaId)}/chunks/${chunk.index}`, token, 'PUT', { chunk }) },
      commitMediaManifest: async (manifest) => { await this.request(endpoint, '/v1/media-manifests', token, 'POST', { manifest }) },
      getMediaChunk: async (mediaId, index) => (await this.request<{ chunk: EncryptedMediaChunk | null }>(endpoint, `/v1/media/${encodeURIComponent(mediaId)}/chunks/${index}`, token, 'GET')).chunk,
    }
  }

  private async synchronizedMedia(document: WorkspaceDocumentV4, localMedia: MediaAsset[], accountKey: CryptoKey, transport: ReturnType<BrowserSyncManager['transport']>) {
    const localById = new Map(localMedia.map((asset) => [asset.id, asset])); const synchronizedMedia: MediaAsset[] = []
    for (const descriptor of document.workspace.media) {
      const local = localById.get(descriptor.id)
      if (local && local.hash === descriptor.sha256 && local.byteLength === descriptor.byteLength) synchronizedMedia.push(local)
      else {
        const bytes = await downloadEncryptedMedia(accountKey, transport, { id: descriptor.id, sha256: descriptor.sha256, byteLength: descriptor.byteLength })
        synchronizedMedia.push({ id: descriptor.id, filename: descriptor.filename, mimeType: descriptor.mimeType, dataUrl: bytesDataUrl(descriptor.mimeType, bytes), byteLength: descriptor.byteLength, hash: descriptor.sha256, altText: '', createdAt: descriptor.createdAt, updatedAt: descriptor.updatedAt })
      }
    }
    return synchronizedMedia
  }

  private async finishPendingCommit(record: BrowserSyncRecord, localMedia: MediaAsset[], transport: ReturnType<BrowserSyncManager['transport']>, commit: CommitBrowserSynchronizedWorkspace) {
    const { config, accountKey, signingPrivateKey } = record; const pending = config.pendingCommit
    if (!pending) return null
    const payload: BrowserSynchronizedWorkspacePayload = { document: pending.document, media: await this.synchronizedMedia(pending.document, localMedia, accountKey, transport), sent: pending.sent, received: pending.received }
    await commit(payload)
    config.baseline = pending.document; config.client = pending.client; config.lastSuccessAt = pending.completedAt; config.lastError = undefined; delete config.pendingCommit
    await this.store.write(record)
    const client = new EncryptedWorkspaceSyncClient(config.baseline, config.actorId, accountKey, signingPrivateKey, transport, config.client)
    try { await client.acknowledge() } catch (error) { config.lastError = `Workspace committed, but server acknowledgement will retry: ${error instanceof Error ? error.message : 'request failed'}`; await this.store.write(record) }
    return { ...payload, status: await this.status() }
  }

  async createAccount(endpointInput: string, documentInput: unknown, media: MediaAsset[], commit: CommitBrowserSynchronizedWorkspace = async () => undefined) {
    if (await this.store.read()) throw new Error('This browser is already connected to encrypted sync.')
    const endpoint = safeEndpoint(endpointInput); const document = parseWorkspaceDocumentV4(documentInput)
    const exportableKey = await generateAccountMasterKey(); const portable = await exportAccountMasterKey(exportableKey); const accountKey = await importAccountMasterKey(portable, false)
    const exportableSigning = await generateDeviceSigningKeys(); const privateBytes = await crypto.subtle.exportKey('pkcs8', exportableSigning.privateKey)
    const signingPrivateKey = await crypto.subtle.importKey('pkcs8', privateBytes, { name: 'Ed25519' }, false, ['sign'])
    const actorId = `browser-${crypto.randomUUID()}`; const publicKeyJwk = await crypto.subtle.exportKey('jwk', exportableSigning.publicKey)
    const session = await this.request<{ accountId: string; workspaceId: string; token: string; recoveryToken: string }>(endpoint, '/v1/accounts', null, 'POST', { workspaceId: document.workspace.workspaceId, actorId, publicKeyJwk })
    const config: BrowserSyncConfig = { version: 1, endpoint, accountId: session.accountId, workspaceId: session.workspaceId, actorId, publicKeyJwk, token: session.token, recoveryToken: session.recoveryToken, baseline: document, client: { version: 1, nextSequence: 1, cursor: {}, outbox: [] }, createdAt: new Date().toISOString() }
    await this.store.write({ config, accountKey, signingPrivateKey })
    try { await this.synchronize(document, media, [], commit) } catch (error) { await this.store.clear(); throw error }
    return { recoveryBundle: encodeRecovery({ version: 1, endpoint, accountId: session.accountId, workspaceId: session.workspaceId, accountKey: portable, recoveryToken: session.recoveryToken }), status: await this.status() }
  }

  async recoverAccount(bundleText: string, placeholderInput: unknown, commit: CommitBrowserSynchronizedWorkspace = async () => undefined) {
    if (await this.store.read()) throw new Error('This browser is already connected to encrypted sync.')
    const recovery = parseBrowserRecoveryBundle(bundleText); const endpoint = safeEndpoint(recovery.endpoint); const placeholder = parseWorkspaceDocumentV4(placeholderInput); placeholder.workspace.workspaceId = recovery.workspaceId
    const accountKey = await importAccountMasterKey(recovery.accountKey, false); const signing = await generateDeviceSigningKeys(); const privateBytes = await crypto.subtle.exportKey('pkcs8', signing.privateKey)
    const signingPrivateKey = await crypto.subtle.importKey('pkcs8', privateBytes, { name: 'Ed25519' }, false, ['sign']); const actorId = `browser-${crypto.randomUUID()}`; const publicKeyJwk = await crypto.subtle.exportKey('jwk', signing.publicKey)
    const session = await this.request<{ token: string }>(endpoint, '/v1/recovery/devices', null, 'POST', { accountId: recovery.accountId, workspaceId: recovery.workspaceId, recoveryToken: recovery.recoveryToken, actorId, publicKeyJwk })
    const probe = await this.request<{ latestSnapshot?: EncryptedSnapshot; latestSnapshotManifest?: EncryptedSnapshotManifest }>(endpoint, '/v1/pull', session.token, 'POST', { after: {}, limit: 1 })
    if (!probe.latestSnapshot && !probe.latestSnapshotManifest) throw new Error('This sync account has no encrypted bootstrap snapshot yet. Sync the original device once.')
    const config: BrowserSyncConfig = { version: 1, endpoint, accountId: recovery.accountId, workspaceId: recovery.workspaceId, actorId, publicKeyJwk, token: session.token, recoveryToken: recovery.recoveryToken, baseline: placeholder, client: { version: 1, nextSequence: 1, cursor: {}, outbox: [] }, createdAt: new Date().toISOString() }
    await this.store.write({ config, accountKey, signingPrivateKey })
    try { return await this.synchronize(placeholder, [], [], commit) } catch (error) { if (!(await this.store.read())?.config.pendingCommit) await this.store.clear(); throw error }
  }

  async synchronize(currentInput: unknown, localMedia: MediaAsset[], resolvedConflictIds: string[] = [], commit: CommitBrowserSynchronizedWorkspace = async () => undefined) {
    const task = this.syncQueue.catch(() => undefined).then(() => this.synchronizeOnce(currentInput, localMedia, resolvedConflictIds, commit))
    this.syncQueue = task
    return task
  }

  private async synchronizeOnce(currentInput: unknown, localMedia: MediaAsset[], resolvedConflictIds: string[], commit: CommitBrowserSynchronizedWorkspace) {
    const record = await this.store.read(); if (!record) throw new Error('Encrypted sync is not configured in this browser.')
    const { config, accountKey, signingPrivateKey } = record; const current = parseWorkspaceDocumentV4(currentInput)
    if (current.workspace.workspaceId !== config.workspaceId) throw new Error('Local workspace does not match the configured sync account.')
    const transport = this.transport(config.endpoint, config.token)
    const recovered = await this.finishPendingCommit(record, localMedia, transport, commit)
    if (recovered) return recovered
    const client = new EncryptedWorkspaceSyncClient(config.baseline, config.actorId, accountKey, signingPrivateKey, transport, config.client)
    try {
      await client.capture(current, resolvedConflictIds)
      config.baseline = current; config.client = client.state(); await this.store.write(record)
      for (const asset of localMedia) await uploadEncryptedMedia(accountKey, transport, { id: asset.id, sha256: asset.hash, byteLength: asset.byteLength, bytes: dataUrlBytes(asset.dataUrl) })
      const result = await client.synchronize(); const synchronizedMedia = await this.synchronizedMedia(result.document, localMedia, accountKey, transport)
      const completedAt = new Date().toISOString(); config.pendingCommit = { document: result.document, client: client.state(), sent: result.sent, received: result.received, completedAt }; config.lastError = undefined; await this.store.write(record)
      const payload: BrowserSynchronizedWorkspacePayload = { document: result.document, media: synchronizedMedia, sent: result.sent, received: result.received }
      await commit(payload)
      config.baseline = result.document; config.client = config.pendingCommit.client; config.lastSuccessAt = completedAt; delete config.pendingCommit; await this.store.write(record)
      try { await client.acknowledge() } catch (error) { config.lastError = `Workspace committed, but server acknowledgement will retry: ${error instanceof Error ? error.message : 'request failed'}`; await this.store.write(record) }
      return { ...payload, status: await this.status() }
    } catch (error) { config.client = client.state(); config.lastError = error instanceof Error ? error.message : 'Sync failed.'; await this.store.write(record); throw error }
  }

  async status(): Promise<BrowserSyncStatus> { const record = await this.store.read(); const config = record?.config; return config ? { configured: true, endpoint: config.endpoint, accountId: config.accountId, workspaceId: config.workspaceId, actorId: config.actorId, pendingOperations: config.client.outbox.length, conflicts: structuredClone(config.client.conflicts || []), pendingCommit: Boolean(config.pendingCommit), lastSuccessAt: config.lastSuccessAt, lastError: config.lastError } : { configured: false, pendingOperations: 0, conflicts: [] } }
  async resolveConflict(conflictId: string, choice: 'existing' | 'incoming', currentInput: unknown, localMedia: MediaAsset[], commit: CommitBrowserSynchronizedWorkspace = async () => undefined) {
    const record = await this.store.read(); if (!record) throw new Error('Encrypted sync is not configured in this browser.')
    const conflict = (record.config.client.conflicts || []).find((value) => value.id === conflictId); if (!conflict) throw new Error('The sync conflict was already resolved or is unavailable.')
    const resolved = applySyncConflictResolution(parseWorkspaceDocumentV4(currentInput), conflict, choice)
    try { return await this.synchronize(resolved, localMedia, [conflictId], commit) }
    catch (error) {
      if ((await this.store.read())?.config.pendingCommit) throw error
      const payload = { document: resolved, media: localMedia, sent: 0, received: 0 }; await commit(payload); return { ...payload, status: await this.status() }
    }
  }
  async listDevices() { const record = await this.store.read(); if (!record) return []; return (await this.request<{ devices: Array<{ actorId: string; createdAt: string; revokedAt?: string; current: boolean }> }>(record.config.endpoint, '/v1/devices', record.config.token, 'GET')).devices }
  async rotateRecoveryBundle(currentBundleText: string) {
    const record = await this.store.read(); if (!record) throw new Error('Encrypted sync is not configured.')
    const current = parseBrowserRecoveryBundle(currentBundleText)
    if (current.accountId !== record.config.accountId || current.workspaceId !== record.config.workspaceId || current.recoveryToken !== record.config.recoveryToken) throw new Error('Paste this account’s current recovery key before replacing it.')
    const result = await this.request<{ recoveryToken: string }>(record.config.endpoint, '/v1/recovery/rotate', record.config.token, 'POST')
    record.config.recoveryToken = result.recoveryToken; await this.store.write(record)
    return encodeRecovery({ ...current, endpoint: record.config.endpoint, recoveryToken: result.recoveryToken })
  }
  async revokeDevice(actorId: string) { const record = await this.store.read(); if (!record) throw new Error('Encrypted sync is not configured.'); await this.request(record.config.endpoint, '/v1/devices/revoke', record.config.token, 'POST', { actorId }) }
  async deleteAccount() { const record = await this.store.read(); if (!record) return; await this.request(record.config.endpoint, '/v1/account', record.config.token, 'DELETE'); await this.store.clear() }
  disconnect() { return this.store.clear() }
}

export class MemoryBrowserSyncStore implements BrowserSyncStore {
  value: BrowserSyncRecord | null = null
  async read() { return this.value }
  async write(value: BrowserSyncRecord) { this.value = structuredClone(value) }
  async clear() { this.value = null }
}

/** One coordinator per browser context prevents independent UI surfaces from racing IndexedDB state. */
export const browserSync = new BrowserSyncManager()
