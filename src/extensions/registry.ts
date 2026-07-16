import type { AppData, CreateKnowledgeInput, ImportSummary, KnowledgeItem, PracticeCard, Route } from '../types'
import type { CardSeed, CreationPanelContribution, ExtensionDiagnostic, ExtensionPageContribution, ExtensionPermission, FileExporterContribution, LibraryPreset, NeoAnkiExtension, PlanningSignal, PortableRenderedCard, PromptTypeContribution, QueuePolicyCandidate, SyncTransport, WorkspacePanelContribution } from './sdk'

const contributionPermissions: Array<[keyof NeoAnkiExtension, ExtensionPermission]> = [
  ['promptTypes', 'prompts:contribute'],
  ['importers', 'imports:files'],
  ['exporters', 'exports:files'],
  ['planningSignals', 'planning:signals'],
  ['queuePolicies', 'planning:policies'],
  ['syncTransports', 'sync:transport'],
  ['commands', 'content:transactions'],
  ['pages', 'ui:pages'],
  ['workspacePanels', 'ui:workspace-panels'],
  ['creationPanels', 'ui:create-panels'],
  ['libraryPresets', 'ui:library-presets'],
]
const knownPermissions = new Set(contributionPermissions.map(([, permission]) => permission))
const extensionIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

const fallbackRender = (item: KnowledgeItem): PortableRenderedCard => ({
  prompt: item.prompt,
  answer: item.answer,
  context: item.context,
  typed: false,
  mediaId: item.mediaIds[0],
  citations: item.citations,
})

export class ExtensionRegistry {
  private extensions = new Map<string, NeoAnkiExtension>()
  private diagnostics: ExtensionDiagnostic[] = []

  constructor(extensions: NeoAnkiExtension[] = []) {
    extensions.forEach((extension) => this.register(extension))
  }

  register(extension: NeoAnkiExtension) {
    const { manifest } = extension
    if (!manifest || !extensionIdPattern.test(manifest.id) || !manifest.name?.trim() || !manifest.publisher?.trim() || !semverPattern.test(manifest.version)) throw new Error('Extension manifest identity is invalid.')
    if (manifest.sdkVersion !== 1) throw new Error(`${manifest.name} requires an unsupported extension SDK.`)
    if (new Set(manifest.permissions).size !== manifest.permissions.length || manifest.permissions.some((permission) => !knownPermissions.has(permission))) throw new Error(`${manifest.name} declares invalid extension permissions.`)
    if (this.extensions.has(manifest.id)) throw new Error(`Extension ${manifest.id} is already registered.`)
    for (const [field, permission] of contributionPermissions) {
      const contributions = extension[field] as unknown[] | undefined
      if (contributions?.length && !manifest.permissions.includes(permission)) throw new Error(`${manifest.id} contributes ${String(field)} without ${permission}.`)
    }
    const contributionIds = [
      ...(extension.promptTypes || []).map((value) => `prompt:${value.id}`),
      ...(extension.importers || []).map((value) => `importer:${value.id}`),
      ...(extension.exporters || []).map((value) => `exporter:${value.id}`),
      ...(extension.planningSignals || []).map((value) => `signal:${value.id}`),
      ...(extension.queuePolicies || []).map((value) => `policy:${value.id}`),
      ...(extension.syncTransports || []).map((value) => `sync:${value.id}`),
      ...(extension.commands || []).map((value) => `command:${value.id}`),
      ...(extension.pages || []).map((value) => `page:${value.route}`),
      ...(extension.workspacePanels || []).map((value) => `workspace-panel:${value.id}`),
      ...(extension.creationPanels || []).map((value) => `creation-panel:${value.id}`),
      ...(extension.libraryPresets || []).map((value) => `library-presets:${value.id}`),
    ]
    if (contributionIds.some((id) => !id.split(':').slice(1).join(':').trim()) || new Set(contributionIds).size !== contributionIds.length) throw new Error(`${manifest.id} contains empty or duplicate contribution IDs.`)
    for (const existing of this.extensions.values()) {
      const existingIds = new Set([
        ...(existing.promptTypes || []).map((value) => `prompt:${value.id}`),
        ...(existing.importers || []).map((value) => `importer:${value.id}`),
        ...(existing.exporters || []).map((value) => `exporter:${value.id}`),
        ...(existing.planningSignals || []).map((value) => `signal:${value.id}`),
        ...(existing.queuePolicies || []).map((value) => `policy:${value.id}`),
        ...(existing.syncTransports || []).map((value) => `sync:${value.id}`),
        ...(existing.commands || []).map((value) => `command:${value.id}`),
        ...(existing.pages || []).map((value) => `page:${value.route}`),
        ...(existing.workspacePanels || []).map((value) => `workspace-panel:${value.id}`),
        ...(existing.creationPanels || []).map((value) => `creation-panel:${value.id}`),
        ...(existing.libraryPresets || []).map((value) => `library-presets:${value.id}`),
      ])
      const duplicate = contributionIds.find((id) => existingIds.has(id))
      if (duplicate) throw new Error(`Duplicate extension contribution ${duplicate}.`)
    }
    this.extensions.set(manifest.id, extension)
  }

  list() { return [...this.extensions.values()].map(({ manifest }) => ({ ...manifest, permissions: [...manifest.permissions] })) }
  getDiagnostics() { return [...this.diagnostics] }
  reportDiagnostic(extensionId: string, contribution: string, error: unknown) { this.record(extensionId, contribution, error) }

  promptTypes(): PromptTypeContribution[] { return [...this.extensions.values()].flatMap((extension) => extension.promptTypes || []) }
  promptType(id: string) { return this.promptTypes().find((prompt) => prompt.id === id) }
  private promptEntry(id: string) {
    for (const extension of this.extensions.values()) {
      const contribution = extension.promptTypes?.find((prompt) => prompt.id === id)
      if (contribution) return { extension, contribution }
    }
    return undefined
  }

  createCards(input: CreateKnowledgeInput): CardSeed[] {
    return input.variants.flatMap((id) => {
      const entry = this.promptEntry(id)
      if (!entry) return id === 'forward' ? [{ promptType: 'forward', estimatedSeconds: 14 }] : []
      try { return entry.contribution.createCards(input) }
      catch (error) { this.record(entry.extension.manifest.id, `${id}.createCards`, error); return [] }
    })
  }

  render(item: KnowledgeItem, card: PracticeCard): PortableRenderedCard {
    const id = card.variant
    if (id === 'forward') return fallbackRender(item)
    const entry = this.promptEntry(id)
    if (!entry) return fallbackRender(item)
    try { return entry.contribution.render(item, card) }
    catch (error) { this.record(entry.extension.manifest.id, `${id}.render`, error); return fallbackRender(item) }
  }

  compareAnswer(promptType: string, attempt: string, expected: string) {
    const entry = this.promptEntry(promptType)
    const comparator = entry?.contribution.compareAnswer
    if (!comparator) return null
    try { return comparator(attempt, expected) }
    catch (error) { this.record(entry.extension.manifest.id, `${promptType}.compareAnswer`, error); return null }
  }

  async importFile(file: File): Promise<ImportSummary> {
    const suffix = `.${file.name.toLowerCase().split('.').pop()}`
    const contribution = [...this.extensions.values()].flatMap((extension) => extension.importers || []).find((importer) => importer.extensions.includes(suffix))
    if (!contribution) throw new Error(`No installed extension can import ${suffix}.`)
    try { return await contribution.import(file) }
    catch (error) { this.record(contribution.id, 'import', error); throw error }
  }

  exporters(): FileExporterContribution[] { return [...this.extensions.values()].flatMap((extension) => extension.exporters || []) }
  queuePolicies() { return [...this.extensions.values()].flatMap((extension) => extension.queuePolicies || []) }

  planningSignals(item: KnowledgeItem, data: Readonly<AppData>, now: Date): PlanningSignal[] {
    return [...this.extensions.values()].flatMap((extension) => (extension.planningSignals || []).flatMap((provider) => {
      try { return provider.signalsFor(item, data, now).map((signal) => ({ ...signal, score: Math.min(4, Math.max(0, signal.score)) })) }
      catch (error) { this.record(extension.manifest.id, provider.id, error); return [] }
    }))
  }

  scoreQueuePolicy(id: string, candidate: QueuePolicyCandidate) {
    const policy = this.queuePolicies().find((value) => value.id === id)
    if (!policy) return null
    try {
      const score = policy.score(candidate)
      return Number.isFinite(score) ? score : null
    } catch (error) { this.record(id, 'queuePolicy', error); return null }
  }

  createSyncTransport(): SyncTransport | null {
    const contribution = [...this.extensions.values()].flatMap((extension) => extension.syncTransports || [])[0]
    if (!contribution) return null
    try { return contribution.create() }
    catch (error) { this.record(contribution.id, 'syncTransport', error); return null }
  }

  async runCommand(id: string, data: AppData, payload: unknown): Promise<AppData> {
    const owner = [...this.extensions.values()].find((extension) => extension.commands?.some((value) => value.id === id))
    const command = owner?.commands?.find((value) => value.id === id)
    if (!owner || !command) throw new Error(`Extension command ${id} is not installed.`)
    const snapshot = structuredClone(data)
    let next = data
    try {
      await command.run({ data: snapshot, replaceData: (replacement) => { next = replacement } }, payload)
      if (!Array.isArray(next.items) || !Array.isArray(next.cards) || !Array.isArray(next.assets)) throw new Error('Extension returned an invalid data transaction.')
      return { ...next, version: data.version, deviceId: data.deviceId, reviews: data.reviews, settings: data.settings }
    } catch (error) { this.record(owner.manifest.id, id, error); throw error }
  }

  pages(): ExtensionPageContribution[] { return [...this.extensions.values()].flatMap((extension) => extension.pages || []) }
  page(route: Route) { return this.pages().find((page) => page.route === route) }
  workspacePanels(): WorkspacePanelContribution[] { return [...this.extensions.values()].flatMap((extension) => extension.workspacePanels || []) }
  creationPanels(): CreationPanelContribution[] { return [...this.extensions.values()].flatMap((extension) => extension.creationPanels || []) }
  libraryPresets(data: Readonly<AppData>): LibraryPreset[] {
    return [...this.extensions.values()].flatMap((extension) => (extension.libraryPresets || []).flatMap((provider) => {
      try { return provider.presets(data) }
      catch (error) { this.record(extension.manifest.id, provider.id, error); return [] }
    }))
  }

  private record(extensionId: string, contribution: string, error: unknown) {
    this.diagnostics.push({ extensionId, contribution, message: error instanceof Error ? error.message : 'Extension contribution failed.' })
  }
}
