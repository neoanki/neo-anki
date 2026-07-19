import { describe, expect, it } from 'vitest'
import {
  decryptMediaChunk,
  decryptOperation,
  decryptSnapshot,
  decryptSnapshotChunks,
  encryptAndSignOperation,
  encryptMediaChunk,
  encryptOperation,
  encryptSnapshot,
  encryptSnapshotChunks,
  exportAccountMasterKey,
  generateAccountMasterKey,
  generateDeviceSigningKeys,
  HybridLogicalClock,
  importAccountMasterKey,
  OperationLedger,
  verifyEncryptedOperation,
} from '../../packages/sync-protocol/src/index'

describe('encrypted sync protocol v1', () => {
  it('authenticates the clear routing header with the encrypted entity payload', async () => {
    const key = await generateAccountMasterKey()
    const clock = new HybridLogicalClock('device-a')
    const header = { protocol: 1 as const, actorId: 'device-a', sequence: 1, timestamp: clock.tick(100), idempotencyKey: 'device-a:1', entityKind: 'note' as const, entityId: 'note-1', action: 'upsert' as const }
    const encrypted = await encryptOperation(key, header, { action: 'upsert', entityKind: 'note', entityId: 'note-1', fields: { front: 'private' } })
    expect(encrypted.ciphertext).not.toContain('private')
    await expect(decryptOperation(key, { ...encrypted, entityId: 'note-2' })).rejects.toThrow()
    await expect(decryptOperation(key, encrypted)).resolves.toMatchObject({ fields: { front: 'private' } })
  })

  it('is idempotent, merges fields, and prevents deleted entities from resurrecting without restore', () => {
    const ledger = new OperationLedger()
    const stamp = (wallTime: number, actorId = 'a') => ({ wallTime, counter: 0, actorId })
    expect(ledger.apply({ actorId: 'a', sequence: 1, timestamp: stamp(1), idempotencyKey: 'a:1' }, { action: 'upsert', entityKind: 'note', entityId: 'n', fields: { front: 'A' }, tagsAdded: ['one'] }).applied).toBe(true)
    expect(ledger.apply({ actorId: 'b', sequence: 1, timestamp: stamp(2, 'b'), idempotencyKey: 'b:1' }, { action: 'delete', entityKind: 'note', entityId: 'n' }).reason).toBe('deleted')
    expect(ledger.apply({ actorId: 'a', sequence: 2, timestamp: stamp(3), idempotencyKey: 'a:2' }, { action: 'upsert', entityKind: 'note', entityId: 'n', fields: { front: 'resurrect' } }).reason).toBe('delete-wins')
    expect(ledger.read('note', 'n')).toBeNull()
    ledger.apply({ actorId: 'a', sequence: 3, timestamp: stamp(4), idempotencyKey: 'a:3' }, { action: 'restore', entityKind: 'note', entityId: 'n', fields: { front: 'restored' } })
    expect(ledger.read('note', 'n')).toEqual({ front: 'restored', tags: ['one'] })
    expect(ledger.apply({ actorId: 'a', sequence: 3, timestamp: stamp(4), idempotencyKey: 'a:3' }, { action: 'restore', entityKind: 'note', entityId: 'n' }).reason).toBe('duplicate')
  })

  it('signs routing and ciphertext with a device key and rejects tampering', async () => {
    const accountKey = await generateAccountMasterKey()
    const device = await generateDeviceSigningKeys()
    const header = { protocol: 1 as const, actorId: 'device-a', sequence: 1, timestamp: { wallTime: 10, counter: 0, actorId: 'device-a' }, idempotencyKey: 'device-a:1', entityKind: 'card' as const, entityId: 'card-1', action: 'upsert' as const }
    const signed = await encryptAndSignOperation(accountKey, device.privateKey, header, { action: 'upsert', entityKind: 'card', entityId: 'card-1', fields: { dueAt: '2030-01-01T00:00:00.000Z' } })
    await expect(verifyEncryptedOperation(device.publicKey, signed)).resolves.toBe(true)
    await expect(verifyEncryptedOperation(device.publicKey, { ...signed, sequence: 2 })).resolves.toBe(false)
  })

  it('exports a portable recovery key and encrypts snapshots and resumable media chunks', async () => {
    const original = await generateAccountMasterKey()
    const recovered = await importAccountMasterKey(await exportAccountMasterKey(original))
    const snapshotBytes = new TextEncoder().encode('{"workspace":"private"}')
    const snapshot = await encryptSnapshot(original, 'workspace-1', { 'device-a': 4 }, snapshotBytes)
    expect(new TextDecoder().decode(await decryptSnapshot(recovered, snapshot))).toBe('{"workspace":"private"}')
    const mediaBytes = new Uint8Array([1, 2, 3, 4, 5])
    const chunk = await encryptMediaChunk(original, 'media-1', 0, mediaBytes)
    expect(await decryptMediaChunk(recovered, chunk)).toEqual(mediaBytes)
  })

  it('encrypts large snapshots as independently authenticated transport chunks', async () => {
    const key = await generateAccountMasterKey()
    const bytes = new Uint8Array(160_000).map((_, index) => index % 251)
    const encrypted = await encryptSnapshotChunks(key, 'workspace-chunked', { device: 9 }, bytes, 64 * 1024)
    expect(encrypted.manifest.snapshotId).toMatch(/^snapshot-[A-Za-z0-9_-]{43}$/)
    expect(encrypted.chunks).toHaveLength(3)
    await expect(decryptSnapshotChunks(key, encrypted.manifest, encrypted.chunks)).resolves.toEqual(bytes)
    await expect(decryptSnapshotChunks(key, encrypted.manifest, encrypted.chunks.map((chunk, index) => index === 1 ? { ...chunk, plaintextBytes: chunk.plaintextBytes - 1 } : chunk))).rejects.toThrow('invalid')
  })

  it('keeps tags ordered by hybrid time and makes review entities append-only', () => {
    const ledger = new OperationLedger()
    const envelope = (actorId: string, sequence: number, wallTime: number) => ({ actorId, sequence, timestamp: { actorId, wallTime, counter: 0 }, idempotencyKey: `${actorId}:${sequence}` })
    ledger.apply(envelope('newer', 1, 20), { action: 'upsert', entityKind: 'note', entityId: 'note', tagsAdded: ['kept'] })
    ledger.apply(envelope('older', 1, 10), { action: 'upsert', entityKind: 'note', entityId: 'note', tagsRemoved: ['kept'] })
    expect(ledger.read('note', 'note')).toEqual({ tags: ['kept'] })
    ledger.apply(envelope('reviewer', 1, 30), { action: 'upsert', entityKind: 'review', entityId: 'review-1', fields: { rating: 3 } })
    expect(() => ledger.apply(envelope('reviewer', 2, 31), { action: 'upsert', entityKind: 'review', entityId: 'review-1', fields: { rating: 1 } })).toThrow('append-only')
    expect(() => ledger.apply(envelope('reviewer', 3, 32), { action: 'delete', entityKind: 'review', entityId: 'review-2' })).toThrow('cannot be deleted')
    expect(() => ledger.apply(envelope('reviewer', 2, 33), { action: 'upsert', entityKind: 'note', entityId: 'after-rejection', fields: { value: true } })).not.toThrow()
  })

  it('rejects remote clocks that could pin last-writer state far into the future', () => {
    const clock = new HybridLogicalClock('local')
    expect(() => clock.receive({ actorId: 'remote', wallTime: 25 * 60 * 60 * 1000, counter: 0 }, 0)).toThrow('24 hours')
  })
})
