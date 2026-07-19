import type { AppData, KnowledgeItem } from '../../types.js'
import type { ExtensionManifestV2 } from '../../../packages/extension-sdk/src/index.js'
import type { KnowledgeItemProjection } from '../../../packages/compatibility-domain/src/index.js'
import { createExtensionHostV2 } from './host.js'
import { ExtensionWorkerRuntimeV2 } from './runtime.js'

export interface ExtensionUiContributionV2 { extensionId: string; manifest: ExtensionManifestV2; id: string; surface: 'settings' | 'review' | 'page'; url: string; route: string; label: string }
const workers = new Map<string, ExtensionWorkerRuntimeV2>()
let uiContributions: ExtensionUiContributionV2[] = []
let planningSignals = new Map<string, Array<{ id: string; label: string; score: number }>>()
let planningGeneration = 0

export const initializeExtensionRegistryV2 = async (records: NeoAnkiInstalledExtension[]) => {
  planningGeneration += 1
  for (const runtime of workers.values()) runtime.close()
  workers.clear(); uiContributions = []; planningSignals = new Map()
  for (const record of records) {
    if (record.manifest.sdkVersion !== 2) continue
    const manifest = record.manifest as ExtensionManifestV2
    try {
      const bridge = window.neoAnkiDesktop
      if (!bridge) throw new Error('SDK v2 local entries require the desktop host.')
      if (manifest.workerEntry) {
        if (!record.workerEntryUrl) throw new Error('Reviewed worker entry is missing.')
        workers.set(manifest.id, new ExtensionWorkerRuntimeV2(manifest, record.workerEntryUrl, createExtensionHostV2(manifest.id)))
      }
      for (const ui of manifest.uiEntries || []) {
        const reviewed = record.uiEntryUrls?.find((value) => value.id === ui.id)
        if (!reviewed || reviewed.surface !== ui.surface) throw new Error(`Reviewed UI entry ${ui.id} is missing.`)
        uiContributions.push({ extensionId: manifest.id, manifest, id: ui.id, surface: ui.surface, url: reviewed.url, route: `extension-v2:${manifest.id}:${ui.id}`, label: manifest.name })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'SDK v2 entry loading failed.'
      void window.neoAnkiDesktop?.reportDiagnostic({ source: 'extension-host', level: 'error', code: 'extension-v2-load', message: `${manifest.id}: ${message}` })
    }
  }
}

export const extensionUiContributionsV2 = (surface?: ExtensionUiContributionV2['surface']) => uiContributions.filter((value) => !surface || value.surface === surface)
export const extensionPageV2 = (route: string) => uiContributions.find((value) => value.surface === 'page' && value.route === route)

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
  const items = await projections(data)
  for (const [extensionId, runtime] of workers) {
    if (!runtime.manifest.permissions.includes('study:signals')) continue
    for (let offset = 0; offset < items.length; offset += 2_000) {
      const requestId = crypto.randomUUID()
      const response = await runtime.execute({ type: 'planning-signals', request: { requestId, contributionId: 'planning-signals', now: new Date().toISOString(), items: items.slice(offset, offset + 2_000) } }, 30_000)
      if (response.type !== 'planning-signals') continue
      for (const signal of response.signals) next.set(signal.itemId, [...(next.get(signal.itemId) || []), { id: `${extensionId}:planning-signals`, label: signal.reason, score: Math.max(-1, Math.min(1, signal.score)) }])
    }
  }
  if (generation === planningGeneration) planningSignals = next
}

export const planningSignalsForItemV2 = (item: KnowledgeItem) => planningSignals.get(item.id) || []

export const executeExtensionCommandV2 = async (extensionId: string, commandId: string, payload: unknown) => {
  const runtime = workers.get(extensionId)
  if (!runtime) throw new Error(`Extension ${extensionId} has no active worker.`)
  if (!commandId.trim() || commandId.length > 120) throw new Error('Extension command id is invalid.')
  const requestId = crypto.randomUUID()
  const response = await runtime.execute({ type: 'command', requestId, commandId, payload }, 180_000)
  if (response.type === 'result') return response.value
  if (response.type === 'patch') throw new Error('UI commands must commit patches through the worker host before returning.')
  throw new Error(`Extension ${extensionId} returned an invalid command response.`)
}
