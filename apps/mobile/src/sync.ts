import * as SecureStore from 'expo-secure-store'
import { fromByteArray, toByteArray } from 'base64-js'
import { parseWorkspaceDocumentV4, type WorkspaceDocumentV4 } from '@neo-anki/compatibility-domain'
import { applySyncConflictResolution, downloadEncryptedMedia, EncryptedWorkspaceSyncClient, uploadEncryptedMedia, type EncryptedSyncTransport, type PortableSyncClientState } from '@neo-anki/sync-client'
import { exportAccountMasterKey, generateAccountMasterKey, generateDeviceSigningKeys, importAccountMasterKey, type EncryptedMediaChunk, type EncryptedMediaManifest, type EncryptedSnapshot, type EncryptedSnapshotChunk, type EncryptedSnapshotManifest, type PortableAccountKey, type SyncFieldConflict } from '@neo-anki/sync-protocol'
import { MobileDatabase, type StoredMobileSyncConfig } from './database'

interface MobileSecrets { token: string; accountKey: PortableAccountKey; signingPrivateKey: string; recoveryToken: string }
interface RecoveryBundle { version: 1; endpoint: string; accountId: string; workspaceId: string; accountKey: PortableAccountKey; recoveryToken: string }
export interface MobileSyncStatus { configured: boolean; endpoint?: string; actorId?: string; pendingOperations: number; conflicts: SyncFieldConflict[]; lastSuccessAt?: string; lastError?: string }
const SECRETS_KEY = 'neo-anki.sync.secrets.v1'
const SYNC_REQUEST_TIMEOUT_MS = 30_000
const secureOptions: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }
const toBase64 = (value: Uint8Array) => fromByteArray(value)
const fromBase64 = (value: string) => toByteArray(value)
const textToBase64Url = (value: string) => { const encoded = fromByteArray(new TextEncoder().encode(value)); return encoded.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') }
const base64UrlToText = (value: string) => new TextDecoder().decode(toByteArray(value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=')))
const encodeRecovery = (value: RecoveryBundle) => textToBase64Url(JSON.stringify(value))
const decodeRecovery = (value: string): RecoveryBundle => { try { const parsed = JSON.parse(base64UrlToText(value.trim())) as RecoveryBundle; if (parsed.version !== 1 || !parsed.accountId || !parsed.workspaceId || !parsed.recoveryToken || parsed.accountKey?.algorithm !== 'AES-GCM-256') throw new Error(); return parsed } catch { throw new Error('The recovery key is invalid.') } }
const safeEndpoint = (value: string) => { const url = new URL(value); const local = ['127.0.0.1', 'localhost', '::1', '10.0.2.2'].includes(url.hostname); if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('Sync requires HTTPS except for a local development service.'); url.pathname = url.pathname.replace(/\/+$/, ''); url.search = ''; url.hash = ''; return url.toString().replace(/\/$/, '') }

export class MobileSyncManager {
  private syncQueue: Promise<unknown> = Promise.resolve()
  constructor(private readonly database: MobileDatabase, private readonly fetcher: typeof fetch = globalThis.fetch) {}
  private async secrets() { const value = await SecureStore.getItemAsync(SECRETS_KEY, secureOptions); if (!value) throw new Error('This device’s secure sync credentials are missing. Recover it again.'); return JSON.parse(value) as MobileSecrets }
  private saveSecrets(value: MobileSecrets) { return SecureStore.setItemAsync(SECRETS_KEY, JSON.stringify(value), secureOptions) }
  private clearSecrets() { return SecureStore.deleteItemAsync(SECRETS_KEY, secureOptions) }
  private async request<T>(endpoint: string, path: string, token: string | null, method: string, body?: unknown): Promise<T> {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), SYNC_REQUEST_TIMEOUT_MS)
    let response: Response
    try { response = await this.fetcher(`${endpoint}${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', cache: 'no-store', signal: controller.signal }) }
    catch (error) { if (controller.signal.aborted) throw new Error('Sync service request timed out. Check the connection and try again.'); throw error }
    finally { clearTimeout(timeout) }
    const result = await response.json().catch(() => ({})) as { error?: string }; if (!response.ok) throw new Error(result.error || `Sync service returned HTTP ${response.status}.`); return result as T
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
  async createAccount(endpointInput: string, documentInput: unknown) {
    if (await this.database.loadSyncConfig()) throw new Error('This device is already connected to encrypted sync.')
    if (!await SecureStore.isAvailableAsync()) throw new Error('Secure device key storage is unavailable.')
    const endpoint = safeEndpoint(endpointInput); const document = parseWorkspaceDocumentV4(documentInput); const accountKey = await generateAccountMasterKey(); const portable = await exportAccountMasterKey(accountKey); const signing = await generateDeviceSigningKeys(); const actorId = `mobile-${crypto.randomUUID()}`; const publicKeyJwk = await crypto.subtle.exportKey('jwk', signing.publicKey)
    const session = await this.request<{ accountId: string; workspaceId: string; token: string; recoveryToken: string }>(endpoint, '/v1/accounts', null, 'POST', { workspaceId: document.workspace.workspaceId, actorId, publicKeyJwk })
    const privateKey = toBase64(new Uint8Array(await crypto.subtle.exportKey('pkcs8', signing.privateKey))); await this.saveSecrets({ token: session.token, accountKey: portable, signingPrivateKey: privateKey, recoveryToken: session.recoveryToken })
    const config: StoredMobileSyncConfig = { version: 1, endpoint, accountId: session.accountId, workspaceId: session.workspaceId, actorId, publicKeyJwk, baseline: document, client: { version: 1, nextSequence: 1, cursor: {}, outbox: [] } satisfies PortableSyncClientState, createdAt: new Date().toISOString() }; await this.database.saveSyncConfig(config)
    try { await this.synchronize(document) } catch (error) { await this.disconnect(); throw error }
    return { recoveryBundle: encodeRecovery({ version: 1, endpoint, accountId: session.accountId, workspaceId: session.workspaceId, accountKey: portable, recoveryToken: session.recoveryToken }), status: await this.status() }
  }
  async recoverAccount(bundleText: string, placeholderInput: unknown) {
    if (await this.database.loadSyncConfig()) throw new Error('This device is already connected to encrypted sync.')
    const recovery = decodeRecovery(bundleText); const endpoint = safeEndpoint(recovery.endpoint); const placeholder = parseWorkspaceDocumentV4(placeholderInput); placeholder.workspace.workspaceId = recovery.workspaceId
    const signing = await generateDeviceSigningKeys(); const actorId = `mobile-${crypto.randomUUID()}`; const publicKeyJwk = await crypto.subtle.exportKey('jwk', signing.publicKey)
    const session = await this.request<{ token: string }>(endpoint, '/v1/recovery/devices', null, 'POST', { accountId: recovery.accountId, workspaceId: recovery.workspaceId, recoveryToken: recovery.recoveryToken, actorId, publicKeyJwk })
    const probe = await this.request<{ latestSnapshot?: EncryptedSnapshot; latestSnapshotManifest?: EncryptedSnapshotManifest }>(endpoint, '/v1/pull', session.token, 'POST', { after: {}, limit: 1 }); if (!probe.latestSnapshot && !probe.latestSnapshotManifest) throw new Error('This sync account has no encrypted bootstrap snapshot yet. Sync the original device once.')
    await this.saveSecrets({ token: session.token, accountKey: recovery.accountKey, signingPrivateKey: toBase64(new Uint8Array(await crypto.subtle.exportKey('pkcs8', signing.privateKey))), recoveryToken: recovery.recoveryToken })
    await this.database.saveSyncConfig({ version: 1, endpoint, accountId: recovery.accountId, workspaceId: recovery.workspaceId, actorId, publicKeyJwk, baseline: placeholder, client: { version: 1, nextSequence: 1, cursor: {}, outbox: [] }, createdAt: new Date().toISOString() })
    try { return await this.synchronize(placeholder) } catch (error) { await this.disconnect(); throw error }
  }
  async synchronize(documentInput?: WorkspaceDocumentV4, resolvedConflictIds: string[] = []) {
    const task = this.syncQueue.catch(() => undefined).then(() => this.synchronizeOnce(documentInput, resolvedConflictIds))
    this.syncQueue = task
    return task
  }
  private async synchronizeOnce(documentInput?: WorkspaceDocumentV4, resolvedConflictIds: string[] = []) {
    const config = await this.database.loadSyncConfig(); if (!config) throw new Error('Encrypted sync is not configured.'); const secrets = await this.secrets(); const current = parseWorkspaceDocumentV4(documentInput || await this.database.loadWorkspace()); if (current.workspace.workspaceId !== config.workspaceId) throw new Error('Local workspace does not match this sync account.')
    const accountKey = await importAccountMasterKey(secrets.accountKey); const privateBytes = new Uint8Array(fromBase64(secrets.signingPrivateKey)); const privateKey = await crypto.subtle.importKey('pkcs8', privateBytes.buffer as ArrayBuffer, { name: 'Ed25519' }, false, ['sign']); const transport = this.transport(config.endpoint, secrets.token); const client = new EncryptedWorkspaceSyncClient(config.baseline, config.actorId, accountKey, privateKey, transport, config.client as PortableSyncClientState)
    try {
      await client.capture(current, resolvedConflictIds)
      config.baseline = current; config.client = client.state(); await this.database.saveSyncConfig(config)
      for (const descriptor of current.workspace.media) { const bytes = await this.database.getMedia(descriptor.id); if (!bytes) throw new Error(`Local media ${descriptor.filename} is missing.`); await uploadEncryptedMedia(accountKey, transport, { id: descriptor.id, sha256: descriptor.sha256, byteLength: descriptor.byteLength, bytes }) }
      const result = await client.synchronize()
      for (const descriptor of result.document.workspace.media) if (!await this.database.getMedia(descriptor.id)) await this.database.putMedia(descriptor.id, await downloadEncryptedMedia(accountKey, transport, { id: descriptor.id, sha256: descriptor.sha256, byteLength: descriptor.byteLength }))
      config.baseline = result.document; config.client = client.state(); config.lastSuccessAt = new Date().toISOString(); config.lastError = undefined; await this.database.saveWorkspaceAndSyncConfig(result.document, config)
      try { await client.acknowledge() } catch (error) { config.lastError = `Workspace committed, but server acknowledgement will retry: ${error instanceof Error ? error.message : 'request failed'}`; await this.database.saveSyncConfig(config) }
      return { document: result.document, sent: result.sent, received: result.received, status: await this.status() }
    } catch (error) { config.client = client.state(); config.lastError = error instanceof Error ? error.message : 'Sync failed.'; await this.database.saveSyncConfig(config); throw error }
  }
  async status(): Promise<MobileSyncStatus> { const config = await this.database.loadSyncConfig(); const client = config?.client as PortableSyncClientState | undefined; return config ? { configured: true, endpoint: config.endpoint, actorId: config.actorId, pendingOperations: client?.outbox.length || 0, conflicts: structuredClone(client?.conflicts || []), lastSuccessAt: config.lastSuccessAt, lastError: config.lastError } : { configured: false, pendingOperations: 0, conflicts: [] } }
  async resolveConflict(conflictId: string, choice: 'existing' | 'incoming') {
    const config = await this.database.loadSyncConfig(); if (!config) throw new Error('Encrypted sync is not configured.')
    const client = config.client as PortableSyncClientState; const conflict = (client.conflicts || []).find((value) => value.id === conflictId); if (!conflict) throw new Error('The sync conflict was already resolved or is unavailable.')
    const resolved = applySyncConflictResolution(await this.database.loadWorkspace(), conflict, choice)
    await this.database.saveWorkspace(resolved)
    try { return await this.synchronize(resolved, [conflictId]) }
    catch { return { document: resolved, sent: 0, received: 0, status: await this.status() } }
  }
  async listDevices() { const config = await this.database.loadSyncConfig(); if (!config) return []; const secrets = await this.secrets(); return (await this.request<{ devices: Array<{ actorId: string; createdAt: string; revokedAt?: string; current: boolean }> }>(config.endpoint, '/v1/devices', secrets.token, 'GET')).devices }
  async revokeDevice(actorId: string) { const config = await this.database.loadSyncConfig(); if (!config) throw new Error('Encrypted sync is not configured.'); const secrets = await this.secrets(); await this.request(config.endpoint, '/v1/devices/revoke', secrets.token, 'POST', { actorId }) }
  async rotateRecoveryBundle() { const config = await this.database.loadSyncConfig(); if (!config) throw new Error('Encrypted sync is not configured.'); const secrets = await this.secrets(); const result = await this.request<{ recoveryToken: string }>(config.endpoint, '/v1/recovery/rotate', secrets.token, 'POST'); secrets.recoveryToken = result.recoveryToken; await this.saveSecrets(secrets); return encodeRecovery({ version: 1, endpoint: config.endpoint, accountId: config.accountId, workspaceId: config.workspaceId, accountKey: secrets.accountKey, recoveryToken: result.recoveryToken }) }
  async disconnect() { await Promise.all([this.database.clearSyncConfig(), this.clearSecrets()]) }
  async deleteAccount() { const config = await this.database.loadSyncConfig(); if (!config) return; const secrets = await this.secrets(); await this.request(config.endpoint, '/v1/account', secrets.token, 'DELETE'); await this.disconnect() }
}
