import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EncryptedSyncService } from '../packages/sync-service/src/index'
import { createSeedData } from '../src/data/seed'
import { appDataToWorkspaceDocumentV4 } from '../src/lib/workspace-v4'
import { DesktopSyncManager, type SyncSecretProtector } from './sync-manager'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
const protector: SyncSecretProtector = { available: () => true, seal: (value) => new TextEncoder().encode(value), open: (value) => new TextDecoder().decode(value) }

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
    else if (method === 'POST' && url.pathname === '/v1/snapshots') { value = { id: service.putSnapshot(token, body.snapshot as never) }; status = 201 }
    else if (method === 'PUT' && snapshotChunk) { service.putSnapshotChunk(token, body.chunk as never); value = { stored: true } }
    else if (method === 'GET' && snapshotChunk) value = { chunk: service.getSnapshotChunk(token, decodeURIComponent(snapshotChunk[1]), Number(snapshotChunk[2])) }
    else if (method === 'POST' && url.pathname === '/v1/snapshot-manifests') { value = { id: service.commitSnapshotManifest(token, body.manifest as never) }; status = 201 }
    else if (method === 'POST' && url.pathname === '/v1/media-manifests') { service.commitMediaManifest(token, body.manifest as never); value = { committed: true }; status = 201 }
    else if (method === 'GET' && key) value = service.devicePublicKey(token, decodeURIComponent(key[1]))
    else if (method === 'GET' && url.pathname === '/v1/devices') value = { devices: service.listDevices(token) }
    else if (method === 'PUT' && media) { service.putMediaChunk(token, body.chunk as never); value = { stored: true } }
    else if (method === 'GET' && media) value = { chunk: service.getMediaChunk(token, decodeURIComponent(media[1]), Number(media[2])) }
    else throw new Error(`Unhandled test route ${method} ${url.pathname}`)
    return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
  } catch (error) { return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'failed' }), { status: 400, headers: { 'content-type': 'application/json' } }) }
}) as typeof fetch

describe('desktop encrypted sync manager', () => {
  it('seals device credentials, publishes a bootstrap snapshot, recovers a new device, and converges later edits', async () => {
    const service = new EncryptedSyncService()
    const rootA = await mkdtemp(join(tmpdir(), 'neo-sync-a-')); const rootB = await mkdtemp(join(tmpdir(), 'neo-sync-b-')); roots.push(rootA, rootB)
    try {
      const managerA = new DesktopSyncManager(rootA, protector, serviceFetch(service)); const initial = appDataToWorkspaceDocumentV4(createSeedData())
      const created = await managerA.createAccount('http://127.0.0.1:8787', initial, [])
      expect(created.recoveryBundle).not.toContain('"accountKey"')
      expect(service.database.prepare('SELECT entity_kind, entity_id FROM operations').all()).toEqual([])
      const placeholder = appDataToWorkspaceDocumentV4(createSeedData()); const managerB = new DesktopSyncManager(rootB, protector, serviceFetch(service))
      const recovered = await managerB.recoverAccount(created.recoveryBundle, placeholder)
      expect(await managerA.listDevices()).toHaveLength(2)
      expect(recovered.document.workspace.notes.map((note) => note.id).sort()).toEqual(initial.workspace.notes.map((note) => note.id).sort())

      const changed = structuredClone(initial); const note = changed.workspace.notes[0]; const fieldId = Object.keys(note.fields)[0]
      note.fields[fieldId] = 'Synced from desktop A'; note.revision += 1; changed.workspace.revision += 1
      await managerA.synchronize(changed, [])
      const onB = await managerB.synchronize(recovered.document, [])
      expect(onB.document.workspace.notes.find((value) => value.id === note.id)?.fields[fieldId]).toBe('Synced from desktop A')
      expect((await managerB.status()).lastSuccessAt).toBeTruthy()
    } finally { service.close() }
  })

  it('replays an interrupted local commit before advancing the server acknowledgement', async () => {
    const service = new EncryptedSyncService(); const root = await mkdtemp(join(tmpdir(), 'neo-sync-journal-')); roots.push(root)
    try {
      const manager = new DesktopSyncManager(root, protector, serviceFetch(service)); const initial = appDataToWorkspaceDocumentV4(createSeedData())
      await manager.createAccount('http://127.0.0.1:8787', initial, [])
      const changed = structuredClone(initial); const note = changed.workspace.notes[0]; const fieldId = Object.keys(note.fields)[0]
      note.fields[fieldId] = 'Crash-safe desktop commit'; note.revision += 1; changed.workspace.revision += 1
      const actorId = (await manager.status()).actorId!; const acknowledgement = () => (service.database.prepare('SELECT cursor FROM device_acknowledgements WHERE actor_id = ?').get(actorId) as { cursor: string }).cursor
      const before = acknowledgement(); const commits: string[] = []
      await expect(manager.synchronize(changed, [], [], async (payload) => { commits.push(payload.document.workspace.notes.find((value) => value.id === note.id)!.fields[fieldId]); throw new Error('database commit interrupted') })).rejects.toThrow('database commit interrupted')
      expect((await manager.status()).pendingCommit).toBe(true)
      expect(acknowledgement()).toBe(before)
      const recovered = await manager.synchronize(changed, [], [], async (payload) => { commits.push(payload.document.workspace.notes.find((value) => value.id === note.id)!.fields[fieldId]) })
      expect(commits).toEqual(['Crash-safe desktop commit', 'Crash-safe desktop commit'])
      expect(recovered.document.workspace.notes.find((value) => value.id === note.id)!.fields[fieldId]).toBe('Crash-safe desktop commit')
      expect((await manager.status()).pendingCommit).toBe(false)
      expect(acknowledgement()).not.toBe(before)
    } finally { service.close() }
  })
})
