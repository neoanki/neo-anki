import type {
  ExtensionHostMethodV2,
  ExtensionHostV2,
  ExtensionManifestV2,
  SandboxedUiInit,
  SandboxedUiMessageV2,
  WorkerContributionRequest,
  WorkerContributionResponse,
  WorkerTransportMessageV2,
} from '../../../packages/extension-sdk/src/index.js'

const MAX_MESSAGE_BYTES = 512 * 1024 * 1024
const MAX_PENDING = 100
const DEFAULT_TIMEOUT_MS = 15_000
const START_TIMEOUT_MS = 5_000
const MAX_UI_FRAME_HEIGHT = 24_000

interface WorkerLike {
  postMessage(message: unknown): void
  terminate(): void
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerTransportMessageV2>) => void): void
  addEventListener(type: 'error' | 'messageerror', listener: (event: Event) => void): void
}
type WorkerFactory = (url: string) => WorkerLike

const messageBytes = (value: unknown, seen = new Set<object>()): number => {
  if (value instanceof ArrayBuffer) return value.byteLength
  if (ArrayBuffer.isView(value)) return value.byteLength
  if (typeof Blob !== 'undefined' && value instanceof Blob) return value.size
  if (typeof value === 'string') return new TextEncoder().encode(value).byteLength
  if (!value || typeof value !== 'object') return 16
  if (seen.has(value)) throw new Error('Extension messages may not contain cycles.')
  seen.add(value)
  const bytes = Array.isArray(value) ? value.reduce((sum, entry) => sum + messageBytes(entry, seen), 0) : Object.entries(value).reduce((sum, [key, entry]) => sum + key.length + messageBytes(entry, seen), 0)
  seen.delete(value)
  return bytes
}
const bounded = (value: unknown) => {
  if (messageBytes(value) > MAX_MESSAGE_BYTES) throw new Error('Extension message exceeds 8 MiB.')
  return value
}
const requestId = (request: WorkerContributionRequest) => request.type === 'planning-signals' ? request.request.requestId : request.type === 'cancel' ? request.operationId : request.requestId
const safeUrl = (value: string) => {
  const url = new URL(value, window.location.href)
  const development = url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
  const desktopWorker = url.protocol === 'neoanki:' && url.hostname === 'app' && url.pathname === '/__extension-worker.js'
  if (!['file:', 'neoanki-extension:', 'blob:', 'data:'].includes(url.protocol) && !development && !desktopWorker) throw new Error(`Extension entry scheme ${url.protocol} is not allowed.`)
  return url.href
}

const permissionFor = (method: ExtensionHostMethodV2): ExtensionManifestV2['permissions'][number] | null => method === 'applyPatch' ? 'content:patch-own' : method === 'createMedia' ? 'media:create' : method === 'fetch' ? 'network:fetch' : method === 'secrets.read' || method === 'secrets.mutate' ? 'secrets:device' : method === 'config.read' || method === 'config.write' ? 'config:sync' : method === 'content.listNotes' ? 'content:read' : method === 'migration.exportWorkspace' || method === 'migration.commit' ? 'content:migrate' : null

export class ExtensionWorkerRuntimeV2 {
  private worker: WorkerLike
  private readyResolve!: () => void
  private readyReject!: (error: Error) => void
  private ready: Promise<void>
  private pending = new Map<string, { resolve(value: WorkerContributionResponse): void; reject(error: Error): void; timeout: number }>()
  private closed = false

  constructor(readonly manifest: ExtensionManifestV2, workerUrl: string, private readonly host: ExtensionHostV2, factory: WorkerFactory = (url) => new Worker(url, { type: 'module', name: `neo-anki:${manifest.id}` })) {
    if (manifest.schemaVersion !== 2 || manifest.sdkVersion !== 2) throw new Error('SDK v2 runtime requires a schema-v2 manifest.')
    this.worker = factory(safeUrl(workerUrl))
    this.ready = new Promise<void>((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject })
    const startup = window.setTimeout(() => this.fail(new Error(`Extension ${manifest.id} did not become ready within ${START_TIMEOUT_MS} ms.`)), START_TIMEOUT_MS)
    this.worker.addEventListener('message', (event) => {
      try {
        bounded(event.data)
        const message = event.data
        if (!message || message.protocol !== 2) throw new Error('Extension sent an invalid protocol message.')
        if ((message as unknown as { type?: string }).type === 'fatal') throw new Error(`Extension worker ${manifest.id} failed: ${String((message as unknown as { message?: string }).message || 'unknown startup error')}`)
        if (message.type === 'ready') {
          if (message.extensionId !== manifest.id) throw new Error('Worker identity does not match its reviewed manifest.')
          window.clearTimeout(startup); this.readyResolve(); return
        }
        if (message.type === 'host-call') { void this.handleHostCall(message); return }
        if (message.type === 'response') this.handleResponse(message.response)
      } catch (error) { this.fail(error instanceof Error ? error : new Error('Extension protocol failed.')) }
    })
    const crashed = (event: Event) => { const message = (event as ErrorEvent).message; this.fail(new Error(`Extension worker ${manifest.id} crashed${message ? `: ${message}` : '.'}`)) }
    this.worker.addEventListener('error', crashed); this.worker.addEventListener('messageerror', crashed)
  }

  private async handleHostCall(message: Extract<WorkerTransportMessageV2, { type: 'host-call' }>) {
    const permission = permissionFor(message.method)
    if (permission && !this.manifest.permissions.includes(permission)) { this.sendHostError(message.callId, 'permission-denied', `Permission ${permission} is required.`); return }
    try {
      let value: unknown
      if (message.method === 'applyPatch') {
        const patch = message.args[0] as Parameters<ExtensionHostV2['applyPatch']>[0]
        if (patch.owner.type !== 'extension' || patch.owner.extensionId !== this.manifest.id) throw new Error('Patch ownership does not match the extension manifest.')
        value = await this.host.applyPatch(patch)
      } else if (message.method === 'createMedia') value = await this.host.createMedia(message.args[0] as Parameters<ExtensionHostV2['createMedia']>[0])
      else if (message.method === 'fetch') value = await this.host.fetch(message.args[0] as Parameters<ExtensionHostV2['fetch']>[0])
      else if (message.method === 'cancel') value = await this.host.cancel(String(message.args[0]))
      else if (message.method === 'secrets.read') value = await this.host.secrets.read(message.args[0] as string[])
      else if (message.method === 'secrets.mutate') value = await this.host.secrets.mutate(message.args[0] as Parameters<ExtensionHostV2['secrets']['mutate']>[0])
      else if (message.method === 'config.read') value = await this.host.config.read()
      else if (message.method === 'config.write') value = await this.host.config.write(message.args[0])
      else if (message.method === 'content.listNotes') value = await this.host.content.listNotes(message.args[0] as Parameters<ExtensionHostV2['content']['listNotes']>[0])
      else if (message.method === 'migration.exportWorkspace') value = await this.host.migration.exportWorkspace()
      else value = await this.host.migration.commit(message.args[0] as Parameters<ExtensionHostV2['migration']['commit']>[0])
      this.worker.postMessage(bounded({ protocol: 2, type: 'host-result', callId: message.callId, ok: true, value } satisfies WorkerTransportMessageV2))
    } catch (error) { this.sendHostError(message.callId, 'host-call-failed', error instanceof Error ? error.message : 'Host call failed.') }
  }

  private sendHostError(callId: string, code: string, message: string) { this.worker.postMessage({ protocol: 2, type: 'host-result', callId, ok: false, error: { code, message: message.slice(0, 500) } } satisfies WorkerTransportMessageV2) }

  private handleResponse(response: WorkerContributionResponse) {
    const entry = this.pending.get(response.requestId)
    if (!entry) throw new Error(`Extension returned an unknown or duplicate request id ${response.requestId}.`)
    this.pending.delete(response.requestId); window.clearTimeout(entry.timeout)
    if (response.type === 'planning-signals') {
      if (response.signals.some((value) => !value.itemId || !Number.isFinite(value.score) || value.reason.length > 500)) { entry.reject(new Error('Extension returned invalid planning signals.')); return }
    }
    if (response.type === 'patch' && (response.patch.owner.type !== 'extension' || response.patch.owner.extensionId !== this.manifest.id)) { entry.reject(new Error('Extension returned a patch for another owner.')); return }
    if (response.type === 'error') { entry.reject(new Error(`${response.code}: ${response.message}`)); return }
    entry.resolve(response)
  }

  async execute(request: WorkerContributionRequest, timeoutMs = DEFAULT_TIMEOUT_MS) {
    if (this.closed) throw new Error('Extension worker is closed.')
    await this.ready
    bounded(request)
    const id = requestId(request)
    if (!id.trim() || this.pending.has(id)) throw new Error('Extension requests require a unique request id.')
    if (this.pending.size >= MAX_PENDING) throw new Error(`Extension worker queue is limited to ${MAX_PENDING} requests.`)
    const timeout = Math.max(100, Math.min(180_000, timeoutMs))
    return new Promise<WorkerContributionResponse>((resolve, reject) => {
      const handle = window.setTimeout(() => { this.pending.delete(id); void this.host.cancel(id).catch(() => undefined); reject(new Error(`Extension request ${id} exceeded ${timeout} ms.`)) }, timeout)
      this.pending.set(id, { resolve, reject, timeout: handle })
      this.worker.postMessage({ protocol: 2, type: 'request', request } satisfies WorkerTransportMessageV2)
    })
  }

  async waitUntilReady() { await this.ready }

  close() { if (this.closed) return; this.closed = true; this.worker.terminate(); this.fail(new Error('Extension worker was closed.'), false) }
  private fail(error: Error, terminate = true) {
    if (terminate && !this.closed) { this.closed = true; this.worker.terminate() }
    this.readyReject(error)
    for (const entry of this.pending.values()) { window.clearTimeout(entry.timeout); entry.reject(error) }
    this.pending.clear()
  }
}

export type SandboxedUiLifecycleEventV2 = { type: 'ready' } | { type: 'error'; message: string } | { type: 'resize'; height: number }
export interface SandboxedUiRuntimeV2 { iframe: HTMLIFrameElement; post(name: string, payload: unknown): void; close(): void }

export const createSandboxedExtensionUiV2 = (manifest: ExtensionManifestV2, contributionId: string, entryUrl: string, init: Omit<SandboxedUiInit, 'type' | 'extensionId' | 'contributionId'>, hostCall?: (name: string, payload: unknown) => Promise<unknown>, onLifecycle?: (event: SandboxedUiLifecycleEventV2) => void): SandboxedUiRuntimeV2 => {
  const contribution = manifest.uiEntries?.find((value) => value.id === contributionId)
  if (!contribution) throw new Error(`Unknown UI contribution ${contributionId}.`)
  const entry = safeUrl(entryUrl)
  const iframe = document.createElement('iframe')
  iframe.title = `${manifest.name}: ${contributionId}`
  iframe.setAttribute('sandbox', 'allow-scripts')
  iframe.referrerPolicy = 'no-referrer'
  iframe.className = `extension-ui-frame-v2 extension-ui-frame-v2-${contribution.surface}`
  const escapedEntry = entry.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  const escapedLocale = init.locale.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  const escapedTitle = `${manifest.name}: ${contribution.label || contributionId}`.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  const frameDocument = `<!doctype html><html lang="${escapedLocale}" data-theme="${init.theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapedTitle}</title><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src file: neoanki-extension: blob: http://127.0.0.1:* http://localhost:*; style-src 'unsafe-inline'; img-src data: blob:; media-src blob: neoanki-media:; connect-src 'none'; font-src 'none'; base-uri 'none'; form-action 'none'"><style>html,body,#root{margin:0;min-height:0!important;height:auto!important;font:16px/1.5 system-ui,sans-serif}</style></head><body><div id="root"></div><script type="module" src="${escapedEntry}"></script></body></html>`
  iframe.src = `data:text/html;base64,${btoa(frameDocument)}`
  const channel = new MessageChannel(); channel.port1.start()
  let closed = false
  channel.port1.onmessage = (event: MessageEvent<SandboxedUiMessageV2>) => {
    try {
      bounded(event.data)
      const message = event.data
      if (!message || message.protocol !== 2) return
      if (message.type === 'ready') { onLifecycle?.({ type: 'ready' }); return }
      if (message.type === 'error' && !message.id) {
        const detail = message.payload as { message?: unknown } | undefined
        onLifecycle?.({ type: 'error', message: typeof detail?.message === 'string' ? detail.message : 'Extension UI failed to start.' })
        return
      }
      if (message.type === 'event' && message.name === 'resize') {
        const requested = Number((message.payload as { height?: unknown } | undefined)?.height)
        if (Number.isFinite(requested)) onLifecycle?.({ type: 'resize', height: Math.max(96, Math.min(MAX_UI_FRAME_HEIGHT, requested)) })
        return
      }
      if (message.type !== 'host-call' || !message.id || !message.name || !hostCall) return
      void hostCall(message.name, message.payload).then((payload) => channel.port1.postMessage({ protocol: 2, type: 'host-result', id: message.id, payload } satisfies SandboxedUiMessageV2)).catch((error) => channel.port1.postMessage({ protocol: 2, type: 'error', id: message.id, payload: { message: error instanceof Error ? error.message : 'Host call failed.' } } satisfies SandboxedUiMessageV2))
    } catch { channel.port1.close() }
  }
  iframe.addEventListener('load', () => {
    if (closed || !iframe.contentWindow) return
    const message: SandboxedUiInit = { type: 'neo-anki:init-ui-v2', extensionId: manifest.id, contributionId, ...structuredClone(init) }
    bounded(message); iframe.contentWindow.postMessage(message, '*', [channel.port2])
  }, { once: true })
  iframe.addEventListener('error', () => onLifecycle?.({ type: 'error', message: 'The extension interface could not be loaded.' }), { once: true })
  return {
    iframe,
    post(name, payload) { if (closed) throw new Error('Extension UI is closed.'); channel.port1.postMessage(bounded({ protocol: 2, type: 'event', name, payload } satisfies SandboxedUiMessageV2)) },
    close() { if (closed) return; closed = true; channel.port1.close(); iframe.remove() },
  }
}
