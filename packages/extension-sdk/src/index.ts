import type { KnowledgeItemProjection, WorkspacePatchV2 } from '@neo-anki/compatibility-domain'

export type ExtensionPermissionV2 = 'study:read' | 'study:signals' | 'study:prompt-types' | 'study:queue-policies' | 'content:read' | 'content:patch-own' | 'content:migrate' | 'media:create' | 'files:save' | 'ui:open-external' | 'network:fetch' | 'secrets:device' | 'config:sync' | 'ui:review' | 'ui:page' | 'ui:create' | 'ui:workspace' | 'ui:migration'
export type ExtensionUiSurfaceV2 = 'review' | 'page' | 'create' | 'workspace' | 'migration'
export type ExtensionPromptRequiredFieldV2 = 'prompt' | 'answer' | 'audio' | 'image' | 'occlusions'
export interface ExtensionPromptTypeContributionV2 { id: string; label: string; description?: string; authoringHint?: string; requiredFields?: ExtensionPromptRequiredFieldV2[] }
export interface ExtensionQueuePolicyContributionV2 { id: string; label: string }
export interface ExtensionLibraryPresetContributionV2 { id: string; label: string }
export interface ExtensionAuthoringActionContributionV2 {
  id: string
  label: string
  description?: string
  defaultSelected?: boolean
  availability?: 'always' | 'status-required'
  configurationDestination?: string
}

export type ExtensionSettingsScalarV1 = string | number | boolean | null
export type ExtensionSettingsConditionOperatorV1 = 'equals' | 'not-equals' | 'includes' | 'truthy' | 'falsy' | 'greater-than' | 'greater-than-or-equal' | 'less-than' | 'less-than-or-equal'
export interface ExtensionSettingsConditionV1 {
  path: string
  scope?: 'current' | 'root'
  operator: ExtensionSettingsConditionOperatorV1
  value?: ExtensionSettingsScalarV1
}
export interface ExtensionSettingsControlBaseV1 {
  id: string
  label?: string
  description?: string
  visibleWhen?: ExtensionSettingsConditionV1
  enabledWhen?: ExtensionSettingsConditionV1
}
export interface ExtensionSettingsStoredControlBaseV1 extends ExtensionSettingsControlBaseV1 {
  path: string
  required?: boolean
  requiredWhen?: ExtensionSettingsConditionV1
}
export interface ExtensionSettingsToggleV1 extends ExtensionSettingsStoredControlBaseV1 { kind: 'toggle'; defaultValue?: boolean }
export interface ExtensionSettingsTextV1 extends ExtensionSettingsStoredControlBaseV1 {
  kind: 'text' | 'textarea'
  defaultValue?: string
  placeholder?: string
  minLength?: number
  maxLength?: number
  pattern?: string
}
export interface ExtensionSettingsNumberV1 extends ExtensionSettingsStoredControlBaseV1 {
  kind: 'number' | 'range'
  defaultValue?: number
  min?: number
  max?: number
  step?: number
}
export interface ExtensionSettingsSelectV1 extends ExtensionSettingsStoredControlBaseV1 {
  kind: 'select'
  defaultValue?: string
  options: Array<{ value: string; label: string }>
}
export interface ExtensionSettingsStringListV1 extends ExtensionSettingsStoredControlBaseV1 {
  kind: 'string-list'
  defaultValue?: string[]
  placeholder?: string
  minItems?: number
  maxItems?: number
  itemMinLength?: number
  itemMaxLength?: number
  unique?: boolean
}
export interface ExtensionSettingsNoticeV1 extends ExtensionSettingsControlBaseV1 {
  kind: 'notice'
  text: string
  tone?: 'neutral' | 'info' | 'warning' | 'privacy'
}
export interface ExtensionSettingsSecretV1 extends ExtensionSettingsControlBaseV1 {
  kind: 'secret'
  secretKey: string
  placeholder?: string
}
export interface ExtensionSettingsGroupV1 extends ExtensionSettingsStoredControlBaseV1 {
  kind: 'group'
  addLabel?: string
  itemLabelPath?: string
  itemIdPath?: string
  minItems?: number
  maxItems?: number
  defaultItems?: Array<Record<string, unknown>>
  newItem?: Record<string, unknown>
  fields: ExtensionSettingsControlV1[]
}
export type ExtensionSettingsControlV1 = ExtensionSettingsToggleV1 | ExtensionSettingsTextV1 | ExtensionSettingsNumberV1 | ExtensionSettingsSelectV1 | ExtensionSettingsStringListV1 | ExtensionSettingsNoticeV1 | ExtensionSettingsSecretV1 | ExtensionSettingsGroupV1
export interface ExtensionSettingsSectionV1 {
  id: string
  title: string
  description?: string
  controls: ExtensionSettingsControlV1[]
}
export interface ExtensionSettingsContributionV1 {
  schemaVersion: 1
  label?: string
  description?: string
  helpText?: string
  icon?: string
  sections: ExtensionSettingsSectionV1[]
}

export interface ExtensionUiEntryV2 {
  id: string
  surface: ExtensionUiSurfaceV2
  entry: string
  /** Host-rendered product copy. Older packages may omit every metadata field. */
  label?: string
  description?: string
  helpText?: string
  icon?: string
  launchDestination?: string
}

export interface ExtensionManifestV2 {
  format: 'neo-anki-extension'; schemaVersion: 2; sdkVersion: 2; id: string; name: string; version: string; publisher: string; publisherKey: string
  description?: string; homepage?: string; minimumNeoAnkiVersion?: string; permissions: ExtensionPermissionV2[]; networkDomains?: string[]; workerEntry?: string
  uiEntries?: ExtensionUiEntryV2[]
  settings?: ExtensionSettingsContributionV1
  contributions?: { promptTypes?: ExtensionPromptTypeContributionV2[]; queuePolicies?: ExtensionQueuePolicyContributionV2[]; libraryPresets?: ExtensionLibraryPresetContributionV2[]; authoringActions?: ExtensionAuthoringActionContributionV2[] }
  provenance: { sourceCommit: string; coreCommit?: string; buildSystem: string }
}

export interface ScopedStudyDto { requestId: string; contributionId: string; now: string; items: ReadonlyArray<Readonly<KnowledgeItemProjection>> }
export interface ExtensionNetworkRequestV2 { operationId: string; url: string; method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; headers?: Record<string, string>; body?: Uint8Array; timeoutMs?: number; maximumResponseBytes?: number }
export interface ExtensionNetworkResponseV2 { status: number; headers: Record<string, string>; body: Uint8Array }
export interface MediaCreateRequest { operationId: string; filename: string; mimeType: string; bytes: Uint8Array; altText?: string }
export interface ExtensionContentNoteDto { noteId: string; profileId: string; prompt: string; answer: string; context: string; deckName: string; tags: string[]; record?: { id: string; revision: number; createdAt: string; updatedAt: string; value: unknown } }
export interface ExtensionContentPageDto { workspaceRevision: number; notes: ExtensionContentNoteDto[]; availableMediaIds: string[]; nextCursor?: string }
export interface ExtensionContentQuery { cursor?: string; limit?: number; noteIds?: string[] }
export interface ExtensionMigrationMediaV2 { id: string; filename: string; mimeType: string; dataUrl: string; bytes?: Uint8Array; altText: string; byteLength: number; hash: string; createdAt: string; updatedAt: string }
export interface ExtensionMigrationCommitV2 { document: unknown; media: ExtensionMigrationMediaV2[]; sourceArchive?: Uint8Array; operation: 'additive' | 'replace-profile' }

export interface ExtensionHostV2 {
  applyPatch(patch: WorkspacePatchV2): Promise<{ workspaceRevision: number }>
  createMedia(request: MediaCreateRequest): Promise<{ id: string; sha256: string; byteLength: number; workspaceRevision: number }>
  fetch(request: ExtensionNetworkRequestV2): Promise<ExtensionNetworkResponseV2>
  cancel(operationId: string): Promise<void>
  secrets: { read(keys: string[]): Promise<Record<string, string | null>>; mutate(changes: Array<{ op: 'set'; key: string; value: string } | { op: 'delete'; key: string }>): Promise<void> }
  config: { read<T = unknown>(): Promise<T | null>; write(value: unknown): Promise<{ workspaceRevision: number }> }
  content: { listNotes(query?: ExtensionContentQuery): Promise<ExtensionContentPageDto> }
  migration: { exportWorkspace(): Promise<{ document: unknown; media: ExtensionMigrationMediaV2[] }>; commit(input: ExtensionMigrationCommitV2): Promise<{ workspaceRevision: number }> }
}

export type ExtensionPromptInputV2 = { prompt: string; answer: string; context: string; collection: string; tags: string[]; citations: Array<{ id?: string; title: string; url?: string }>; mediaIds: string[]; occlusions: Array<{ id: string; x: number; y: number; width: number; height: number; label?: string }>; assets?: Array<{ id: string; filename: string; mimeType: string; dataUrl: string; altText?: string }>; variants?: string[] }
export interface KnowledgeDraftV1 { prompt: string; answer: string; context: string; collection: string; tags: string[]; selectedPromptTypes: string[]; mediaIds: string[] }
export interface ExtensionAuthoringActionStatusV1 { available: boolean; configured: boolean; reason?: string; selectionLabel?: string }
export interface ExtensionPromptValidationV2 { valid: boolean; fieldErrors: Partial<Record<ExtensionPromptRequiredFieldV2, string>> }
export type ExtensionCardInputV2 = { id: string; itemId: string; variant: string; occlusionId?: string; promptData?: Record<string, unknown>; estimatedSeconds: number; suspended: boolean; dueAt: string; difficulty: number; lapses: number }
export type ExtensionRenderedCardV2 = { prompt: string; answer: string; context: string; typed: boolean; mediaId?: string; occlusionId?: string; citations: Array<{ id: string; title: string; url?: string }> }
export type WorkerContributionRequest =
  | { type: 'planning-signals'; request: ScopedStudyDto }
  | { type: 'prompt-create'; requestId: string; promptTypeId: string; input: ExtensionPromptInputV2 }
  | { type: 'prompt-validate'; requestId: string; promptTypeId: string; input: ExtensionPromptInputV2 }
  | { type: 'prompt-render'; requestId: string; promptTypeId: string; item: ExtensionPromptInputV2; card: ExtensionCardInputV2 }
  | { type: 'prompt-compare'; requestId: string; promptTypeId: string; attempt: string; expected: string }
  | { type: 'queue-score'; requestId: string; policyId: string; candidates: Array<{ card: ExtensionCardInputV2; overdueDays: number; extensionBoost: number }> }
  | { type: 'library-presets'; requestId: string }
  | { type: 'authoring-action'; requestId: string; actionId: string; itemId: string; idempotencyKey: string; draft: KnowledgeDraftV1 }
  | { type: 'authoring-action-status'; requestId: string; actionId: string; draft: KnowledgeDraftV1 }
  | { type: 'command'; requestId: string; commandId: string; payload: unknown }
  | { type: 'cancel'; operationId: string }
export type WorkerContributionResponse = { type: 'planning-signals'; requestId: string; signals: Array<{ itemId: string; score: number; reason: string }> } | { type: 'patch'; requestId: string; patch: WorkspacePatchV2 } | { type: 'result'; requestId: string; value: unknown } | { type: 'error'; requestId: string; code: string; message: string }
export interface SandboxedUiAppearanceV1 {
  version: 1
  colors: {
    background: string; surface: string; surfaceStrong: string; surfaceMuted: string
    text: string; textSoft: string; textFaint: string; border: string; borderStrong: string
    primary: string; primaryHover: string; primarySoft: string; onPrimary?: string; success: string; successSoft: string
    warning: string; warningSoft: string; danger: string; dangerSoft: string; focus: string
  }
  typography: { fontFamily: string; fontSize: string; lineHeight: string }
  spacing: { unit: string; density: 'comfortable' | 'compact' }
  radii: { small: string; medium: string; large: string }
  reducedMotion: boolean
}
export interface SandboxedUiInit { type: 'neo-anki:init-ui-v2'; extensionId: string; contributionId: string; locale: string; theme: 'light' | 'dark'; appearance?: SandboxedUiAppearanceV1; dto: unknown }
export interface NeoAnkiExtensionV2 { manifest: ExtensionManifestV2; handle?(request: WorkerContributionRequest, host: ExtensionHostV2): Promise<WorkerContributionResponse> }
export const defineExtensionV2 = <T extends NeoAnkiExtensionV2>(extension: T): T => extension

export type ExtensionHostMethodV2 = 'applyPatch' | 'createMedia' | 'fetch' | 'cancel' | 'secrets.read' | 'secrets.mutate' | 'config.read' | 'config.write' | 'content.listNotes' | 'migration.exportWorkspace' | 'migration.commit'
export type WorkerTransportMessageV2 =
  | { protocol: 2; type: 'ready'; extensionId: string }
  | { protocol: 2; type: 'request'; request: WorkerContributionRequest }
  | { protocol: 2; type: 'response'; response: WorkerContributionResponse }
  | { protocol: 2; type: 'host-call'; callId: string; method: ExtensionHostMethodV2; args: unknown[] }
  | { protocol: 2; type: 'host-result'; callId: string; ok: true; value: unknown }
  | { protocol: 2; type: 'host-result'; callId: string; ok: false; error: { code: string; message: string } }

export interface SandboxedUiMessageV2 {
  protocol: 2
  type: 'command' | 'event' | 'host-call' | 'host-result' | 'ready' | 'error'
  id?: string
  name?: string
  payload?: unknown
}

export interface SandboxedUiClientV2 {
  readonly init: SandboxedUiInit
  call<T = unknown>(name: 'command', payload: { commandId: string; payload?: unknown }): Promise<T>
  call<T = unknown>(name: 'files.save', payload: { filename: string; mimeType: string; text?: string; bytes?: Uint8Array }): Promise<T>
  call<T = unknown>(name: 'ui.openExternal', payload: { url: string }): Promise<T>
  onEvent(listener: (name: string, payload: unknown) => void): () => void
  reportHeight(height?: number): void
}

const appearanceVariables: Record<string, (appearance: SandboxedUiAppearanceV1) => string> = {
  '--neo-background': (value) => value.colors.background,
  '--neo-surface': (value) => value.colors.surface,
  '--neo-surface-strong': (value) => value.colors.surfaceStrong,
  '--neo-surface-muted': (value) => value.colors.surfaceMuted,
  '--neo-text': (value) => value.colors.text,
  '--neo-text-soft': (value) => value.colors.textSoft,
  '--neo-text-faint': (value) => value.colors.textFaint,
  '--neo-border': (value) => value.colors.border,
  '--neo-border-strong': (value) => value.colors.borderStrong,
  '--neo-primary': (value) => value.colors.primary,
  '--neo-primary-hover': (value) => value.colors.primaryHover,
  '--neo-primary-soft': (value) => value.colors.primarySoft,
  '--neo-on-primary': (value) => value.colors.onPrimary || '#ffffff',
  '--neo-success': (value) => value.colors.success,
  '--neo-success-soft': (value) => value.colors.successSoft,
  '--neo-warning': (value) => value.colors.warning,
  '--neo-warning-soft': (value) => value.colors.warningSoft,
  '--neo-danger': (value) => value.colors.danger,
  '--neo-danger-soft': (value) => value.colors.dangerSoft,
  '--neo-focus': (value) => value.colors.focus,
  '--neo-font-family': (value) => value.typography.fontFamily,
  '--neo-font-size': (value) => value.typography.fontSize,
  '--neo-line-height': (value) => value.typography.lineHeight,
  '--neo-space': (value) => value.spacing.unit,
  '--neo-radius-sm': (value) => value.radii.small,
  '--neo-radius-md': (value) => value.radii.medium,
  '--neo-radius-lg': (value) => value.radii.large,
}

/** Apply host-owned semantic tokens without giving an extension access to host DOM or CSS. */
export const applySandboxedUiAppearanceV1 = (appearance: SandboxedUiAppearanceV1, root: HTMLElement = document.documentElement) => {
  if (appearance.version !== 1) return
  for (const [name, read] of Object.entries(appearanceVariables)) root.style.setProperty(name, read(appearance))
  root.dataset.neoDensity = appearance.spacing.density
  root.dataset.neoReducedMotion = String(appearance.reducedMotion)
  const hex = appearance.colors.background.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1]
  const normalized = hex?.length === 3 ? [...hex].map((value) => value + value).join('') : hex
  const channels = normalized ? [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255) : []
  const luminance = channels.length === 3 ? channels.map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index]!, 0) : 1
  root.style.colorScheme = luminance < .35 ? 'dark' : 'light'
  if (!document.getElementById('neo-anki-extension-base-styles')) {
    const style = document.createElement('style')
    style.id = 'neo-anki-extension-base-styles'
    style.textContent = `html,body{margin:0;min-height:0!important;height:auto!important;font:var(--neo-font-size)/var(--neo-line-height) var(--neo-font-family);color:var(--neo-text);background:var(--neo-background)}*{box-sizing:border-box}button,input,textarea,select{font:inherit;color:inherit}button,input,textarea,select{min-height:2.75rem;border:1px solid var(--neo-border-strong);border-radius:var(--neo-radius-sm);background:var(--neo-surface-strong)}button{cursor:pointer}button:disabled{cursor:not-allowed;opacity:.5}button:focus-visible,a:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:3px solid var(--neo-focus);outline-offset:2px}@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}`
    document.head.append(style)
  }
}

const transportScope = () => globalThis as typeof globalThis & { postMessage(message: unknown): void; addEventListener(type: 'message', listener: (event: MessageEvent<WorkerTransportMessageV2>) => void): void }
const workerRequestId = (request: WorkerContributionRequest) => request.type === 'planning-signals' ? request.request.requestId : request.type === 'cancel' ? request.operationId : request.requestId
const rpcId = () => typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : typeof crypto.getRandomValues === 'function' ? Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(16).padStart(8, '0')).join('-') : `${Date.now()}-${Math.random().toString(36).slice(2)}`

/** Worker-entry bootstrap. Extension code receives only the RPC host, never renderer globals or a workspace snapshot. */
export const exposeExtensionWorkerV2 = (extension: NeoAnkiExtensionV2) => {
  const scope = transportScope()
  const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>()
  const call = (method: ExtensionHostMethodV2, args: unknown[]) => new Promise<unknown>((resolve, reject) => {
    const callId = rpcId(); pending.set(callId, { resolve, reject })
    scope.postMessage({ protocol: 2, type: 'host-call', callId, method, args } satisfies WorkerTransportMessageV2)
  })
  const host: ExtensionHostV2 = {
    applyPatch: (patch) => call('applyPatch', [patch]) as ReturnType<ExtensionHostV2['applyPatch']>,
    createMedia: (request) => call('createMedia', [request]) as ReturnType<ExtensionHostV2['createMedia']>,
    fetch: (request) => call('fetch', [request]) as ReturnType<ExtensionHostV2['fetch']>,
    cancel: (operationId) => call('cancel', [operationId]) as Promise<void>,
    secrets: {
      read: (keys) => call('secrets.read', [keys]) as ReturnType<ExtensionHostV2['secrets']['read']>,
      mutate: (changes) => call('secrets.mutate', [changes]) as Promise<void>,
    },
    config: {
      read: <T = unknown>() => call('config.read', []) as Promise<T | null>,
      write: (value) => call('config.write', [value]) as Promise<{ workspaceRevision: number }>,
    },
    content: { listNotes: (query = {}) => call('content.listNotes', [query]) as Promise<ExtensionContentPageDto> },
    migration: {
      exportWorkspace: () => call('migration.exportWorkspace', []) as ReturnType<ExtensionHostV2['migration']['exportWorkspace']>,
      commit: (input) => call('migration.commit', [input]) as ReturnType<ExtensionHostV2['migration']['commit']>,
    },
  }
  scope.addEventListener('message', (event) => {
    const message = event.data
    if (!message || message.protocol !== 2) return
    if (message.type === 'host-result') {
      const entry = pending.get(message.callId); if (!entry) return
      pending.delete(message.callId)
      if (message.ok) entry.resolve(message.value); else entry.reject(new Error(message.error.message))
      return
    }
    if (message.type !== 'request') return
    if (!extension.handle) { scope.postMessage({ protocol: 2, type: 'response', response: { type: 'error', requestId: workerRequestId(message.request), code: 'unsupported', message: 'This extension has no worker handler.' } } satisfies WorkerTransportMessageV2); return }
    void extension.handle(message.request, host).then((response) => scope.postMessage({ protocol: 2, type: 'response', response } satisfies WorkerTransportMessageV2)).catch((error) => scope.postMessage({ protocol: 2, type: 'response', response: { type: 'error', requestId: workerRequestId(message.request), code: 'extension-error', message: error instanceof Error ? error.message : 'Extension worker failed.' } } satisfies WorkerTransportMessageV2))
  })
  scope.postMessage({ protocol: 2, type: 'ready', extensionId: extension.manifest.id } satisfies WorkerTransportMessageV2)
}

/** Iframe-entry bootstrap. UI talks to core over a transferred MessagePort. */
export const exposeSandboxedUiV2 = (onInit: (init: SandboxedUiInit, port: MessagePort) => void | Promise<void>) => {
  globalThis.addEventListener('message', (event: MessageEvent<SandboxedUiInit>) => {
    if (event.data?.type !== 'neo-anki:init-ui-v2' || !event.ports[0]) return
    document.documentElement.dataset.theme = event.data.theme
    if (event.data.appearance) applySandboxedUiAppearanceV1(event.data.appearance)
    const port = event.ports[0]; port.start()
    void Promise.resolve(onInit(event.data, port)).then(() => port.postMessage({ protocol: 2, type: 'ready' } satisfies SandboxedUiMessageV2)).catch((error) => port.postMessage({ protocol: 2, type: 'error', payload: { message: error instanceof Error ? error.message : 'Extension UI failed.' } } satisfies SandboxedUiMessageV2))
  })
}

/** Iframe bootstrap with a request/response client for the extension's paired worker. */
export const createSandboxedUiClientV2 = () => new Promise<SandboxedUiClientV2>((resolve) => {
  globalThis.addEventListener('message', (event: MessageEvent<SandboxedUiInit>) => {
    const init = event.data; const port = event.ports[0]
    if (init?.type !== 'neo-anki:init-ui-v2' || !port) return
    document.documentElement.dataset.theme = init.theme
    if (init.appearance) applySandboxedUiAppearanceV1(init.appearance)
    const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>()
    const listeners = new Set<(name: string, payload: unknown) => void>()
    port.onmessage = (messageEvent: MessageEvent<SandboxedUiMessageV2>) => {
      const message = messageEvent.data
      if (!message || message.protocol !== 2) return
      if ((message.type === 'host-result' || message.type === 'error') && message.id) {
        const entry = pending.get(message.id); if (!entry) return; pending.delete(message.id)
        if (message.type === 'error') {
          const detail = message.payload as { message?: unknown } | undefined
          entry.reject(new Error(typeof detail?.message === 'string' ? detail.message : 'Extension host call failed.'))
        } else entry.resolve(message.payload)
      } else if (message.type === 'event' && message.name) {
        if (message.name === 'appearance') applySandboxedUiAppearanceV1(message.payload as SandboxedUiAppearanceV1)
        if (message.name === 'theme' && (message.payload === 'light' || message.payload === 'dark')) document.documentElement.dataset.theme = message.payload
        for (const listener of listeners) listener(message.name, message.payload)
      }
    }
    port.start()
    // The document element's scroll height is at least the iframe viewport height,
    // so including it prevents a frame from ever shrinking after its content gets
    // shorter or its responsive layout changes. The body is explicitly reset to
    // auto height by the shared appearance helper and therefore represents the
    // extension's intrinsic content height.
    const reportHeight = (height = document.body?.scrollHeight || document.documentElement.scrollHeight) => port.postMessage({ protocol: 2, type: 'event', name: 'resize', payload: { height } } satisfies SandboxedUiMessageV2)
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => reportHeight())
      observer.observe(document.body || document.documentElement)
    }
    port.postMessage({ protocol: 2, type: 'ready' } satisfies SandboxedUiMessageV2)
    resolve({
      init,
      call: (name, payload) => new Promise((resolveCall, rejectCall) => {
        const id = rpcId(); pending.set(id, { resolve: resolveCall, reject: rejectCall })
        port.postMessage({ protocol: 2, type: 'host-call', id, name, payload } satisfies SandboxedUiMessageV2)
      }),
      onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener) },
      reportHeight,
    })
  }, { once: true })
})

export type ExtensionPackageManifest = ExtensionManifestV2
export type ExtensionPackageManifestV2 = ExtensionManifestV2
export type AnyExtensionPermission = ExtensionPermissionV2
export const createSandboxedUiClient = createSandboxedUiClientV2
export const defineExtension = defineExtensionV2
export const exposeExtensionWorker = exposeExtensionWorkerV2
export const exposeSandboxedUi = exposeSandboxedUiV2
export * from './package-format.js'
