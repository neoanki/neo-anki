import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EncryptedSyncService } from '../../packages/sync-service/src/index'
import {
  encryptAndSignOperation,
  decryptMediaChunk,
  encryptMediaChunk,
  encryptSnapshot,
  encryptSnapshotChunks,
  generateAccountMasterKey,
  generateDeviceSigningKeys,
} from '../../packages/sync-protocol/src/index'

const jwk = (key: CryptoKey) => crypto.subtle.exportKey('jwk', key)

describe('content-blind encrypted sync reference service', () => {
  it('shares enrollment rate windows durably across service processes', () => {
    const directory = mkdtempSync(join(tmpdir(), 'neo-anki-rate-limit-')); const path = join(directory, 'sync.sqlite')
    try {
      const first = new EncryptedSyncService(path)
      expect(first.rateLimitExceeded('enroll:127.0.0.1', 2)).toBe(false)
      expect(first.rateLimitExceeded('enroll:127.0.0.1', 2)).toBe(false)
      first.close()
      const second = new EncryptedSyncService(path)
      try { expect(second.rateLimitExceeded('enroll:127.0.0.1', 2)).toBe(true) } finally { second.close() }
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it('authenticates signed monotonic operations and converges authorized devices without plaintext', async () => {
    const service = new EncryptedSyncService()
    try {
      const accountKey = await generateAccountMasterKey()
      const firstKeys = await generateDeviceSigningKeys()
      const first = service.enrollFirstDevice({ accountId: 'account-1', workspaceId: 'workspace-1', actorId: 'device-a', publicKeyJwk: await jwk(firstKeys.publicKey) })
      const header = { protocol: 1 as const, actorId: first.actorId, sequence: 1, timestamp: { wallTime: 100, counter: 0, actorId: first.actorId }, idempotencyKey: 'device-a:1', entityKind: 'note' as const, entityId: 'note-1', action: 'upsert' as const }
      const operation = await encryptAndSignOperation(accountKey, firstKeys.privateKey, header, { action: 'upsert', entityKind: 'note', entityId: 'note-1', fields: { front: 'private plaintext' } })
      await expect(service.push(first.token, [operation])).resolves.toEqual({ 'device-a': 1 })
      await expect(service.push(first.token, [operation])).resolves.toEqual({ 'device-a': 1 })

      const secondKeys = await generateDeviceSigningKeys()
      const second = service.enrollDevice(first.token, { actorId: 'device-b', publicKeyJwk: await jwk(secondKeys.publicKey) })
      const pulled = service.pull(second.token)
      expect(pulled.operations).toEqual([operation])
      expect(JSON.stringify(pulled)).not.toContain('private plaintext')

      const forged = { ...operation, actorId: 'device-b', timestamp: { ...operation.timestamp, actorId: 'device-b' } }
      await expect(service.push(second.token, [forged])).rejects.toThrow('invalid device signature')
      service.revokeDevice(first.token, 'device-b')
      expect(() => service.pull(second.token)).toThrow('revoked')
      expect(service.devicePublicKey(first.token, 'device-b')).toEqual(await jwk(secondKeys.publicKey))
      expect(service.listDevices(first.token)).toEqual(expect.arrayContaining([expect.objectContaining({ actorId: 'device-a', current: true }), expect.objectContaining({ actorId: 'device-b', revokedAt: expect.any(String), current: false })]))
      const recoveryKeys = await generateDeviceSigningKeys()
      const recovered = service.recoverDevice({ accountId: first.accountId, workspaceId: first.workspaceId, recoveryToken: first.recoveryToken!, actorId: 'device-recovered', publicKeyJwk: await jwk(recoveryKeys.publicKey) })
      expect(service.pull(recovered.token).operations).toEqual([operation])
      const rotated = service.rotateRecoveryToken(first.token)
      const recoveryPublicKey = await jwk(recoveryKeys.publicKey)
      expect(() => service.recoverDevice({ accountId: first.accountId, workspaceId: first.workspaceId, recoveryToken: first.recoveryToken!, actorId: 'device-old-recovery', publicKeyJwk: recoveryPublicKey })).toThrow('invalid')
      expect(rotated).not.toBe(first.recoveryToken)
    } finally { service.close() }
  })

  it('stores encrypted snapshots and resumable encrypted media without account keys', async () => {
    const service = new EncryptedSyncService()
    try {
      const key = await generateAccountMasterKey(); const signing = await generateDeviceSigningKeys()
      const session = service.enrollFirstDevice({ workspaceId: 'workspace-media', actorId: 'device-media', publicKeyJwk: await jwk(signing.publicKey) })
      const snapshot = await encryptSnapshot(key, session.workspaceId, {}, new TextEncoder().encode('private snapshot'))
      expect(service.putSnapshot(session.token, snapshot)).toHaveLength(64)
      expect(service.pull(session.token).latestSnapshot).toEqual(snapshot)
      const chunked = await encryptSnapshotChunks(key, session.workspaceId, { [session.actorId]: 0 }, new Uint8Array(150_000).fill(7), 64 * 1024)
      service.putSnapshotChunk(session.token, chunked.chunks[0])
      expect(() => service.commitSnapshotManifest(session.token, chunked.manifest)).toThrow('incomplete')
      for (const chunk of chunked.chunks.slice(1)) service.putSnapshotChunk(session.token, chunk)
      expect(service.commitSnapshotManifest(session.token, chunked.manifest)).toBe(chunked.manifest.snapshotId)
      expect(service.pull(session.token).latestSnapshotManifest).toEqual(chunked.manifest)
      expect(service.getSnapshotChunk(session.token, chunked.manifest.snapshotId, 2)).toEqual(chunked.chunks[2])
      const chunk = await encryptMediaChunk(key, 'media-1', 0, new Uint8Array([4, 3, 2, 1]))
      service.putMediaChunk(session.token, chunk)
      service.commitMediaManifest(session.token, { protocol: 1, format: 'chunked-v1', mediaId: 'media-1', uploadId: chunk.uploadId, plaintextBytes: 4, chunkBytes: 64 * 1024, chunkCount: 1 })
      expect(service.getMediaChunk(session.token, 'media-1', 0)).toEqual(chunk)
      expect(JSON.stringify(service.getMediaChunk(session.token, 'media-1', 0))).not.toContain('[4,3,2,1]')
    } finally { service.close() }
  })

  it('compacts only after every active device acknowledges a committed snapshot and preserves actor sequences', async () => {
    const service = new EncryptedSyncService()
    try {
      const key = await generateAccountMasterKey(); const keysA = await generateDeviceSigningKeys(); const keysB = await generateDeviceSigningKeys()
      const a = service.enrollFirstDevice({ workspaceId: 'workspace-compaction', actorId: 'device-a', publicKeyJwk: await jwk(keysA.publicKey) })
      const b = service.enrollDevice(a.token, { actorId: 'device-b', publicKeyJwk: await jwk(keysB.publicKey) })
      const operation = async (sequence: number) => encryptAndSignOperation(key, keysA.privateKey, { protocol: 1, actorId: a.actorId, sequence, timestamp: { wallTime: 1_000 + sequence, counter: 0, actorId: a.actorId }, idempotencyKey: `device-a:${sequence}`, entityKind: 'note', entityId: 'note-1', action: 'upsert' }, { action: 'upsert', entityKind: 'note', entityId: 'note-1', fields: { value: sequence } })
      await service.push(a.token, [await operation(1)])
      const snapshot = await encryptSnapshotChunks(key, a.workspaceId, { [a.actorId]: 1 }, new TextEncoder().encode('{"snapshot":1}'), 64 * 1024)
      for (const chunk of snapshot.chunks) service.putSnapshotChunk(a.token, chunk)
      service.commitSnapshotManifest(a.token, snapshot.manifest)

      expect(service.acknowledge(a.token, { [a.actorId]: 1 }).compacted).toBe(0)
      expect(service.database.prepare('SELECT COUNT(*) AS value FROM operations').get()).toMatchObject({ value: 1 })
      expect(service.acknowledge(b.token, { [a.actorId]: 1 }).compacted).toBe(1)
      expect(service.database.prepare('SELECT COUNT(*) AS value FROM operations').get()).toMatchObject({ value: 0 })

      await expect(service.push(a.token, [await operation(2)])).resolves.toEqual({ [a.actorId]: 2 })
      const recovered = service.pull(b.token, {}, 10)
      expect(recovered.compactionFloor).toEqual({ [a.actorId]: 1 })
      expect(recovered.latestSnapshotManifest).toEqual(snapshot.manifest)
      expect(recovered.operations).toHaveLength(1)
      expect(recovered.operations[0].sequence).toBe(2)
      expect(() => service.acknowledge(b.token, { [a.actorId]: 3 })).toThrow('exceeds')
      expect(() => service.acknowledge(b.token, { [a.actorId]: 0 })).toThrow('regressive')
    } finally { service.close() }
  })

  it('publishes media atomically and garbage-collects only old compacted tombstones', async () => {
    const service = new EncryptedSyncService()
    try {
      const key = await generateAccountMasterKey(); const signing = await generateDeviceSigningKeys()
      const session = service.enrollFirstDevice({ workspaceId: 'workspace-media-gc', actorId: 'device-media-gc', publicKeyJwk: await jwk(signing.publicKey) })
      const original = await encryptMediaChunk(key, 'media-gc', 0, new Uint8Array([1, 2, 3]), 'upload-original')
      service.putMediaChunk(session.token, original)
      service.commitMediaManifest(session.token, { protocol: 1, format: 'chunked-v1', mediaId: 'media-gc', uploadId: original.uploadId, plaintextBytes: 3, chunkBytes: 64 * 1024, chunkCount: 1 })
      const replacement = await encryptMediaChunk(key, 'media-gc', 0, new Uint8Array([9, 8, 7]), 'upload-replacement')
      service.putMediaChunk(session.token, replacement)
      expect(await decryptMediaChunk(key, service.getMediaChunk(session.token, 'media-gc', 0)!)).toEqual(new Uint8Array([1, 2, 3]))
      expect(() => service.commitMediaManifest(session.token, { protocol: 1, format: 'chunked-v1', mediaId: 'media-gc', uploadId: replacement.uploadId, plaintextBytes: 70_000, chunkBytes: 64 * 1024, chunkCount: 2 })).toThrow('incomplete')
      expect(await decryptMediaChunk(key, service.getMediaChunk(session.token, 'media-gc', 0)!)).toEqual(new Uint8Array([1, 2, 3]))

      const deletedAt = Date.now()
      const deletion = await encryptAndSignOperation(key, signing.privateKey, { protocol: 1, actorId: session.actorId, sequence: 1, timestamp: { wallTime: deletedAt, counter: 0, actorId: session.actorId }, idempotencyKey: `${session.actorId}:1`, entityKind: 'media', entityId: 'media-gc', action: 'delete' }, { action: 'delete', entityKind: 'media', entityId: 'media-gc' })
      await service.push(session.token, [deletion])
      const snapshot = await encryptSnapshotChunks(key, session.workspaceId, { [session.actorId]: 1 }, new TextEncoder().encode('{"media":[]}'), 64 * 1024)
      for (const chunk of snapshot.chunks) service.putSnapshotChunk(session.token, chunk)
      service.commitSnapshotManifest(session.token, snapshot.manifest)
      service.acknowledge(session.token, { [session.actorId]: 1 })
      expect(service.runMaintenance(deletedAt + 29 * 24 * 60 * 60 * 1000).deletedMedia).toBe(0)
      expect(service.getMediaChunk(session.token, 'media-gc', 0)).not.toBeNull()
      expect(service.runMaintenance(deletedAt + 31 * 24 * 60 * 60 * 1000).deletedMedia).toBe(1)
      expect(service.getMediaChunk(session.token, 'media-gc', 0)).toBeNull()
    } finally { service.close() }
  })

  it('reports bounded content-blind operator metrics without identifiers or encrypted payloads', async () => {
    const service = new EncryptedSyncService()
    try {
      const key = await generateAccountMasterKey(); const signing = await generateDeviceSigningKeys()
      const session = service.enrollFirstDevice({ accountId: 'private-account-id', workspaceId: 'private-workspace-id', actorId: 'private-device-id', publicKeyJwk: await jwk(signing.publicKey) })
      const operation = await encryptAndSignOperation(key, signing.privateKey, { protocol: 1, actorId: session.actorId, sequence: 1, timestamp: { wallTime: 1_000, counter: 0, actorId: session.actorId }, idempotencyKey: `${session.actorId}:1`, entityKind: 'note', entityId: 'private-note-id', action: 'upsert' }, { action: 'upsert', entityKind: 'note', entityId: 'private-note-id', fields: { front: 'private study content' } })
      await service.push(session.token, [operation])
      const metrics = service.operatorMetrics(10_000)
      expect(metrics).toMatchObject({ generatedAt: new Date(10_000).toISOString(), accounts: 1, workspaces: 1, activeDevices: 1, retainedOperations: 1 })
      const serialized = JSON.stringify(metrics)
      for (const privateValue of ['private-account-id', 'private-workspace-id', 'private-device-id', 'private-note-id', 'private study content', operation.ciphertext]) expect(serialized).not.toContain(privateValue)
      expect(serialized.length).toBeLessThan(2_000)
    } finally { service.close() }
  })
})
