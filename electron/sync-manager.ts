import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { open, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  downloadEncryptedMedia,
  EncryptedWorkspaceSyncClient,
  applySyncConflictResolution,
  uploadEncryptedMedia,
  type EncryptedSyncTransport,
  type PortableSyncClientState,
} from '../packages/sync-client/src/index.js'
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
} from '../packages/sync-protocol/src/index.js'
import { parseWorkspaceDocumentV4, type WorkspaceDocumentV4 } from '../packages/compatibility-domain/src/index.js'
import type { MediaAsset } from '../src/types.js'

export interface SyncSecretProtector { available(): boolean; seal(value: string): Uint8Array; open(value: Uint8Array): string }
interface SyncSecrets { token: string; accountKey: PortableAccountKey; signingPrivateKey: string; recoveryToken: string }
interface PendingSyncCommit {
  document: WorkspaceDocumentV4
  client: PortableSyncClientState
  sent: number
  received: number
  completedAt: string
}
interface SyncConfig {
  version: 1; endpoint: string; accountId: string; workspaceId: string; actorId: string; publicKeyJwk: JsonWebKey
  sealedSecrets: string; baseline: WorkspaceDocumentV4; client: PortableSyncClientState; createdAt: string; lastSuccessAt?: string; lastError?: string
  pendingCommit?: PendingSyncCommit
}
export interface SyncStatus { configured: boolean; endpoint?: string; accountId?: string; workspaceId?: string; actorId?: string; pendingOperations: number; conflicts: SyncFieldConflict[]; pendingCommit?: boolean; lastSuccessAt?: string; lastError?: string }
export interface RecoveryBundle { version: 1; endpoint: string; accountId: string; workspaceId: string; accountKey: PortableAccountKey; recoveryToken: string }
export interface SynchronizedWorkspacePayload { document: WorkspaceDocumentV4; media: MediaAsset[]; sent: number; received: number }
export type CommitSynchronizedWorkspace = (payload: SynchronizedWorkspacePayload) => void | Promise<void>

const fromBase64 = (value: string) => new Uint8Array(Buffer.from(value, 'base64'))
const SYNC_REQUEST_TIMEOUT_MS = 30_000
const MAX_SYNC_RESPONSE_BYTES = 64 * 1024 * 1024
const toBase64 = (value: Uint8Array) => Buffer.from(value).toString('base64')
const dataUrlBytes = (value: string) => { const match = /^data:[^;,]*(;base64)?,(.*)$/s.exec(value); if (!match) throw new Error('Sync media is not available as local bytes.'); return new Uint8Array(match[1] ? Buffer.from(match[2], 'base64') : Buffer.from(decodeURIComponent(match[2]))) }
const bytesDataUrl = (mimeType: string, bytes: Uint8Array) => `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`
const safeEndpoint = (value: string) => {
  const url = new URL(value); const local = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('Sync requires HTTPS, except for a local development service.')
  url.pathname = url.pathname.replace(/\/+$/, ''); url.search = ''; url.hash = ''; return url.toString().replace(/\/$/, '')
}
const encodeRecovery = (value: RecoveryBundle) => Buffer.from(JSON.stringify(value)).toString('base64url')
const decodeRecovery = (value: string): RecoveryBundle => {
  try { const result = JSON.parse(Buffer.from(value.trim(), 'base64url').toString('utf8')) as RecoveryBundle; if (result.version !== 1 || !result.accountId || !result.workspaceId || !result.recoveryToken) throw new Error(); return result }
  catch { throw new Error('The recovery bundle is invalid.') }
}
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
  const bytes = Buffer.allocUnsafe(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  try { return JSON.parse(bytes.toString('utf8')) as unknown } catch { return {} }
}

export class DesktopSyncManager {
  private readonly path: string
  private syncQueue: Promise<unknown> = Promise.resolve()
  constructor(userDataRoot: string, private readonly protector: SyncSecretProtector, private readonly fetcher: typeof fetch = globalThis.fetch) { this.path = join(userDataRoot, 'sync', 'config.json') }

  private requireProtection() { if (!this.protector.available()) throw new Error('Encrypted sync requires secure operating-system key storage on this device.') }
  private async readConfig() { if (!existsSync(this.path)) return null; const value = JSON.parse(await readFile(this.path, 'utf8')) as SyncConfig; if (value.version !== 1) throw new Error('Sync configuration requires a newer Neo Anki version.'); return value }
  private async writeConfig(config: SyncConfig) {
    const directoryPath = dirname(this.path); mkdirSync(directoryPath, { recursive: true }); const temporary = `${this.path}.${randomUUID()}.next`
    const file = await open(temporary, 'wx', 0o600)
    try { await file.writeFile(`${JSON.stringify(config)}\n`, 'utf8'); await file.sync() }
    catch (error) { await file.close().catch(() => undefined); await rm(temporary, { force: true }); throw error }
    await file.close()
    await rename(temporary, this.path)
    try { const directory = await open(directoryPath, 'r'); try { await directory.sync() } finally { await directory.close() } }
    catch (error) { if (!['EINVAL', 'ENOTSUP', 'EPERM'].includes((error as NodeJS.ErrnoException).code || '')) throw error }
  }
  private secrets(config: SyncConfig): SyncSecrets { this.requireProtection(); return JSON.parse(this.protector.open(fromBase64(config.sealedSecrets))) as SyncSecrets }
  private seal(secrets: SyncSecrets) { this.requireProtection(); return toBase64(this.protector.seal(JSON.stringify(secrets))) }
  private async request<T>(endpoint: string, path: string, token: string | null, method: string, body?: unknown): Promise<T> {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), SYNC_REQUEST_TIMEOUT_MS)
    let response: Response
    try { response = await this.fetcher(`${endpoint}${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', cache: 'no-store', signal: controller.signal }) }
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

  private async synchronizedMedia(document: WorkspaceDocumentV4, localMedia: MediaAsset[], accountKey: CryptoKey, transport: ReturnType<DesktopSyncManager['transport']>) {
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

  private async finishPendingCommit(config: SyncConfig, localMedia: MediaAsset[], accountKey: CryptoKey, privateKey: CryptoKey, transport: ReturnType<DesktopSyncManager['transport']>, commit: CommitSynchronizedWorkspace) {
    const pending = config.pendingCommit
    if (!pending) return null
    const payload: SynchronizedWorkspacePayload = { document: pending.document, media: await this.synchronizedMedia(pending.document, localMedia, accountKey, transport), sent: pending.sent, received: pending.received }
    await commit(payload)
    config.baseline = pending.document; config.client = pending.client; config.lastSuccessAt = pending.completedAt; config.lastError = undefined; delete config.pendingCommit
    await this.writeConfig(config)
    const client = new EncryptedWorkspaceSyncClient(config.baseline, config.actorId, accountKey, privateKey, transport, config.client)
    try { await client.acknowledge() } catch (error) { config.lastError = `Workspace committed, but server acknowledgement will retry: ${error instanceof Error ? error.message : 'request failed'}`; await this.writeConfig(config) }
    return { ...payload, status: await this.status() }
  }

  async createAccount(endpointInput: string, documentInput: unknown, media: MediaAsset[], commit: CommitSynchronizedWorkspace = async () => undefined) {
    this.requireProtection(); if (await this.readConfig()) throw new Error('This device is already connected to encrypted sync.')
    const endpoint = safeEndpoint(endpointInput); const document = parseWorkspaceDocumentV4(documentInput); const accountKey = await generateAccountMasterKey(); const signing = await generateDeviceSigningKeys(); const actorId = `device-${randomUUID()}`
    const publicKeyJwk = await crypto.subtle.exportKey('jwk', signing.publicKey)
    const session = await this.request<{ accountId: string; workspaceId: string; actorId: string; token: string; recoveryToken: string }>(endpoint, '/v1/accounts', null, 'POST', { workspaceId: document.workspace.workspaceId, actorId, publicKeyJwk })
    const privateKey = toBase64(new Uint8Array(await crypto.subtle.exportKey('pkcs8', signing.privateKey))); const portable = await exportAccountMasterKey(accountKey)
    const secrets: SyncSecrets = { token: session.token, accountKey: portable, signingPrivateKey: privateKey, recoveryToken: session.recoveryToken }
    const config: SyncConfig = { version: 1, endpoint, accountId: session.accountId, workspaceId: session.workspaceId, actorId, publicKeyJwk, sealedSecrets: this.seal(secrets), baseline: document, client: { version: 1, nextSequence: 1, cursor: {}, outbox: [] }, createdAt: new Date().toISOString() }
    await this.writeConfig(config)
    try { await this.synchronize(document, media, [], commit) }
    catch (error) { await rm(this.path, { force: true }); throw error }
    return { recoveryBundle: encodeRecovery({ version: 1, endpoint, accountId: session.accountId, workspaceId: session.workspaceId, accountKey: portable, recoveryToken: session.recoveryToken }), status: await this.status() }
  }

  async recoverAccount(bundleText: string, placeholderDocument: unknown, commit: CommitSynchronizedWorkspace = async () => undefined) {
    this.requireProtection(); if (await this.readConfig()) throw new Error('This device is already connected to encrypted sync.')
    const recovery = decodeRecovery(bundleText); const endpoint = safeEndpoint(recovery.endpoint); const placeholder = parseWorkspaceDocumentV4(placeholderDocument); placeholder.workspace.workspaceId = recovery.workspaceId
    const signing = await generateDeviceSigningKeys(); const actorId = `device-${randomUUID()}`; const publicKeyJwk = await crypto.subtle.exportKey('jwk', signing.publicKey)
    const session = await this.request<{ token: string }>(endpoint, '/v1/recovery/devices', null, 'POST', { accountId: recovery.accountId, workspaceId: recovery.workspaceId, recoveryToken: recovery.recoveryToken, actorId, publicKeyJwk })
    const probe = await this.request<{ latestSnapshot?: EncryptedSnapshot; latestSnapshotManifest?: EncryptedSnapshotManifest }>(endpoint, '/v1/pull', session.token, 'POST', { after: {}, limit: 1 })
    if (!probe.latestSnapshot && !probe.latestSnapshotManifest) throw new Error('This sync account has no encrypted bootstrap snapshot yet. Keep the original device online and sync it once.')
    const secrets: SyncSecrets = { token: session.token, accountKey: recovery.accountKey, signingPrivateKey: toBase64(new Uint8Array(await crypto.subtle.exportKey('pkcs8', signing.privateKey))), recoveryToken: recovery.recoveryToken }
    const config: SyncConfig = { version: 1, endpoint, accountId: recovery.accountId, workspaceId: recovery.workspaceId, actorId, publicKeyJwk, sealedSecrets: this.seal(secrets), baseline: placeholder, client: { version: 1, nextSequence: 1, cursor: {}, outbox: [] }, createdAt: new Date().toISOString() }
    await this.writeConfig(config)
    try { return await this.synchronize(placeholder, [], [], commit) }
    catch (error) { if (!(await this.readConfig())?.pendingCommit) await rm(this.path, { force: true }); throw error }
  }

  async synchronize(currentInput: unknown, localMedia: MediaAsset[], resolvedConflictIds: string[] = [], commit: CommitSynchronizedWorkspace = async () => undefined) {
    const task = this.syncQueue.catch(() => undefined).then(() => this.synchronizeOnce(currentInput, localMedia, resolvedConflictIds, commit))
    this.syncQueue = task
    return task
  }

  private async synchronizeOnce(currentInput: unknown, localMedia: MediaAsset[], resolvedConflictIds: string[], commit: CommitSynchronizedWorkspace) {
    const config = await this.readConfig(); if (!config) throw new Error('Encrypted sync is not configured.')
    const secrets = this.secrets(config); const current = parseWorkspaceDocumentV4(currentInput); if (current.workspace.workspaceId !== config.workspaceId) throw new Error('Local workspace does not match the configured sync account.')
    const accountKey = await importAccountMasterKey(secrets.accountKey); const privateKey = await crypto.subtle.importKey('pkcs8', fromBase64(secrets.signingPrivateKey), { name: 'Ed25519' }, false, ['sign']); const transport = this.transport(config.endpoint, secrets.token)
    const recovered = await this.finishPendingCommit(config, localMedia, accountKey, privateKey, transport, commit)
    if (recovered) return recovered
    const client = new EncryptedWorkspaceSyncClient(config.baseline, config.actorId, accountKey, privateKey, transport, config.client)
    try {
      await client.capture(current, resolvedConflictIds)
      config.baseline = current; config.client = client.state(); await this.writeConfig(config)
      for (const asset of localMedia) await uploadEncryptedMedia(accountKey, transport, { id: asset.id, sha256: asset.hash, byteLength: asset.byteLength, bytes: dataUrlBytes(asset.dataUrl) })
      const result = await client.synchronize(); const synchronizedMedia = await this.synchronizedMedia(result.document, localMedia, accountKey, transport)
      const completedAt = new Date().toISOString(); config.pendingCommit = { document: result.document, client: client.state(), sent: result.sent, received: result.received, completedAt }; config.lastError = undefined; await this.writeConfig(config)
      const payload: SynchronizedWorkspacePayload = { document: result.document, media: synchronizedMedia, sent: result.sent, received: result.received }
      await commit(payload)
      config.baseline = result.document; config.client = config.pendingCommit.client; config.lastSuccessAt = completedAt; delete config.pendingCommit; await this.writeConfig(config)
      try { await client.acknowledge() } catch (error) { config.lastError = `Workspace committed, but server acknowledgement will retry: ${error instanceof Error ? error.message : 'request failed'}`; await this.writeConfig(config) }
      return { ...payload, status: await this.status() }
    } catch (error) { config.client = client.state(); config.lastError = error instanceof Error ? error.message : 'Sync failed.'; await this.writeConfig(config); throw error }
  }

  async status(): Promise<SyncStatus> { const config = await this.readConfig(); return config ? { configured: true, endpoint: config.endpoint, accountId: config.accountId, workspaceId: config.workspaceId, actorId: config.actorId, pendingOperations: config.client.outbox.length, conflicts: structuredClone(config.client.conflicts || []), pendingCommit: Boolean(config.pendingCommit), lastSuccessAt: config.lastSuccessAt, lastError: config.lastError } : { configured: false, pendingOperations: 0, conflicts: [] } }
  async resolveConflict(conflictId: string, choice: 'existing' | 'incoming', currentInput: unknown, localMedia: MediaAsset[], commit: CommitSynchronizedWorkspace = async () => undefined) {
    const config = await this.readConfig(); if (!config) throw new Error('Encrypted sync is not configured.')
    const conflict = (config.client.conflicts || []).find((value) => value.id === conflictId); if (!conflict) throw new Error('The sync conflict was already resolved or is unavailable.')
    const resolved = applySyncConflictResolution(parseWorkspaceDocumentV4(currentInput), conflict, choice)
    try { return await this.synchronize(resolved, localMedia, [conflictId], commit) }
    catch (error) {
      if ((await this.readConfig())?.pendingCommit) throw error
      const payload = { document: resolved, media: localMedia, sent: 0, received: 0 }; await commit(payload); return { ...payload, status: await this.status() }
    }
  }
  async listDevices() { const config = await this.readConfig(); if (!config) return []; const secrets = this.secrets(config); return (await this.request<{ devices: Array<{ actorId: string; createdAt: string; revokedAt?: string; current: boolean }> }>(config.endpoint, '/v1/devices', secrets.token, 'GET')).devices }
  async rotateRecoveryBundle() { const config = await this.readConfig(); if (!config) throw new Error('Encrypted sync is not configured.'); const secrets = this.secrets(config); const result = await this.request<{ recoveryToken: string }>(config.endpoint, '/v1/recovery/rotate', secrets.token, 'POST'); secrets.recoveryToken = result.recoveryToken; config.sealedSecrets = this.seal(secrets); await this.writeConfig(config); return encodeRecovery({ version: 1, endpoint: config.endpoint, accountId: config.accountId, workspaceId: config.workspaceId, accountKey: secrets.accountKey, recoveryToken: secrets.recoveryToken }) }
  async revokeDevice(actorId: string) { const config = await this.readConfig(); if (!config) throw new Error('Encrypted sync is not configured.'); const secrets = this.secrets(config); await this.request(config.endpoint, '/v1/devices/revoke', secrets.token, 'POST', { actorId }) }
  async deleteAccount() { const config = await this.readConfig(); if (!config) return; const secrets = this.secrets(config); await this.request(config.endpoint, '/v1/account', secrets.token, 'DELETE'); await rm(this.path, { force: true }) }
  async disconnect() { await rm(this.path, { force: true }) }
}

export const parseRecoveryBundle = decodeRecovery
