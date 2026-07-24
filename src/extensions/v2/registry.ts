import type { AppData, KnowledgeItem, PracticeCard } from '../../types.js'
import type { ExtensionAuthoringActionContributionV2, ExtensionAuthoringActionStatusV1, ExtensionCardInputV2, ExtensionManifestV2, ExtensionSettingsContributionV1, ExtensionUiSurfaceV2, KnowledgeDraftV1 } from '../../../packages/extension-sdk/src/index.js'
import type { KnowledgeItemProjection } from '../../../packages/compatibility-domain/src/index.js'
import { createExtensionHostV2 } from './host.js'
import { ExtensionWorkerRuntimeV2 } from './runtime.js'

export interface ExtensionUiContributionV2 {
  extensionId: string
  manifest: ExtensionManifestV2
  id: string
  surface: ExtensionUiSurfaceV2
  url: string
  route: string
  label: string
  description?: string
  helpText?: string
  icon?: string
  launchDestination?: string
}
export interface ExtensionSettingsContributionV2 {
  extensionId: string
  manifest: ExtensionManifestV2
  id: 'settings'
  surface: 'settings'
  settings: ExtensionSettingsContributionV1
  label: string
  description?: string
}
const workers = new Map<string, ExtensionWorkerRuntimeV2>()
let uiContributions: ExtensionUiContributionV2[] = []
let settingsContributions: ExtensionSettingsContributionV2[] = []
let planningSignals = new Map<string, Array<{ id: string; label: string; score: number }>>()
let queueScores = new Map<string, number>()
let libraryPresets: Array<{ id: string; label: string; query: string; collection?: string }> = []
let planningGeneration = 0
let uiActivationReadiness = new Map<string, { expected: Set<string>; ready: Set<string> }>()

export const initializeExtensionRegistryV2 = async (records: NeoAnkiInstalledExtension[]) => {
  planningGeneration += 1
  for (const runtime of workers.values()) runtime.close()
  workers.clear(); uiContributions = []; settingsContributions = []; planningSignals = new Map(); queueScores = new Map(); libraryPresets = []; uiActivationReadiness = new Map()
  let reloadAfterRollback = false
  for (const record of records) {
    if (record.manifest.sdkVersion !== 2) continue
    const manifest = record.manifest as ExtensionManifestV2
    let workerRuntime: ExtensionWorkerRuntimeV2 | undefined
    try {
      const bridge = window.neoAnkiDesktop
      if (!bridge) throw new Error('SDK v2 local entries require the desktop host.')
      if (manifest.workerEntry) {
        if (!record.workerEntryUrl) throw new Error('Reviewed worker entry is missing.')
        workerRuntime = new ExtensionWorkerRuntimeV2(manifest, record.workerEntryUrl, createExtensionHostV2(manifest.id))
        await workerRuntime.waitUntilReady()
        workers.set(manifest.id, workerRuntime)
      }
      for (const ui of manifest.uiEntries || []) {
        const reviewed = record.uiEntryUrls?.find((value) => value.id === ui.id)
        if (!reviewed || reviewed.surface !== ui.surface) throw new Error(`Reviewed UI entry ${ui.id} is missing.`)
        uiContributions.push({ extensionId: manifest.id, manifest, id: ui.id, surface: ui.surface, url: reviewed.url, route: `extension-v2:${manifest.id}:${ui.id}`, label: ui.label || manifest.name, description: ui.description, helpText: ui.helpText, icon: ui.icon, launchDestination: ui.launchDestination })
      }
      if (manifest.settings) settingsContributions.push({ extensionId: manifest.id, manifest, id: 'settings', surface: 'settings', settings: manifest.settings, label: manifest.settings.label || manifest.name, description: manifest.settings.description || manifest.description })
      if (manifest.uiEntries?.length) uiActivationReadiness.set(manifest.id, { expected: new Set(manifest.uiEntries.map((entry) => entry.id)), ready: new Set() })
      else await bridge.confirmExtensionActivation?.(manifest.id)
    } catch (error) {
      workerRuntime?.close()
      workers.delete(manifest.id)
      uiContributions = uiContributions.filter((entry) => entry.extensionId !== manifest.id)
      settingsContributions = settingsContributions.filter((entry) => entry.extensionId !== manifest.id)
      const message = error instanceof Error ? error.message : 'SDK v2 entry loading failed.'
      void window.neoAnkiDesktop?.reportDiagnostic({ source: 'extension-host', level: 'error', code: 'extension-v2-load', message: `${manifest.id}: ${message}` })
      try {
        if (await window.neoAnkiDesktop?.rollbackExtensionActivation?.(manifest.id)) {
          reloadAfterRollback = true
          void window.neoAnkiDesktop?.reportDiagnostic({ source: 'extension-host', level: 'warning', code: 'extension-v2-rollback', message: `${manifest.id}: activation failed, so NeoAnki restored the previous installed version.` })
        }
      } catch (rollbackError) {
        void window.neoAnkiDesktop?.reportDiagnostic({ source: 'extension-host', level: 'error', code: 'extension-v2-rollback-failed', message: `${manifest.id}: ${rollbackError instanceof Error ? rollbackError.message : 'The previous version could not be restored.'}` })
      }
    }
  }
  if (reloadAfterRollback) await window.neoAnkiDesktop?.reloadForExtensions()
}

export const markExtensionUiReadyV2 = async (extensionId: string, contributionId: string) => {
  const activation = uiActivationReadiness.get(extensionId)
  if (!activation || !activation.expected.has(contributionId)) return
  activation.ready.add(contributionId)
  if ([...activation.expected].every((id) => activation.ready.has(id))) {
    await window.neoAnkiDesktop?.confirmExtensionActivation?.(extensionId)
    uiActivationReadiness.delete(extensionId)
  }
}

export const rollbackPendingExtensionActivationV2 = async (extensionId: string, message: string) => {
  const bridge = window.neoAnkiDesktop
  if (!bridge?.rollbackExtensionActivation || !await bridge.rollbackExtensionActivation(extensionId)) return false
  uiActivationReadiness.delete(extensionId)
  await bridge.reportDiagnostic({ source: 'extension-host', level: 'warning', code: 'extension-ui-rollback', message: `${extensionId}: ${message} Neo Anki restored the previous installed version.` })
  await bridge.reloadForExtensions()
  return true
}

export const extensionUiContributionsV2 = (surface?: ExtensionUiContributionV2['surface']) => uiContributions.filter((value) => !surface || value.surface === surface)
export const extensionSettingsContributionsV2 = () => [...settingsContributions]
export const extensionPageV2 = (route: string) => uiContributions.find((value) => value.surface === 'page' && value.route === route)
export const extensionAuthoringActionsV2 = (): Array<ExtensionAuthoringActionContributionV2 & { extensionId: string; extensionName: string }> => [...workers.values()].flatMap((runtime) => (runtime.manifest.contributions?.authoringActions || []).map((value) => ({ ...value, extensionId: runtime.manifest.id, extensionName: runtime.manifest.name })))
export const extensionQueuePoliciesV2 = () => [...workers.values()].flatMap((runtime) => (runtime.manifest.contributions?.queuePolicies || []).map((value) => ({ ...value, extensionId: runtime.manifest.id })))
export const extensionLibraryPresetsV2 = () => [...libraryPresets]
const cardInput = (card: PracticeCard): ExtensionCardInputV2 => ({ id: card.id, itemId: card.itemId, variant: card.variant, occlusionId: card.occlusionId, promptData: card.promptData, estimatedSeconds: card.estimatedSeconds, suspended: card.suspended, dueAt: card.fsrs.due, difficulty: card.fsrs.difficulty, lapses: card.fsrs.lapses })

export const executeAuthoringActionV2 = async (extensionId: string, actionId: string, itemId: string, idempotencyKey: string, draft: KnowledgeDraftV1) => {
  const runtime = workers.get(extensionId)
  if (!runtime?.manifest.contributions?.authoringActions?.some((action) => action.id === actionId)) throw new Error('This authoring action is no longer available. Re-enable its extension and try again.')
  const requestId = crypto.randomUUID()
  const response = await runtime.execute({ type: 'authoring-action', requestId, actionId, itemId, idempotencyKey, draft }, 180_000)
  if (response.type === 'error') throw new Error(response.message)
  if (response.type !== 'result') throw new Error(`${runtime.manifest.name} returned an invalid authoring result.`)
  return response.value
}

export const authoringActionStatusesV2 = async (draft: KnowledgeDraftV1) => {
  const statuses = new Map<string, ExtensionAuthoringActionStatusV1>()
  await Promise.all(extensionAuthoringActionsV2().map(async (action) => {
    const key = `${action.extensionId}:${action.id}`
    if (action.availability !== 'status-required') { statuses.set(key, { available: true, configured: true }); return }
    const runtime = workers.get(action.extensionId)
    if (!runtime) { statuses.set(key, { available: false, configured: false, reason: 'This extension is not available.' }); return }
    try {
      const response = await runtime.execute({ type: 'authoring-action-status', requestId: crypto.randomUUID(), actionId: action.id, draft }, 30_000)
      if (response.type !== 'result' || !response.value || typeof response.value !== 'object') throw new Error('The extension returned an invalid availability status.')
      const value = response.value as Partial<ExtensionAuthoringActionStatusV1>
      statuses.set(key, { available: value.available === true, configured: value.configured === true, ...(typeof value.reason === 'string' ? { reason: value.reason } : {}), ...(typeof value.selectionLabel === 'string' ? { selectionLabel: value.selectionLabel } : {}) })
    } catch (error) { statuses.set(key, { available: false, configured: false, reason: error instanceof Error ? error.message : 'Availability could not be checked.' }) }
  }))
  return statuses
}

export const scoreQueuePolicyV2 = (policyId: string, cardId: string) => queueScores.get(`${policyId}:${cardId}`)

const projections = async (data: AppData): Promise<KnowledgeItemProjection[]> => {
  const itemById = new Map(data.items.map((value) => [value.id, value]))
  const result: KnowledgeItemProjection[] = []
  for (let offset = 0; offset < data.cards.length; offset += 2_000) {
    for (const card of data.cards.slice(offset, offset + 2_000)) {
      const item = itemById.get(card.itemId)
      result.push({ noteId: card.itemId, cardId: card.id, prompt: item?.prompt || '', answer: item?.answer || '', deckName: item?.collection || 'Missing deck', tags: [...(item?.tags || [])], suspended: card.suspended, dueAt: card.fsrs.due })
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
  }
  return result
}

export const refreshExtensionPlanningSignalsV2 = async (data: AppData) => {
  const generation = ++planningGeneration
  const next = new Map<string, Array<{ id: string; label: string; score: number }>>()
  const nextQueueScores = new Map<string, number>()
  const nextLibraryPresets: typeof libraryPresets = []
  const items = await projections(data)
  for (const [extensionId, runtime] of workers) {
    if (runtime.manifest.permissions.includes('study:signals')) {
      for (let offset = 0; offset < items.length; offset += 2_000) {
        const requestId = crypto.randomUUID()
        const response = await runtime.execute({ type: 'planning-signals', request: { requestId, contributionId: 'planning-signals', now: new Date().toISOString(), items: items.slice(offset, offset + 2_000) } }, 30_000)
        if (response.type !== 'planning-signals') continue
        for (const signal of response.signals) next.set(signal.itemId, [...(next.get(signal.itemId) || []), { id: `${extensionId}:planning-signals`, label: signal.reason, score: Math.max(-1, Math.min(1, signal.score)) }])
      }
    }
    for (const policy of runtime.manifest.contributions?.queuePolicies || []) {
      for (let offset = 0; offset < data.cards.length; offset += 2_000) {
        const now = Date.now(); const candidates = data.cards.slice(offset, offset + 2_000).map((card) => ({ card: cardInput(card), overdueDays: Math.max(0, (now - Date.parse(card.fsrs.due)) / 86_400_000), extensionBoost: 0 }))
        const requestId = crypto.randomUUID(); const response = await runtime.execute({ type: 'queue-score', requestId, policyId: policy.id, candidates }, 30_000)
        if (response.type !== 'result' || !Array.isArray(response.value)) continue
        response.value.forEach((score, index) => { if (Number.isFinite(score)) nextQueueScores.set(`${policy.id}:${candidates[index].card.id}`, Number(score)) })
      }
    }
    if (runtime.manifest.contributions?.libraryPresets?.length) {
      const requestId = crypto.randomUUID(); const response = await runtime.execute({ type: 'library-presets', requestId })
      if (response.type === 'result' && Array.isArray(response.value)) for (const preset of response.value as typeof libraryPresets) if (preset?.id && preset?.label && typeof preset.query === 'string') nextLibraryPresets.push({ ...preset, id: `${extensionId}:${preset.id}` })
    }
  }
  if (generation === planningGeneration) { planningSignals = next; queueScores = nextQueueScores; libraryPresets = nextLibraryPresets }
}

export const planningSignalsForItemV2 = (item: KnowledgeItem) => planningSignals.get(item.id) || []

export const executeExtensionCommandV2 = async (extensionId: string, commandId: string, payload: unknown) => {
  const runtime = workers.get(extensionId)
  if (!runtime) throw new Error(`Extension ${extensionId} has no active worker.`)
  if (!commandId.trim() || commandId.length > 120) throw new Error('Extension command id is invalid.')
  const requestId = crypto.randomUUID()
  const response = await runtime.execute({ type: 'command', requestId, commandId, payload }, 30 * 60_000)
  if (response.type === 'result') return response.value
  if (response.type === 'patch') throw new Error('UI commands must commit patches through the worker host before returning.')
  throw new Error(`Extension ${extensionId} returned an invalid command response.`)
}
