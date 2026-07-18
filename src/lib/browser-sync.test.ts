import { describe, expect, it } from 'vitest'
import { EncryptedSyncService } from '../../packages/sync-service/src/index'
import { createSeedData } from '../data/seed'
import { appDataToWorkspaceDocumentV4 } from './workspace-v4'
import { BrowserSyncManager, MemoryBrowserSyncStore } from './browser-sync'

const serviceFetch = (service: EncryptedSyncService): typeof fetch => (async (input, init = {}) => {
  try {
    const url = new URL(String(input)); const method = init.method || 'GET'; const token = new Headers(init.headers).get('authorization')?.replace(/^Bearer\s+/i, '') || ''
    const body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}
    const key = /^\/v1\/devices\/([^/]+)\/key$/.exec(url.pathname); const media = /^\/v1\/media\/([^/]+)\/chunks\/(\d+)$/.exec(url.pathname); const snapshotChunk = /^\/v1\/snapshots\/([^/]+)\/chunks\/(\d+)$/.exec(url.pathname)
    let value: unknown; let status = 200
    if (method === 'POST' && url.pathname === '/v1/accounts') { value = service.enrollFirstDevice(body as never); status = 201 }
    else if (method === 'POST' && url.pathname === '/v1/recovery/devices') { value = service.recoverDevice(body as never); status = 201 }
    else if (method === 'POST' && url.pathname === '/v1/operations') value = { cursor: await service.push(token, body.operations as never) }
    else if (method === 'POST' && url.pathname === '/v1/pull') value = service.pull(token, body.after as never, Number(body.limit))
    else if (method === 'POST' && url.pathname === '/v1/acknowledgements') value = service.acknowledge(token, body.cursor as never)
    else if (method === 'POST' && url.pathname === '/v1/recovery/rotate') value = { recoveryToken: service.rotateRecoveryToken(token) }
    else if (method === 'POST' && url.pathname === '/v1/devices/revoke') { service.revokeDevice(token, String(body.actorId)); value = { revoked: true } }
    else if (method === 'POST' && url.pathname === '/v1/snapshots') { value = { id: service.putSnapshot(token, body.snapshot as never) }; status = 201 }
    else if (method === 'PUT' && snapshotChunk) { service.putSnapshotChunk(token, body.chunk as never); value = { stored: true } }
    else if (method === 'GET' && snapshotChunk) value = { chunk: service.getSnapshotChunk(token, decodeURIComponent(snapshotChunk[1]), Number(snapshotChunk[2])) }
    else if (method === 'POST' && url.pathname === '/v1/snapshot-manifests') { value = { id: service.commitSnapshotManifest(token, body.manifest as never) }; status = 201 }
    else if (method === 'POST' && url.pathname === '/v1/media-manifests') { service.commitMediaManifest(token, body.manifest as never); value = { committed: true }; status = 201 }
    else if (method === 'GET' && key) value = service.devicePublicKey(token, decodeURIComponent(key[1]))
    else if (method === 'GET' && url.pathname === '/v1/devices') value = { devices: service.listDevices(token) }
    else if (method === 'PUT' && media) { service.putMediaChunk(token, body.chunk as never); value = { stored: true } }
    else if (method === 'GET' && media) value = { chunk: service.getMediaChunk(token, decodeURIComponent(media[1]), Number(media[2])) }
    else if (method === 'DELETE' && url.pathname === '/v1/account') { service.deleteAccount(token); value = { deleted: true } }
    else throw new Error(`Unhandled test route ${method} ${url.pathname}`)
    return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
  } catch (error) { return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'failed' }), { status: 400, headers: { 'content-type': 'application/json' } }) }
}) as typeof fetch

describe('browser encrypted sync manager', () => {
  it('keeps operational keys as CryptoKeys, recovers another browser, and converges offline edits', async () => {
    const service = new EncryptedSyncService()
    try {
      const managerA = new BrowserSyncManager(new MemoryBrowserSyncStore(), serviceFetch(service)); const initial = appDataToWorkspaceDocumentV4(createSeedData())
      const created = await managerA.createAccount('http://127.0.0.1:8787', initial, [])
      expect(created.recoveryBundle).not.toContain('accountKey')
      const storeB = new MemoryBrowserSyncStore(); const managerB = new BrowserSyncManager(storeB, serviceFetch(service))
      const recovered = await managerB.recoverAccount(created.recoveryBundle, appDataToWorkspaceDocumentV4(createSeedData()))
      expect(await managerA.listDevices()).toHaveLength(2)
      expect(storeB.value?.accountKey).toBeInstanceOf(CryptoKey)
      expect(storeB.value?.accountKey.extractable).toBe(false)
      expect(recovered.document.workspace.notes.map((note) => note.id).sort()).toEqual(initial.workspace.notes.map((note) => note.id).sort())

      const changed = structuredClone(initial); const note = changed.workspace.notes[0]; const fieldId = Object.keys(note.fields)[0]
      note.fields[fieldId] = 'Edited offline in browser A'; note.revision += 1; changed.workspace.revision += 1
      await managerA.synchronize(changed, [])
      const onB = await managerB.synchronize(recovered.document, [])
      expect(onB.document.workspace.notes.find((value) => value.id === note.id)?.fields[fieldId]).toBe('Edited offline in browser A')
      expect((await managerB.status()).lastSuccessAt).toBeTruthy()
    } finally { service.close() }
  })

  it('surfaces the same concurrent-edit record on both devices and synchronizes an explicit resolution', async () => {
    const service = new EncryptedSyncService()
    try {
      const storeA = new MemoryBrowserSyncStore(); const storeB = new MemoryBrowserSyncStore()
      const managerA = new BrowserSyncManager(storeA, serviceFetch(service)); const initial = appDataToWorkspaceDocumentV4(createSeedData())
      const created = await managerA.createAccount('http://127.0.0.1:8787', initial, [])
      const managerB = new BrowserSyncManager(storeB, serviceFetch(service)); const recovered = await managerB.recoverAccount(created.recoveryBundle, appDataToWorkspaceDocumentV4(createSeedData()))
      const noteId = initial.workspace.notes[0].id; const fieldId = Object.keys(initial.workspace.notes[0].fields)[0]; const editedA = structuredClone(initial); const editedB = structuredClone(recovered.document)
      const noteA = editedA.workspace.notes.find((note) => note.id === noteId)!; const noteB = editedB.workspace.notes.find((note) => note.id === noteId)!
      noteA.fields[fieldId] = 'Value from A'; noteA.revision += 1; editedA.workspace.revision += 1
      noteB.fields[fieldId] = 'Value from B'; noteB.revision += 1; editedB.workspace.revision += 1
      const afterA = await managerA.synchronize(editedA, []); const afterB = await managerB.synchronize(editedB, [])
      const convergedA = await managerA.synchronize(afterA.document, [])
      const conflictsA = (await managerA.status()).conflicts; const conflictsB = (await managerB.status()).conflicts
      expect({ conflictsA, conflictsB }).toEqual({ conflictsA: [expect.anything()], conflictsB: [expect.anything()] })
      const conflictA = conflictsA[0]; const conflictB = conflictsB[0]
      expect(conflictA.id).toBe(conflictB.id)
      const expected = String(conflictA.incoming.value)
      const resolvedA = await managerA.resolveConflict(conflictA.id, 'incoming', convergedA.document, [])
      const resolvedB = await managerB.synchronize(afterB.document, [])
      expect(resolvedA.document.workspace.notes.find((note) => note.id === noteId)?.fields[fieldId]).toBe(expected)
      expect(resolvedB.document.workspace.notes.find((note) => note.id === noteId)?.fields[fieldId]).toBe(expected)
      expect((await managerA.status()).conflicts).toEqual([])
      expect((await managerB.status()).conflicts).toEqual([])
    } finally { service.close() }
  })

  it('persists the captured baseline before network I/O so a retry does not duplicate offline operations', async () => {
    const service = new EncryptedSyncService()
    try {
      let rejectPush = false
      const fetcher: typeof fetch = async (input, init) => {
        if (rejectPush && new URL(String(input)).pathname === '/v1/operations') return new Response(JSON.stringify({ error: 'offline' }), { status: 503, headers: { 'content-type': 'application/json' } })
        return serviceFetch(service)(input, init)
      }
      const store = new MemoryBrowserSyncStore(); const manager = new BrowserSyncManager(store, fetcher); const initial = appDataToWorkspaceDocumentV4(createSeedData())
      await manager.createAccount('http://127.0.0.1:8787', initial, [])
      const changed = structuredClone(initial); const fieldId = Object.keys(changed.workspace.notes[0].fields)[0]
      changed.workspace.notes[0].fields[fieldId] = 'Durably queued offline'; changed.workspace.notes[0].revision += 1; changed.workspace.revision += 1
      rejectPush = true; await expect(manager.synchronize(changed, [])).rejects.toThrow('offline')
      const queuedState = structuredClone(store.value!.config.client); expect(queuedState.outbox.length).toBeGreaterThan(0)
      expect(store.value!.config.baseline.workspace.notes[0].fields[fieldId]).toBe('Durably queued offline')
      rejectPush = false; await manager.synchronize(changed, [])
      expect(store.value!.config.client.nextSequence).toBe(queuedState.nextSequence)
      expect(store.value!.config.client.outbox).toEqual([])
    } finally { service.close() }
  })

  it('journals a synchronized result and acknowledges it only after the local workspace commit succeeds', async () => {
    const service = new EncryptedSyncService()
    try {
      const store = new MemoryBrowserSyncStore(); const manager = new BrowserSyncManager(store, serviceFetch(service)); const initial = appDataToWorkspaceDocumentV4(createSeedData())
      await manager.createAccount('http://127.0.0.1:8787', initial, [])
      const changed = structuredClone(initial); const note = changed.workspace.notes[0]; const fieldId = Object.keys(note.fields)[0]
      note.fields[fieldId] = 'Crash-safe browser commit'; note.revision += 1; changed.workspace.revision += 1
      const actorId = (await manager.status()).actorId!; const acknowledgement = () => (service.database.prepare('SELECT cursor FROM device_acknowledgements WHERE actor_id = ?').get(actorId) as { cursor: string }).cursor
      const before = acknowledgement(); const commits: string[] = []
      await expect(manager.synchronize(changed, [], [], async (payload) => { commits.push(payload.document.workspace.notes.find((value) => value.id === note.id)!.fields[fieldId]); throw new Error('local storage interrupted') })).rejects.toThrow('local storage interrupted')
      expect((await manager.status()).pendingCommit).toBe(true)
      expect(acknowledgement()).toBe(before)
      const recovered = await manager.synchronize(changed, [], [], async (payload) => { commits.push(payload.document.workspace.notes.find((value) => value.id === note.id)!.fields[fieldId]) })
      expect(commits).toEqual(['Crash-safe browser commit', 'Crash-safe browser commit'])
      expect(recovered.document.workspace.notes.find((value) => value.id === note.id)!.fields[fieldId]).toBe('Crash-safe browser commit')
      expect((await manager.status()).pendingCommit).toBe(false)
      expect(acknowledgement()).not.toBe(before)
    } finally { service.close() }
  })

  it('serializes overlapping sync requests so client state and local commits cannot race', async () => {
    const service = new EncryptedSyncService()
    try {
      const store = new MemoryBrowserSyncStore(); const manager = new BrowserSyncManager(store, serviceFetch(service)); const initial = appDataToWorkspaceDocumentV4(createSeedData())
      await manager.createAccount('http://127.0.0.1:8787', initial, [])
      const changed = structuredClone(initial); const note = changed.workspace.notes[0]; const fieldId = Object.keys(note.fields)[0]
      note.fields[fieldId] = 'One serialized edit'; note.revision += 1; changed.workspace.revision += 1
      let active = 0; let maximum = 0
      const commit = async () => { active += 1; maximum = Math.max(maximum, active); await new Promise((resolve) => setTimeout(resolve, 10)); active -= 1 }
      await Promise.all([manager.synchronize(changed, [], [], commit), manager.synchronize(changed, [], [], commit)])
      expect(maximum).toBe(1)
      expect(store.value!.config.client.outbox).toEqual([])
      const maximumSequence = Number((service.database.prepare('SELECT MAX(max_sequence) AS value FROM actor_sequences').get() as { value: number }).value)
      expect(maximumSequence).toBeGreaterThan(0)
      expect(maximumSequence).toBe(store.value!.config.client.nextSequence - 1)
    } finally { service.close() }
  })

  it('rotates recovery authorization, revokes devices, disconnects locally, and deletes server ciphertext', async () => {
    const service = new EncryptedSyncService()
    try {
      const emptyStore = new MemoryBrowserSyncStore(); const emptyManager = new BrowserSyncManager(emptyStore, serviceFetch(service))
      expect(await emptyManager.status()).toEqual({ configured: false, pendingOperations: 0, conflicts: [] })
      expect(await emptyManager.listDevices()).toEqual([])
      await emptyManager.deleteAccount(); await emptyManager.disconnect()

      const storeA = new MemoryBrowserSyncStore(); const managerA = new BrowserSyncManager(storeA, serviceFetch(service)); const initial = appDataToWorkspaceDocumentV4(createSeedData())
      const created = await managerA.createAccount('http://127.0.0.1:8787', initial, [])
      const storeB = new MemoryBrowserSyncStore(); const managerB = new BrowserSyncManager(storeB, serviceFetch(service)); await managerB.recoverAccount(created.recoveryBundle, appDataToWorkspaceDocumentV4(createSeedData()))
      const actorB = (await managerB.status()).actorId!
      await expect(managerA.rotateRecoveryBundle('not-a-recovery-key')).rejects.toThrow('invalid')
      const rotated = await managerA.rotateRecoveryBundle(created.recoveryBundle)
      expect(rotated).not.toBe(created.recoveryBundle)
      await managerA.revokeDevice(actorB)
      expect((await managerA.listDevices()).find((device) => device.actorId === actorB)?.revokedAt).toBeTruthy()
      await managerB.disconnect(); expect((await managerB.status()).configured).toBe(false)
      await managerA.deleteAccount(); expect((await managerA.status()).configured).toBe(false)
      expect(service.operatorMetrics().accounts).toBe(0)
    } finally { service.close() }
  })

  it('uploads local media and reconstructs verified data URLs on a recovered browser', async () => {
    const service = new EncryptedSyncService()
    try {
      const bytes = new Uint8Array([137, 80, 78, 71]); const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((value) => value.toString(16).padStart(2, '0')).join('')
      const document = appDataToWorkspaceDocumentV4(createSeedData()); const timestamp = new Date().toISOString(); const id = 'browser-media-fixture'
      document.workspace.media.push({ id, revision: 1, createdAt: timestamp, updatedAt: timestamp, profileId: document.workspace.profiles[0].id, filename: 'pixel.png', mimeType: 'image/png', byteLength: bytes.byteLength, sha256, storageKey: sha256 })
      const dataUrl = `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`
      const asset = { id, filename: 'pixel.png', mimeType: 'image/png', dataUrl, byteLength: bytes.byteLength, hash: sha256, altText: 'Pixel', createdAt: timestamp, updatedAt: timestamp }
      const managerA = new BrowserSyncManager(new MemoryBrowserSyncStore(), serviceFetch(service)); const created = await managerA.createAccount('http://127.0.0.1:8787', document, [asset])
      const managerB = new BrowserSyncManager(new MemoryBrowserSyncStore(), serviceFetch(service)); const recovered = await managerB.recoverAccount(created.recoveryBundle, appDataToWorkspaceDocumentV4(createSeedData()))
      expect(recovered.media).toEqual([expect.objectContaining({ id, dataUrl, hash: sha256, byteLength: bytes.byteLength })])
    } finally { service.close() }
  })
})
