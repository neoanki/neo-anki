import type { ComponentType, Dispatch, SetStateAction } from 'react'
import type { AppData, CreateKnowledgeInput, DailyPlan, ImportSummary, KnowledgeItem, MediaAsset, OcclusionRect, PracticeCard, ReviewRating, Route } from './model.js'

export * from './model.js'

export type ExtensionPermission =
  | 'prompts:contribute'
  | 'imports:files'
  | 'exports:files'
  | 'planning:signals'
  | 'planning:policies'
  | 'sync:transport'
  | 'ui:pages'
  | 'ui:workspace-panels'
  | 'ui:create-panels'
  | 'ui:library-presets'
  | 'ui:settings-panels'
  | 'review:tools'
  | 'content:transactions'

export interface ExtensionManifest {
  id: string
  name: string
  version: string
  sdkVersion: 1
  publisher: string
  permissions: ExtensionPermission[]
  description?: string
  homepage?: string
}

export interface ExtensionPackageManifest extends ExtensionManifest {
  format: 'neo-anki-extension'
  schemaVersion: 1
  entry: string
}

export interface PortableRenderedCard {
  prompt: string
  answer: string
  context: string
  typed: boolean
  mediaId?: string
  occlusionId?: string
  citations: KnowledgeItem['citations']
}

export interface CardSeed {
  promptType: string
  estimatedSeconds: number
  extensionData?: Record<string, unknown>
  occlusionId?: string
}

export interface PromptTypeContribution {
  id: string
  label: string
  createCards(input: CreateKnowledgeInput): CardSeed[]
  render(item: KnowledgeItem, card: PracticeCard): PortableRenderedCard
  compareAnswer?(attempt: string, expected: string): { result: 'exact' | 'close' | 'incorrect'; similarity: number }
}

export interface FileImporterContribution {
  id: string
  label: string
  extensions: string[]
  import(file: File): Promise<ImportSummary>
}

export interface FileExporterContribution {
  id: string
  label: string
  filename: string
  mimeType: string
  export(data: Readonly<AppData>): string | Promise<string>
}

export interface PlanningSignal {
  id: string
  label: string
  score: number
}

export interface PlanningSignalContribution {
  id: string
  signalsFor(item: KnowledgeItem, data: Readonly<AppData>, now: Date): PlanningSignal[]
}

export interface QueuePolicyCandidate {
  card: PracticeCard
  overdueDays: number
  extensionBoost: number
}

export interface QueuePolicyContribution {
  id: string
  label: string
  score(candidate: QueuePolicyCandidate): number
}

export interface SyncTransport {
  publish(data: AppData): void | Promise<void>
  subscribe(listener: (data: AppData) => void): () => void
  close?(): void
}

export interface SyncTransportContribution {
  id: string
  create(): SyncTransport | null
}

export interface ExtensionCommandContext {
  data: Readonly<AppData>
  replaceData(next: AppData): void
}

export interface ExtensionCommandContribution {
  id: string
  run(context: ExtensionCommandContext, payload: unknown): void | Promise<void>
}

export interface ExtensionPageProps {
  extensionId: string
  data: Readonly<AppData>
  plan: Readonly<DailyPlan>
  runCommand(id: string, payload: unknown): Promise<void>
}

export interface ExtensionPageContribution {
  route: Route
  label: string
  component: ComponentType<ExtensionPageProps>
}

export interface WorkspacePanelContribution {
  id: string
  label: string
  component: ComponentType<ExtensionPageProps>
}

export interface CreationPanelProps {
  assets: MediaAsset[]
  setAssets: Dispatch<SetStateAction<MediaAsset[]>>
  occlusions: OcclusionRect[]
  setOcclusions: Dispatch<SetStateAction<OcclusionRect[]>>
  selectPromptType(id: string): void
}

export interface CreationPanelContribution {
  id: string
  component: ComponentType<CreationPanelProps>
}

export interface LibraryPreset {
  id: string
  label: string
  query: string
  collection?: string
}

export interface LibraryPresetContribution {
  id: string
  presets(data: Readonly<AppData>): LibraryPreset[]
}

export interface ExtensionSettingsPanelProps {
  extensionId: string
}

export interface ExtensionSettingsPanelContribution {
  id: string
  component: ComponentType<ExtensionSettingsPanelProps>
}

export interface ReviewToolProps {
  extensionId: string
  card: Readonly<PracticeCard>
  item: Readonly<KnowledgeItem>
  revealed: boolean
  submitRating(rating: ReviewRating): void
}

export interface ReviewToolContribution {
  id: string
  component: ComponentType<ReviewToolProps>
}

export interface NeoAnkiExtension {
  manifest: ExtensionManifest
  promptTypes?: PromptTypeContribution[]
  importers?: FileImporterContribution[]
  exporters?: FileExporterContribution[]
  planningSignals?: PlanningSignalContribution[]
  queuePolicies?: QueuePolicyContribution[]
  syncTransports?: SyncTransportContribution[]
  commands?: ExtensionCommandContribution[]
  pages?: ExtensionPageContribution[]
  workspacePanels?: WorkspacePanelContribution[]
  creationPanels?: CreationPanelContribution[]
  libraryPresets?: LibraryPresetContribution[]
  settingsPanels?: ExtensionSettingsPanelContribution[]
  reviewTools?: ReviewToolContribution[]
}

export interface ExtensionDiagnostic {
  extensionId: string
  contribution: string
  message: string
}

export const defineExtension = <TExtension extends NeoAnkiExtension>(extension: TExtension): TExtension => extension

export * from './package-format.js'
export * from './ui.js'
