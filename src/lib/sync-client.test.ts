import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadEncryptedMedia, EncryptedWorkspaceSyncClient, uploadEncryptedMedia, WorkspaceSyncReplica, type EncryptedSyncTransport } from '../../packages/sync-client/src/index'
import { EncryptedSyncService } from '../../packages/sync-service/src/index'
import { generateAccountMasterKey, generateDeviceSigningKeys, HybridLogicalClock } from '../../packages/sync-protocol/src/index'
import { createSeedData } from '../data/seed'
import { appDataToWorkspaceDocumentV4 } from './workspace-v4'

const apply = (replica: WorkspaceSyncReplica, operations: ReturnType<WorkspaceSyncReplica['createLocalOperations']>) => replica.applyBatch(operations.map(({ header, operation }) => ({ envelope: header, operation })))
afterEach(() => vi.restoreAllMocks())

describe('Workspace v4 offline sync replica', () => {
  it('converges concurrent edits to different named fields without flattening either edit', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000_000_000_000)
    const initial = appDataToWorkspaceDocumentV4(createSeedData())
    const replicaA = new WorkspaceSyncReplica(initial); const replicaB = new WorkspaceSyncReplica(initial)
    const nextA = structuredClone(initial); const nextB = structuredClone(initial)
    const noteA = nextA.workspace.notes[0]; const noteB = nextB.workspace.notes[0]
    const [frontId, backId] = Object.keys(noteA.fields)
    noteA.fields[frontId] = 'Front edited offline on A'; noteA.revision += 1; noteA.updatedAt = new Date(Date.now()).toISOString()
    noteB.fields[backId] = 'Back edited offline on B'; noteB.revision += 1; noteB.updatedAt = new Date(Date.now()).toISOString()
    nextA.workspace.revision += 1; nextB.workspace.revision += 1
    const a = replicaA.createLocalOperations(nextA, 'device-a', 1, new HybridLogicalClock('device-a'))
    const b = replicaB.createLocalOperations(nextB, 'device-b', 1, new HybridLogicalClock('device-b'))
    apply(replicaA, a); apply(replicaB, b)
    apply(replicaA, b); apply(replicaB, a)
    expect(replicaA.document()).toEqual(replicaB.document())
    expect(replicaA.document().workspace.notes.find((note) => note.id === noteA.id)?.fields).toMatchObject({ [frontId]: 'Front edited offline on A', [backId]: 'Back edited offline on B' })
  })

  it('surfaces concurrent edits to the same named field instead of silently hiding the losing value', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000_000_000_000)
    const initial = appDataToWorkspaceDocumentV4(createSeedData()); const fieldId = Object.keys(initial.workspace.notes[0].fields)[0]
    const replicaA = new WorkspaceSyncReplica(initial); const replicaB = new WorkspaceSyncReplica(initial)
    const nextA = structuredClone(initial); const nextB = structuredClone(initial); const base = initial.workspace.notes[0].fields[fieldId]
    nextA.workspace.notes[0].fields[fieldId] = 'Offline value A'; nextA.workspace.notes[0].revision += 1; nextA.workspace.revision += 1
    nextB.workspace.notes[0].fields[fieldId] = 'Offline value B'; nextB.workspace.notes[0].revision += 1; nextB.workspace.revision += 1
    const a = replicaA.createLocalOperations(nextA, 'device-a', 1, new HybridLogicalClock('device-a')); const b = replicaB.createLocalOperations(nextB, 'device-b', 1, new HybridLogicalClock('device-b'))
    apply(replicaA, a); apply(replicaB, b); apply(replicaA, b); apply(replicaB, a)
    expect(replicaA.document()).toEqual(replicaB.document())
    expect(replicaA.conflicts()[0].id).toBe(replicaB.conflicts()[0].id)
    expect(replicaA.conflicts()).toEqual([expect.objectContaining({ field: `$field:${fieldId}`, base: { present: true, value: base }, existing: { present: true, value: 'Offline value A' }, incoming: { present: true, value: 'Offline value B' } })])
    expect(replicaB.conflicts()).toEqual([expect.objectContaining({ field: `$field:${fieldId}`, base: { present: true, value: base }, existing: { present: true, value: 'Offline value B' }, incoming: { present: true, value: 'Offline value A' } })])
  })

  it('merges unrelated client settings and goals as independent conflict units', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000_000_000_000)
    const initial = appDataToWorkspaceDocumentV4(createSeedData()); const replicaA = new WorkspaceSyncReplica(initial); const replicaB = new WorkspaceSyncReplica(initial)
    const nextA = structuredClone(initial); const nextB = structuredClone(initial)
    nextA.clientState.settings = { ...nextA.clientState.settings, dailyMinutes: 45 }
    nextB.clientState.goals = [...nextB.clientState.goals, { id: 'goal-offline-b', name: 'Offline goal' }]
    const a = replicaA.createLocalOperations(nextA, 'device-a', 1, new HybridLogicalClock('device-a'))
    const b = replicaB.createLocalOperations(nextB, 'device-b', 1, new HybridLogicalClock('device-b'))
    apply(replicaA, a); apply(replicaB, b); apply(replicaA, b); apply(replicaB, a)
    expect(replicaA.document()).toEqual(replicaB.document())
    expect(replicaA.document().clientState.settings).toMatchObject({ dailyMinutes: 45 })
    expect(replicaA.document().clientState.goals).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'goal-offline-b' })]))
    expect(replicaA.conflicts().filter((value) => ['settings', 'goals'].includes(value.field))).toEqual([])
  })

  it('keeps delete-wins semantics until an explicit restore operation', () => {
    const initial = appDataToWorkspaceDocumentV4(createSeedData())
    const replica = new WorkspaceSyncReplica(initial)
    const deleted = structuredClone(initial); const note = deleted.workspace.notes.pop()!; deleted.workspace.cards = deleted.workspace.cards.filter((card) => card.noteId !== note.id); deleted.workspace.revision += 1
    const deletion = replica.createLocalOperations(deleted, 'device-a', 1, new HybridLogicalClock('device-a'))
    apply(replica, deletion)
    const stale = { envelope: { actorId: 'device-b', sequence: 1, timestamp: { actorId: 'device-b', wallTime: Date.now() + 1_000, counter: 0 }, idempotencyKey: 'device-b:1' }, operation: { action: 'upsert' as const, entityKind: 'note' as const, entityId: note.id, fields: { marked: true } } }
    replica.applyBatch([stale])
    expect(replica.document().workspace.notes.some((candidate) => candidate.id === note.id)).toBe(false)
    const restored = replica.createLocalOperations(initial, 'device-a', deletion.length + 1, new HybridLogicalClock('device-a'))
    expect(restored.filter((value) => value.operation.entityId === note.id || value.operation.entityKind === 'card').map((value) => value.operation.action)).toContain('restore')
    apply(replica, restored)
    expect(replica.document().workspace.notes.some((candidate) => candidate.id === note.id)).toBe(true)
  })

  it('uploads large outboxes in service-sized retry-safe chunks', async () => {
    const initial = appDataToWorkspaceDocumentV4(createSeedData())
    const accountKey = await generateAccountMasterKey(); const signing = await generateDeviceSigningKeys()
    const pushed: number[] = []
    const template = { protocol: 1 as const, actorId: 'device-a', sequence: 1, timestamp: { actorId: 'device-a', wallTime: 1, counter: 0 }, idempotencyKey: 'device-a:1', entityKind: 'note' as const, entityId: 'note', action: 'upsert' as const, nonce: 'AAAAAAAAAAAAAAAA', ciphertext: 'AA==', signature: 'AA==' }
    const outbox = Array.from({ length: 4_501 }, (_, index) => ({ ...template, sequence: index + 1, idempotencyKey: `device-a:${index + 1}` }))
    const client = new EncryptedWorkspaceSyncClient(initial, 'device-a', accountKey, signing.privateKey, {
      push: async (operations) => { pushed.push(operations.length); return {} },
      pull: async () => ({ operations: [], cursor: {}, compactionFloor: {} }),
      devicePublicKey: async () => signing.publicKey,
    }, { version: 1, nextSequence: 4_502, cursor: {}, outbox })
    await client.synchronize()
    expect(pushed).toEqual([2_000, 2_000, 501])
    expect(client.state().outbox).toEqual([])
  })

  it('stages all remote pages before validating the graph', async () => {
    const initial = appDataToWorkspaceDocumentV4(createSeedData())
    const accountKey = await generateAccountMasterKey(); const signingA = await generateDeviceSigningKeys(); const signingB = await generateDeviceSigningKeys()
    const actor = 'device-a'
    const producer = new EncryptedWorkspaceSyncClient(initial, actor, accountKey, signingA.privateKey, { push: async () => ({}), pull: async () => ({ operations: [], cursor: {}, compactionFloor: {} }), devicePublicKey: async () => signingA.publicKey })
    const deleted = structuredClone(initial); const note = deleted.workspace.notes.at(-1)!; const cardIds = new Set(deleted.workspace.cards.filter((value) => value.noteId === note.id).map((value) => value.id))
    deleted.workspace.notes = deleted.workspace.notes.filter((value) => value.id !== note.id); deleted.workspace.cards = deleted.workspace.cards.filter((value) => !cardIds.has(value.id)); deleted.workspace.revision += 1
    await producer.capture(deleted)
    const pages = producer.state().outbox
    let offset = 0
    const consumer = new EncryptedWorkspaceSyncClient(initial, 'device-b', accountKey, signingB.privateKey, {
      push: async () => ({}),
      pull: async () => {
        const operation = pages[offset++]
        return operation ? { operations: [operation], cursor: { [actor]: operation.sequence }, compactionFloor: {} } : { operations: [], cursor: { [actor]: pages.at(-1)!.sequence }, compactionFloor: {} }
      },
      devicePublicKey: async () => signingA.publicKey,
    })
    const result = await consumer.synchronize(1)
    expect(result.document.workspace.notes.some((value) => value.id === note.id)).toBe(false)
    expect(result.document.workspace.cards.some((value) => cardIds.has(value.id))).toBe(false)
  })

  it('persists an encrypted outbox and converges two authorized offline clients through the content-blind service', async () => {
    const service = new EncryptedSyncService(); const accountKey = await generateAccountMasterKey()
    try {
      const keysA = await generateDeviceSigningKeys(); const keysB = await generateDeviceSigningKeys()
      const a = service.enrollFirstDevice({ workspaceId: 'workspace-client', actorId: 'device-a', publicKeyJwk: await crypto.subtle.exportKey('jwk', keysA.publicKey) })
      const b = service.enrollDevice(a.token, { actorId: 'device-b', publicKeyJwk: await crypto.subtle.exportKey('jwk', keysB.publicKey) })
      const transport = (token: string): EncryptedSyncTransport => ({
        push: (operations) => service.push(token, operations),
        pull: async (after, limit) => service.pull(token, after, limit),
        acknowledge: async (cursor) => { service.acknowledge(token, cursor) },
        devicePublicKey: async (actorId) => crypto.subtle.importKey('jwk', service.devicePublicKey(token, actorId), { name: 'Ed25519' }, false, ['verify']),
        putSnapshotChunk: async (chunk) => { service.putSnapshotChunk(token, chunk) },
        commitSnapshotManifest: async (manifest) => { service.commitSnapshotManifest(token, manifest) },
        getSnapshotChunk: async (snapshotId, index) => service.getSnapshotChunk(token, snapshotId, index),
      })
      const initial = appDataToWorkspaceDocumentV4(createSeedData()); initial.workspace.workspaceId = a.workspaceId
      const clientA = new EncryptedWorkspaceSyncClient(initial, a.actorId, accountKey, keysA.privateKey, transport(a.token))
      const placeholder = appDataToWorkspaceDocumentV4(createSeedData()); placeholder.workspace.workspaceId = a.workspaceId
      const clientB = new EncryptedWorkspaceSyncClient(placeholder, b.actorId, accountKey, keysB.privateKey, transport(b.token))
      const changedA = structuredClone(initial); const noteId = changedA.workspace.notes[0].id; const fieldIds = Object.keys(changedA.workspace.notes[0].fields)
      changedA.workspace.notes[0].fields[fieldIds[0]] = 'Edited while A was offline'; changedA.workspace.notes[0].revision += 1; changedA.workspace.revision += 1
      expect(await clientA.capture(changedA)).toBeGreaterThan(0)
      expect(clientA.state().outbox.length).toBeGreaterThan(0)
      await clientA.synchronize(); const onB = (await clientB.synchronize()).document
      expect(onB.workspace.notes.find((note) => note.id === noteId)?.fields[fieldIds[0]]).toBe('Edited while A was offline')
      const changedB = structuredClone(onB); changedB.workspace.notes.find((note) => note.id === noteId)!.fields[fieldIds[1]] = 'Edited while B was offline'; changedB.workspace.revision += 1
      await clientB.capture(changedB); await clientB.synchronize(); const finalA = (await clientA.synchronize()).document
      expect(finalA).toEqual(clientB.replica.document())
      expect(finalA.workspace.notes.find((note) => note.id === noteId)?.fields).toMatchObject({ [fieldIds[0]]: 'Edited while A was offline', [fieldIds[1]]: 'Edited while B was offline' })
    } finally { service.close() }
  })

  it('resumes encrypted media by chunk and verifies the reconstructed content hash', async () => {
    const service = new EncryptedSyncService(); const key = await generateAccountMasterKey(); const signing = await generateDeviceSigningKeys()
    try {
      const session = service.enrollFirstDevice({ workspaceId: 'workspace-media-client', actorId: 'device-media-client', publicKeyJwk: await crypto.subtle.exportKey('jwk', signing.publicKey) })
      let uploadId = ''
      const transport = { putMediaChunk: async (chunk: Parameters<typeof service.putMediaChunk>[1]) => { service.putMediaChunk(session.token, chunk) }, commitMediaManifest: async (manifest: Parameters<typeof service.commitMediaManifest>[1]) => { uploadId = manifest.uploadId; service.commitMediaManifest(session.token, manifest) }, getMediaChunk: async (mediaId: string, index: number) => service.getMediaChunk(session.token, mediaId, index) }
      const bytes = new Uint8Array(1024 * 1024 + 17).map((_, index) => index % 251)
      const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((value) => value.toString(16).padStart(2, '0')).join('')
      await expect(uploadEncryptedMedia(key, transport, { id: 'large-media', sha256, byteLength: bytes.byteLength, bytes })).resolves.toBe(2)
      expect(uploadId).toMatch(/^upload-[A-Za-z0-9_-]{43}$/)
      await expect(downloadEncryptedMedia(key, transport, { id: 'large-media', sha256, byteLength: bytes.byteLength })).resolves.toEqual(bytes)
      await expect(downloadEncryptedMedia(key, transport, { id: 'large-media', sha256: '0'.repeat(64), byteLength: bytes.byteLength })).rejects.toThrow('integrity')
    } finally { service.close() }
  }, 15_000)

  it('bootstraps a newly enrolled device after acknowledged operations were compacted', async () => {
    const service = new EncryptedSyncService(); const key = await generateAccountMasterKey()
    try {
      const keysA = await generateDeviceSigningKeys(); const a = service.enrollFirstDevice({ workspaceId: 'workspace-bootstrap-after-compaction', actorId: 'device-a', publicKeyJwk: await crypto.subtle.exportKey('jwk', keysA.publicKey) })
      const transport = (token: string): EncryptedSyncTransport => ({
        push: (operations) => service.push(token, operations), pull: async (after, limit) => service.pull(token, after, limit), acknowledge: async (cursor) => { service.acknowledge(token, cursor) },
        devicePublicKey: async (actorId) => crypto.subtle.importKey('jwk', service.devicePublicKey(token, actorId), { name: 'Ed25519' }, false, ['verify']),
        putSnapshotChunk: async (chunk) => { service.putSnapshotChunk(token, chunk) }, commitSnapshotManifest: async (manifest) => { service.commitSnapshotManifest(token, manifest) }, getSnapshotChunk: async (snapshotId, index) => service.getSnapshotChunk(token, snapshotId, index),
      })
      const initial = appDataToWorkspaceDocumentV4(createSeedData()); initial.workspace.workspaceId = a.workspaceId
      const clientA = new EncryptedWorkspaceSyncClient(initial, a.actorId, key, keysA.privateKey, transport(a.token))
      const changed = structuredClone(initial); const note = changed.workspace.notes[0]; const fieldId = Object.keys(note.fields)[0]
      note.fields[fieldId] = 'Survives compaction'; note.revision += 1; changed.workspace.revision += 1
      await clientA.capture(changed); await clientA.synchronize(); await clientA.acknowledge()
      expect(service.database.prepare('SELECT COUNT(*) AS value FROM operations').get()).toMatchObject({ value: 0 })

      const keysB = await generateDeviceSigningKeys(); const b = service.enrollDevice(a.token, { actorId: 'device-b', publicKeyJwk: await crypto.subtle.exportKey('jwk', keysB.publicKey) })
      const placeholder = appDataToWorkspaceDocumentV4(createSeedData()); placeholder.workspace.workspaceId = a.workspaceId
      const clientB = new EncryptedWorkspaceSyncClient(placeholder, b.actorId, key, keysB.privateKey, transport(b.token))
      const recovered = await clientB.synchronize()
      expect(recovered.document.workspace.notes.find((value) => value.id === note.id)?.fields[fieldId]).toBe('Survives compaction')
    } finally { service.close() }
  })
})
