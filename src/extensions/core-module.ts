import type { ComponentType, Dispatch, SetStateAction } from 'react'
import type { AppData, CreateKnowledgeInput, DailyPlan, ImportSummary, KnowledgeItem, MediaAsset, OcclusionRect, PracticeCard, ReviewRating, Route } from '../types.js'

/** Trusted, application-compiled module permissions. This is not an installable extension SDK. */
export type CoreModulePermission =
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

export interface CoreModuleManifest {
  id: string
  name: string
  version: string
  runtime: 'core'
  publisher: 'Neo Anki'
  permissions: CoreModulePermission[]
  description?: string
}

export interface PortableRenderedCard { prompt: string; answer: string; context: string; typed: boolean; mediaId?: string; occlusionId?: string; citations: KnowledgeItem['citations'] }
export interface CardSeed { promptType: string; estimatedSeconds: number; extensionData?: Record<string, unknown>; occlusionId?: string }
export interface PromptTypeContribution { id: string; label: string; createCards(input: CreateKnowledgeInput): CardSeed[]; render(item: KnowledgeItem, card: PracticeCard): PortableRenderedCard; compareAnswer?(attempt: string, expected: string): { result: 'exact' | 'close' | 'incorrect'; similarity: number } }
export interface FileImporterContribution { id: string; label: string; extensions: string[]; import(file: File, reportProgress?: (message: string) => void): Promise<ImportSummary> }
export interface FileExporterContribution { id: string; label: string; filename: string; mimeType: string; export(data: Readonly<AppData>): string | Uint8Array | Promise<string | Uint8Array> }
export interface PlanningSignal { id: string; label: string; score: number }
export interface PlanningSignalContribution { id: string; signalsFor(item: KnowledgeItem, data: Readonly<AppData>, now: Date): PlanningSignal[] }
export interface QueuePolicyCandidate { card: PracticeCard; overdueDays: number; extensionBoost: number }
export interface QueuePolicyContribution { id: string; label: string; score(candidate: QueuePolicyCandidate): number }
export interface SyncTransport { publish(data: AppData): void | Promise<void>; subscribe(listener: (data: AppData) => void): () => void; close?(): void }
export interface SyncTransportContribution { id: string; create(): SyncTransport | null }
export interface CoreModuleCommandContext { data: Readonly<AppData>; replaceData(next: AppData): void }
export interface CoreModuleCommandContribution { id: string; run(context: CoreModuleCommandContext, payload: unknown): void | Promise<void> }
export interface CoreModulePageProps { moduleId: string; data: Readonly<AppData>; plan: Readonly<DailyPlan>; runCommand(id: string, payload: unknown): Promise<void> }
export interface ExtensionPageContribution { route: Route; label: string; component: ComponentType<CoreModulePageProps> }
export interface WorkspacePanelContribution { id: string; label: string; component: ComponentType<CoreModulePageProps> }
export interface CreationPanelProps { assets: MediaAsset[]; setAssets: Dispatch<SetStateAction<MediaAsset[]>>; occlusions: OcclusionRect[]; setOcclusions: Dispatch<SetStateAction<OcclusionRect[]>>; selectPromptType(id: string): void }
export interface CreationPanelContribution { id: string; component: ComponentType<CreationPanelProps> }
export interface LibraryPreset { id: string; label: string; query: string; collection?: string }
export interface LibraryPresetContribution { id: string; presets(data: Readonly<AppData>): LibraryPreset[] }
export interface CoreModuleSettingsPanelProps { moduleId: string; data: Readonly<AppData>; runCommand(id: string, payload: unknown): Promise<void> }
export interface ExtensionSettingsPanelContribution { id: string; component: ComponentType<CoreModuleSettingsPanelProps> }
export interface CoreModuleReviewToolProps { moduleId: string; card: Readonly<PracticeCard>; item: Readonly<KnowledgeItem>; assets: readonly Readonly<MediaAsset>[]; revealed: boolean; submitRating(rating: ReviewRating): void }
export interface ReviewToolContribution { id: string; component: ComponentType<CoreModuleReviewToolProps> }

export interface NeoAnkiCoreModule {
  manifest: CoreModuleManifest
  promptTypes?: PromptTypeContribution[]
  importers?: FileImporterContribution[]
  exporters?: FileExporterContribution[]
  planningSignals?: PlanningSignalContribution[]
  queuePolicies?: QueuePolicyContribution[]
  syncTransports?: SyncTransportContribution[]
  commands?: CoreModuleCommandContribution[]
  pages?: ExtensionPageContribution[]
  workspacePanels?: WorkspacePanelContribution[]
  creationPanels?: CreationPanelContribution[]
  libraryPresets?: LibraryPresetContribution[]
  settingsPanels?: ExtensionSettingsPanelContribution[]
  reviewTools?: ReviewToolContribution[]
}

export interface ExtensionDiagnostic { extensionId: string; contribution: string; message: string }
export const defineCoreModule = <TModule extends NeoAnkiCoreModule>(module: TModule): TModule => module
