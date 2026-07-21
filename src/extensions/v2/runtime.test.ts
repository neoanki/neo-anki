import { describe, expect, it, vi } from 'vitest'
import type { ExtensionHostV2, ExtensionManifestV2, WorkerTransportMessageV2 } from '../../../packages/extension-sdk/src/index'
import { createSandboxedExtensionUiV2, ExtensionWorkerRuntimeV2 } from './runtime'

const manifest = (permissions: ExtensionManifestV2['permissions'] = ['study:signals']): ExtensionManifestV2 => ({
  format: 'neo-anki-extension', schemaVersion: 2, sdkVersion: 2, id: 'org.neoanki.fixture', name: 'Fixture', version: '2.0.0', publisher: 'Neo Anki', publisherKey: 'fixture-key', permissions, workerEntry: 'worker.js', provenance: { sourceCommit: 'a'.repeat(40), buildSystem: 'fixture' }, uiEntries: [{ id: 'page', surface: 'page', entry: 'page.js' }],
})

const host = (): ExtensionHostV2 => ({
  applyPatch: vi.fn(async () => ({ workspaceRevision: 2 })),
  createMedia: vi.fn(async () => ({ id: 'media', sha256: 'a'.repeat(64), byteLength: 1, workspaceRevision: 2 })),
  fetch: vi.fn(async () => ({ status: 200, headers: {}, body: new Uint8Array([1]) })),
  cancel: vi.fn(async () => undefined),
  secrets: { read: vi.fn(async () => ({})), mutate: vi.fn(async () => undefined) },
  config: { read: vi.fn(async () => null), write: vi.fn(async () => ({ workspaceRevision: 2 })) },
  content: { listNotes: vi.fn(async () => ({ workspaceRevision: 2, notes: [], availableMediaIds: [] })) },
  migration: { exportWorkspace: vi.fn(async () => ({ document: {}, media: [] })), commit: vi.fn(async () => ({ workspaceRevision: 2 })) },
})

class FakeWorker {
  sent: WorkerTransportMessageV2[] = []
  terminated = false
  private listeners = new Map<string, Array<(event: MessageEvent<WorkerTransportMessageV2>) => void>>()
  postMessage(message: WorkerTransportMessageV2) { this.sent.push(message) }
  terminate() { this.terminated = true }
  addEventListener(type: string, listener: (event: MessageEvent<WorkerTransportMessageV2>) => void) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]) }
  emit(message: WorkerTransportMessageV2) { for (const listener of this.listeners.get('message') || []) listener({ data: message } as MessageEvent<WorkerTransportMessageV2>) }
}

describe('SDK v2 isolated runtimes', () => {
  it('rejects worker messages larger than the documented 8 MiB boundary', async () => {
    const worker = new FakeWorker()
    const runtime = new ExtensionWorkerRuntimeV2(manifest(), 'blob:https://neoanki.test/worker', host(), () => worker as never)
    worker.emit({ protocol: 2, type: 'ready', extensionId: manifest().id })
    const request = { type: 'planning-signals' as const, request: { requestId: 'oversized', contributionId: 'planner', now: new Date().toISOString(), items: [] } }
    const pending = runtime.execute(request)
    await Promise.resolve()

    const oversizedReason = 'x'.repeat(8 * 1024 * 1024 + 1)
    worker.emit({
      protocol: 2,
      type: 'response',
      response: { type: 'planning-signals', requestId: 'oversized', signals: [{ itemId: 'item', score: 1, reason: oversizedReason }] },
    })

    expect(worker.terminated).toBe(true)
    await expect(pending).rejects.toThrow(/exceeds 8 MiB/)
  })

  it('launches compiled extension workers as ES modules', () => {
    const worker = new FakeWorker()
    const WorkerMock = vi.fn(function WorkerConstructor() { return worker })
    vi.stubGlobal('Worker', WorkerMock)
    const runtime = new ExtensionWorkerRuntimeV2(manifest(), 'blob:https://neoanki.test/module-worker', host())
    worker.emit({ protocol: 2, type: 'ready', extensionId: manifest().id })
    expect(WorkerMock).toHaveBeenCalledWith('blob:https://neoanki.test/module-worker', { type: 'module', name: `neo-anki:${manifest().id}` })
    runtime.close()
    vi.unstubAllGlobals()
  })

  it('executes bounded worker contributions and rejects malformed signals', async () => {
    const worker = new FakeWorker(); const runtime = new ExtensionWorkerRuntimeV2(manifest(), 'blob:https://neoanki.test/worker', host(), () => worker as never)
    worker.emit({ protocol: 2, type: 'ready', extensionId: manifest().id })
    const request = { type: 'planning-signals' as const, request: { requestId: 'signals-1', contributionId: 'planner', now: new Date().toISOString(), items: [] } }
    const pending = runtime.execute(request)
    await Promise.resolve()
    expect(worker.sent.at(-1)).toMatchObject({ type: 'request', request })
    worker.emit({ protocol: 2, type: 'response', response: { type: 'planning-signals', requestId: 'signals-1', signals: [{ itemId: 'item', score: .5, reason: 'useful' }] } })
    await expect(pending).resolves.toMatchObject({ type: 'planning-signals' })

    const invalid = runtime.execute({ ...request, request: { ...request.request, requestId: 'signals-2' } })
    await Promise.resolve()
    worker.emit({ protocol: 2, type: 'response', response: { type: 'planning-signals', requestId: 'signals-2', signals: [{ itemId: 'item', score: Number.NaN, reason: 'bad' }] } })
    await expect(invalid).rejects.toThrow(/invalid planning signals/)
    runtime.close()
  })

  it('enforces manifest permissions on worker-to-host RPC', async () => {
    const worker = new FakeWorker(); const workerHost = host(); const runtime = new ExtensionWorkerRuntimeV2(manifest(), 'blob:https://neoanki.test/worker', workerHost, () => worker as never)
    worker.emit({ protocol: 2, type: 'ready', extensionId: manifest().id })
    worker.emit({ protocol: 2, type: 'host-call', callId: 'network', method: 'fetch', args: [{ operationId: 'op', url: 'https://example.com' }] })
    await Promise.resolve()
    expect(worker.sent.at(-1)).toMatchObject({ type: 'host-result', ok: false, error: { code: 'permission-denied' } })
    expect(workerHost.fetch).not.toHaveBeenCalled()
    runtime.close()
  })

  it('creates DOM/CSS-isolated UI frames without ambient network access', () => {
    const runtime = createSandboxedExtensionUiV2(manifest(['ui:page']), 'page', 'blob:https://neoanki.test/page', { locale: 'en-US', theme: 'dark', dto: {} })
    expect(runtime.iframe.title).toContain('Fixture')
    expect(runtime.iframe.getAttribute('sandbox')).toBe('allow-scripts')
    expect(runtime.iframe.getAttribute('sandbox')).not.toContain('allow-same-origin')
    const frameDocument = atob(runtime.iframe.src.split(',')[1]!)
    expect(frameDocument).toContain("connect-src 'none'")
    expect(frameDocument).toContain('<html lang="en-US" data-theme="dark">')
    expect(frameDocument).toContain('<title>Fixture: page</title>')
    expect(frameDocument).toContain('min-height:0!important;height:auto!important')
    runtime.close()
  })

  it('reports the sandbox readiness handshake to the host frame', async () => {
    const lifecycle = vi.fn()
    const runtime = createSandboxedExtensionUiV2(manifest(['ui:page']), 'page', 'blob:https://neoanki.test/page', { locale: 'en', theme: 'light', dto: {} }, undefined, lifecycle)
    document.body.append(runtime.iframe)
    const target = runtime.iframe.contentWindow!
    vi.spyOn(target, 'postMessage').mockImplementation(((_message: unknown, _origin: string, transfer?: Transferable[]) => {
      const port = transfer?.[0] as MessagePort | undefined
      port?.postMessage({ protocol: 2, type: 'ready' })
    }) as typeof target.postMessage)
    runtime.iframe.dispatchEvent(new Event('load'))
    await vi.waitFor(() => expect(lifecycle).toHaveBeenCalledWith({ type: 'ready' }))
    runtime.close()
  })

  it('accepts tall intrinsic frame sizes while keeping resize messages bounded', async () => {
    const lifecycle = vi.fn()
    const runtime = createSandboxedExtensionUiV2(manifest(['ui:page']), 'page', 'blob:https://neoanki.test/page', { locale: 'en', theme: 'light', dto: {} }, undefined, lifecycle)
    document.body.append(runtime.iframe)
    const target = runtime.iframe.contentWindow!
    let extensionPort: MessagePort | undefined
    vi.spyOn(target, 'postMessage').mockImplementation(((_message: unknown, _origin: string, transfer?: Transferable[]) => {
      extensionPort = transfer?.[0] as MessagePort | undefined
      extensionPort?.start()
    }) as typeof target.postMessage)
    runtime.iframe.dispatchEvent(new Event('load'))
    extensionPort!.postMessage({ protocol: 2, type: 'event', name: 'resize', payload: { height: 4_200 } })
    await vi.waitFor(() => expect(lifecycle).toHaveBeenCalledWith({ type: 'resize', height: 4_200 }))
    extensionPort!.postMessage({ protocol: 2, type: 'event', name: 'resize', payload: { height: 40_000 } })
    await vi.waitFor(() => expect(lifecycle).toHaveBeenCalledWith({ type: 'resize', height: 24_000 }))
    extensionPort!.postMessage({ protocol: 2, type: 'event', name: 'resize', payload: { height: 20 } })
    await vi.waitFor(() => expect(lifecycle).toHaveBeenCalledWith({ type: 'resize', height: 96 }))
    runtime.close()
  })
})
